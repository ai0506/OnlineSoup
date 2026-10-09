import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createClient as createAuthClient, type Session } from '@supabase/supabase-js';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseEnv } from '@/lib/env';
import { getClientIp } from '@/lib/request-context';
import { failure, success, type PlayerEnvelope } from './protocol';
import { rpcFailure } from './errors';

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const key=()=>createHash('sha256').update('onlinesoup-cli-browser-session-v1\0'+process.env.SUPABASE_SECRET_KEY).digest();
function seal(session:Session,id:string) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(id));
  const body=Buffer.concat([cipher.update(JSON.stringify({access_token:session.access_token,refresh_token:session.refresh_token,user_id:session.user.id}),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
}
function unseal(text:string,id:string):{access_token:string;refresh_token:string;user_id:string} {
  const bytes=Buffer.from(text,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
  decipher.setAAD(Buffer.from(id));decipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
}
const startSchema=z.object({secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),challenge:z.string().regex(/^[a-f0-9]{64}$/),previous_user_id:z.uuid().optional()}).strict();
const pollSchema=z.object({id:z.uuid(),secret:z.string().regex(/^[A-Za-z0-9_-]{43}$/),verifier:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();

// An existing CLI login can only be replaced after its seat is handled. This is
// checked again at delivery; player_revoke_session closes the concurrent-join race.
async function replaceable(client:Awaited<ReturnType<typeof createClient>>) {
  const {data,error}=await client.auth.getUser();
  if(error&&error.name!=='AuthSessionMissingError'&&(!error.status||error.status>=500))return failure('SERVER_ERROR','认证服务暂时不可用');
  if(data.user){
    const session=await client.rpc('player_session');
    if(session.error&&!['AUTH_EXPIRED'].includes(session.error.message))return rpcFailure(session.error).body;
    const active=await client.rpc('get_my_active_room');
    if(active.error)return rpcFailure(active.error).body;
    if(active.data)return failure('LEAVE_REQUIRED','请先离开当前房间');
  }
  return null;
}
export async function browserAuth(request:Request,action:string):Promise<PlayerEnvelope> {
  const body=await request.json().catch(()=>null),admin=createAdminClient();
  const client=await createClient();
  if(action==='start') {
    const parsed=startSchema.safeParse(body);if(!parsed.success)return failure('INVALID_INPUT','登录请求不正确');
    const blocked=await replaceable(client);if(blocked)return blocked;
    const subject=createHmac('sha256',process.env.SUPABASE_SECRET_KEY!).update(getClientIp(request.headers)??'unknown').digest('hex');
    const rate=await admin.rpc('player_login_attempt',{p_subject:subject});if(rate.error)return rpcFailure(rate.error).body;
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code=[...randomBytes(8)].map(b=>alphabet[b%alphabet.length]).join('');
    const result=await admin.rpc('player_browser_auth',{p_action:'start',p_id:randomUUID(),p_secret_hash:digest(parsed.data.secret),p_challenge:parsed.data.challenge,p_code_hash:digest(code),p_expected_user_id:parsed.data.previous_user_id??null});
    return result.error?rpcFailure(result.error).body:success({...result.data,user_code:code});
  }
  if(!['poll','ack'].includes(action))return failure('INVALID_INPUT','登录操作不正确');
  const parsed=pollSchema.safeParse(body);if(!parsed.success)return failure('INVALID_INPUT','登录请求不正确');
  const input={p_id:parsed.data.id,p_secret_hash:digest(parsed.data.secret),p_challenge:digest(parsed.data.verifier)};
  const claim=randomUUID();
  let result=await admin.rpc('player_browser_auth',{...input,p_action:action,p_claim_id:claim});
  if(result.error)return rpcFailure(result.error).body;
  if(action==='ack')return success({status:result.data.status});
  if(result.data.status==='issue') {
    const env=getSupabaseEnv();
    const candidate=createAuthClient(env.url,env.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
    let stored=false;
    try {
      const user=await admin.auth.admin.getUserById(result.data.user_id);
      if(user.error||!user.data.user?.email)throw Error('USER_UNAVAILABLE');
      const link=await admin.auth.admin.generateLink({type:'magiclink',email:user.data.user.email});
      if(link.error||link.data.user.id!==result.data.user_id)throw Error('LINK_FAILED');
      const verified=await candidate.auth.verifyOtp({type:'email',token_hash:link.data.properties.hashed_token});
      if(verified.error||verified.data.user?.id!==result.data.user_id||!verified.data.session)throw Error('SESSION_FAILED');
      const claims=await candidate.auth.getClaims();const sid=claims.data?.claims.session_id;
      if(typeof sid!=='string')throw Error('SESSION_FAILED');
      const registered=await admin.rpc('player_register_session',{p_user_id:verified.data.session.user.id,p_session_id:sid});
      if(registered.error)throw Error('REGISTRATION_FAILED');
      result=await admin.rpc('player_browser_auth',{...input,p_action:'complete',p_claim_id:claim,p_ciphertext:seal(verified.data.session,parsed.data.id)});
      if(result.error)throw Error('GRANT_EXPIRED');
      stored=true;
      result=await admin.rpc('player_browser_auth',{...input,p_action:'poll',p_claim_id:claim});
      if(result.error)return rpcFailure(result.error).body;
    }catch{return failure('BROWSER_LOGIN_FAILED','网页登录未完成，请重新发起登录');}
    finally{if(!stored)await candidate.auth.signOut({scope:'local'});}
  }
  if(result.data.status!=='ready')return success({status:result.data.status});
  const tokens=unseal(result.data.ciphertext,parsed.data.id);
  const current=await client.auth.getClaims();
  const targetSid=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url').toString()).session_id;
  if(current.data?.claims.session_id!==targetSid) {
    const blocked=await replaceable(client);if(blocked)return blocked;
    const {data}=await client.auth.getUser();
    if(data.user){
      const old=await client.rpc('player_session');
      if(!old.error){const revoked=await client.rpc('player_revoke_session');if(revoked.error)return rpcFailure(revoked.error).body;}
      const logout=await client.auth.signOut({scope:'local'});if(logout.error)return failure('SERVER_ERROR','旧登录退出未确认');
    }
    const installed=await client.auth.setSession(tokens);if(installed.error)return failure('AUTH_EXPIRED','登录已失效，请重新发起登录');
  }
  const session=await client.rpc('player_session');
  return session.error?rpcFailure(session.error).body:success({...session.data,status:'completed'});
}
