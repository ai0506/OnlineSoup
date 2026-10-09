import Link from 'next/link';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CliBrowserLogin } from '@/components/cli-browser-login';
export const metadata={title:'CLI 登录授权 - 汤局',referrer:'no-referrer'};
export default async function CliLoginPage({searchParams}:{searchParams:Promise<{id?:string}>}) {
  const id=z.uuid().safeParse((await searchParams).id);
  let status='expired';
  if(id.success){const result=await createAdminClient().rpc('player_browser_auth',{p_action:'view',p_id:id.data});status=result.error?'failed':result.data.status;}
  if(status!=='pending'){
    const confirmed=['approved','issuing','ready','consumed'].includes(status);
    return <section className="auth-page"><div className="form-card form-grid"><h1>{confirmed?'已确认授权':status==='denied'?'已取消授权':'登录请求已失效'}</h1><p>{confirmed?'请返回终端查看登录结果。可以关闭此页面。':'请返回终端重新发起登录。'}</p><Link href="/">返回大厅</Link></div></section>;
  }
  const client=await createClient();const {data}=await client.auth.getUser();
  let user=null;
  if(data.user){const profile=await client.from('profiles').select('username').eq('id',data.user.id).maybeSingle();if(profile.data?.username)user={id:data.user.id,username:profile.data.username};}
  return <CliBrowserLogin id={id.data!} user={user}/>;
}
