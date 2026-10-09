import { createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createAuthClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loginIdentitySchema } from '@/lib/validation';
import { getClientIp, getLocationLabel } from '@/lib/request-context';
import { runRoomAiRequest, type AiRequestResult } from '@/lib/room-ai-runner';
import { success, failure } from '@/lib/player-api/protocol';
import { rpcFailure } from '@/lib/player-api/errors';

export const runtime = 'nodejs';
export const maxDuration = 120;
type Context = { params: Promise<{path: string[]}> };
const uuid = z.uuid();
const writeBody = z.object({
  content:z.string().trim().min(1).max(300).optional(),
  password:z.string().regex(/^\d{6}$/).optional(),
  takeover:z.boolean().default(false),
  message_mode:z.enum(['ask','hint','reason']).default('ask'),
  use_personal_points:z.boolean().default(false),
  expected_puzzle_id:z.number().int().positive().optional(),
}).strict();
function reply(data: unknown) { return NextResponse.json(success(data),{headers:{'Cache-Control':'no-store'}}); }
function fail(code:string,message:string,status=400) { return NextResponse.json(failure(code,message),{status,headers:{'Cache-Control':'no-store'}}); }
function dbError(error:{message:string;details?:string|null}) { const r=rpcFailure(error);return NextResponse.json(r.body,{status:r.status,headers:{'Cache-Control':'no-store'}}); }
function protocolGuard(request:Request) {
  if (request.headers.get('X-OnlineSoup-Version')!=='1') return fail('CLIENT_TOO_OLD','请使用支持协议版本 1 的 CLI',426);
  const origin=request.headers.get('Origin');
  if (origin && origin!==new URL(request.url).origin) return fail('ORIGIN_DENIED','不允许跨站请求',403);
  if (request.method==='POST' && (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') || (!origin && request.headers.get('X-OnlineSoup-Client')!=='cli'))) return fail('ORIGIN_DENIED','请求格式不正确',403);
  return null;
}
async function handle(request:Request,{params}:Context) {
  const blocked=protocolGuard(request); if(blocked)return blocked;
  const path=(await params).path;
  const supabase=await createClient();
  if(request.method==='POST' && path.join('/')==='login') {
    const body=await request.json().catch(()=>null);
    const parsed=loginIdentitySchema.safeParse(body);
    if(!parsed.success) return fail('INVALID_INPUT','请输入用户名或邮箱及密码');
    const admin=createAdminClient();
    const ip=getClientIp(request.headers)??'unknown';
    const subject=createHmac('sha256',process.env.SUPABASE_SECRET_KEY!).update(ip).digest('hex');
    const attempt=await admin.rpc('player_login_attempt',{p_subject:subject});
    if(attempt.error)return dbError(attempt.error);
    const {data:current,error:currentError}=await supabase.auth.getUser();
    if(currentError && (!currentError.status || currentError.status>=500) && currentError.name!=='AuthSessionMissingError') return fail('SERVER_ERROR','认证服务暂时不可用',503);
    if(current.user) {
      const active=await supabase.rpc('get_my_active_room');
      if(active.error)return dbError(active.error);
      if(active.data)return fail('LEAVE_REQUIRED','请先离开当前房间',409);
    }
    let email=parsed.data.identity;
    let userId:string|undefined;
    if(!email.includes('@')) {
      const profile=await admin.from('profiles').select('id').ilike('username',email.replace(/[\\%_]/g,'\\$&')).maybeSingle();
      if(profile.error)return fail('SERVER_ERROR','登录服务暂时不可用',503);
      if(!profile.data)return fail('INVALID_CREDENTIALS','用户名或密码错误',401);
      userId=profile.data.id;
      const found=await admin.auth.admin.getUserById(userId!);
      if(found.error)return fail('SERVER_ERROR','登录服务暂时不可用',503);
      email=found.data.user?.email??'';
    }
    // Validate new credentials without replacing the old cookie/session first.
    const env=getSupabaseEnv();
    const candidate=createAuthClient(env.url,env.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const login=await candidate.auth.signInWithPassword({email,password:parsed.data.password});
    if(login.error)return fail(login.error.status&&login.error.status>=500?'SERVER_ERROR':'INVALID_CREDENTIALS','登录失败，请检查凭据后重试',login.error.status&&login.error.status>=500?503:401);
    let installed=false;
    try {
      if(body?.previous_user_id && body.previous_user_id!==login.data.user.id) {
        return fail('LEAVE_REQUIRED','请用原账号恢复并处理原座位后再切换账号',409);
      }
      const claims=await candidate.auth.getClaims();
      const sessionId=claims.data?.claims.session_id;
      if(claims.error||typeof sessionId!=='string')return fail('AUTH_EXPIRED','登录会话未确认',401);
      const registered=await admin.rpc('player_register_session',{p_user_id:login.data.user.id,p_session_id:sessionId});
      if(registered.error)return dbError(registered.error);
      if(current.user) {
        const old=await supabase.rpc('player_session');
        if(!old.error) {
          // Rechecks active seats under the database gate, including a concurrent join.
          const revoked=await supabase.rpc('player_revoke_session');
          if(revoked.error)return dbError(revoked.error);
        }else if(!['CLI_SESSION_REQUIRED','AUTH_EXPIRED'].includes(old.error.message))return dbError(old.error);
        const signedOut=await supabase.auth.signOut({scope:'local'});
        if(signedOut.error)return fail('SERVER_ERROR','旧会话退出未确认，请重试',503);
      }
      const applied=await supabase.auth.setSession({access_token:login.data.session.access_token,refresh_token:login.data.session.refresh_token});
      if(applied.error)return fail('AUTH_EXPIRED','登录会话未确认',401);
      installed=true;
    } finally {
      if(!installed)await candidate.auth.signOut({scope:'local'});
    }
    const context=await supabase.rpc('record_login_context',{p_ip:null,p_device:'CLI',p_location:getLocationLabel(request.headers)});
    if(context.error)return dbError(context.error);
    const currentSession=await supabase.rpc('player_session');
    return currentSession.error?dbError(currentSession.error):reply(currentSession.data);
  }
  const {data:auth,error:authError}=await supabase.auth.getUser();
  if(authError && authError.name!=='AuthSessionMissingError' && (!authError.status || authError.status>=500)) return fail('SERVER_ERROR','认证服务暂时不可用',503);
  if(!auth.user) {
    if(request.method==='GET' && path.join('/')==='session')return reply({authenticated:false});
    return fail(authError?.name==='AuthSessionMissingError'?'LOGIN_REQUIRED':'AUTH_EXPIRED','请登录后重试',401);
  }
  const session=await supabase.rpc('player_session');
  if(session.error)return dbError(session.error);
  if(request.method==='GET' && path.join('/')==='session') return reply(session.data);
  if(request.method==='POST' && path.join('/')==='logout') {
    const revoked=await supabase.rpc('player_revoke_session');if(revoked.error)return dbError(revoked.error);
    const result=await supabase.auth.signOut({scope:'local'});
    if(result.error)return fail('SERVER_ERROR','登出未确认，请重试',503);
    return reply({authenticated:false});
  }
  if(request.method==='GET' && path.length===2 && path[0]==='requests') {
    if(!uuid.safeParse(path[1]).success)return fail('INVALID_INPUT','请求键必须是 UUID');
    const result=await supabase.rpc('player_read',{p_action:'request',p_request_key:path[1]});
    return result.error?dbError(result.error):reply(result.data);
  }
  if(path.length!==3 || path[0]!=='rooms' || !/^[A-Z0-9]{6}$/.test(path[1]))return fail('INVALID_INPUT','房间码或路径不正确',404);
  const code=path[1], action=path[2];
  if(request.method==='GET') {
    if(action==='join-info') {
      const result=await supabase.rpc('get_room_join_info',{p_room_code:code});
      return result.error?dbError(result.error):reply(result.data);
    }
    if(!['state','messages','puzzle','facts'].includes(action))return fail('INVALID_COMMAND','尚不支持该读取',404);
    const query=new URL(request.url).searchParams;
    if(action!=='messages' && query.size)return fail('INVALID_INPUT','该读取不支持查询参数');
    if(action==='messages') {
      if([...query.keys()].some(k=>!['after','before','limit'].includes(k)) || [...query.keys()].some(k=>query.getAll(k).length!==1))return fail('INVALID_INPUT','消息分页参数不正确');
      const after=query.get('after'),before=query.get('before'),limit=query.get('limit')??'50';
      if((after!==null && before!==null) || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit) || [after,before].some(c=>c!==null && (!c.length || c.length>4096)))return fail('INVALID_INPUT','消息分页参数不正确');
      const result=await supabase.rpc('player_messages',{p_room_code:code,p_after:after,p_before:before,p_limit:Number(limit)});
      return result.error?dbError(result.error):reply(result.data);
    }
    const result=await supabase.rpc(action==='facts'?'player_facts':'player_snapshot',{p_room_code:code});
    return result.error?dbError(result.error):reply(action==='puzzle'?{puzzle:result.data.puzzle}:result.data);
  }
  if(!['join','leave','messages','ask'].includes(action))return fail('INVALID_COMMAND','不支持该操作',404);
  const key=request.headers.get('Idempotency-Key');if(!uuid.safeParse(key).success)return fail('REQUIRED_INPUT_MISSING','写操作必须携带 UUID 请求键');
  const parsed=writeBody.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return fail('INVALID_INPUT','请求内容格式不正确');
  const payload=parsed.data;
  const mode=action==='messages'?'say':action==='ask'?payload.message_mode:action;
  if(['say','ask','hint','reason'].includes(mode) && !payload.content)return fail('REQUIRED_INPUT_MISSING','请输入内容');
  if(action==='ask') {
    const max=payload.message_mode==='ask'?100:payload.message_mode==='hint'?50:300;
    if(payload.content!.length>max)return fail('INVALID_INPUT','消息超过该模式字数限制');
    if(!payload.expected_puzzle_id)return fail('REQUIRED_INPUT_MISSING','请先读取当前题目');
    if(!process.env.DEEPSEEK_API_KEY)return fail('SERVER_ERROR','AI 主持尚未配置',503);
  }
  const result=await supabase.rpc('player_write',{p_action:mode,p_room_code:code,p_request_key:key,p_payload:payload});
  if(result.error)return dbError(result.error);
  if(result.data?.execute_ai) {
    await runRoomAiRequest(result.data.ai_request as AiRequestResult,code,payload.content!,payload.message_mode,payload.expected_puzzle_id);
    const finished=await supabase.rpc('player_read',{p_action:'request',p_request_key:key});
    return finished.error?dbError(finished.error):reply(finished.data);
  }
  // Internal model input/dispatch flags never reach the client.
  const {execute_ai: _execute,ai_request: _ai,...visible}=result.data;
  void _execute;void _ai;
  return reply(visible);
}
export async function GET(request:Request,context:Context) {
  try{return await handle(request,context);}catch{return fail('SERVER_ERROR','服务暂时不可用',503);}
}
export async function POST(request:Request,context:Context) {
  try{return await handle(request,context);}catch{return fail('REQUEST_RESULT_UNKNOWN','操作结果尚未确认，请用原请求键查询',503);}
}
