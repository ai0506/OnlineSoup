'use server';
import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { loginIdentitySchema } from '@/lib/validation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getClientIp } from '@/lib/request-context';

export type BrowserLoginState={message:string};
const approval=z.object({id:z.uuid(),user:z.uuid(),code:z.string().max(16),approve:z.boolean()});
export async function approveBrowserLogin(_previous:BrowserLoginState,form:FormData):Promise<BrowserLoginState> {
  const parsed=approval.safeParse({id:form.get('id'),user:form.get('user'),code:form.get('code')??'',approve:form.get('intent')!=='deny'});
  if(!parsed.success)return {message:'登录请求不正确，请从终端重新开始。'};
  const client=await createClient();const {data}=await client.auth.getUser();
  if(!data.user)return {message:'请先登录，再确认授权。'};
  const result=await client.rpc('approve_cli_browser_login',{p_id:parsed.data.id,p_code:parsed.data.code,p_approve:parsed.data.approve,p_expected_web_user:parsed.data.user});
  if(result.error)return {message:result.error.message==='USERNAME_REQUIRED'?'请先在网站设置用户名。':'授权失败，请从终端重新开始。'};
  const messages:Record<string,string>={wrong_code:'验证码不正确，请输入终端中显示的验证码。',wrong_account:'请使用终端原来的账号恢复登录，或先处理原座位。',account_changed:'网页账号已变化，请刷新页面后重新确认。',expired:'登录请求已过期，请从终端重新开始。',failed:'登录未完成，请从终端重新开始。'};
  if(messages[result.data.status])return {message:messages[result.data.status]};
  redirect(`/auth/cli?id=${parsed.data.id}`);
}
export async function signInForCli(_previous:BrowserLoginState,form:FormData):Promise<BrowserLoginState> {
  const id=z.uuid().safeParse(form.get('id'));
  const parsed=loginIdentitySchema.safeParse({identity:form.get('identity'),password:form.get('password')});
  if(!id.success||!parsed.success)return {message:'请输入有效用户名或邮箱，以及至少 6 位密码。'};
  const admin=createAdminClient(),h=await headers();
  const subject=createHmac('sha256',process.env.SUPABASE_SECRET_KEY!).update(getClientIp(h)??'unknown').digest('hex');
  const rate=await admin.rpc('player_login_attempt',{p_subject:subject});
  if(rate.error)return {message:'尝试过于频繁，请稍后重试。'};
  let email=parsed.data.identity;
  if(!email.includes('@')){
    const profile=await admin.from('profiles').select('id').ilike('username',email.replace(/[\\%_]/g,'\\$&')).maybeSingle();
    if(profile.error||!profile.data)return {message:'账号或密码不正确。'};
    const user=await admin.auth.admin.getUserById(profile.data.id);email=user.data.user?.email??'';
  }
  const client=await createClient();const result=await client.auth.signInWithPassword({email,password:parsed.data.password});
  if(result.error)return {message:'账号或密码不正确。'};
  redirect(`/auth/cli?id=${id.data}`);
}
