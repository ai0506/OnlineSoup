'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { approveBrowserLogin,signInForCli } from '@/app/auth/cli/actions';

export function CliBrowserLogin({id,user}:{id:string;user:{id:string;username:string}|null}) {
  const [switching,setSwitching]=useState(false);
  const [approval,approve,approving]=useActionState(approveBrowserLogin,{message:''});
  const [login,signIn,signingIn]=useActionState(signInForCli,{message:''});
  const busy=approving||signingIn;
  return <section className="auth-page">
    <h1>登录汤局 CLI</h1>
    <p>仅在你刚刚从终端发起登录时继续。授权后，终端将以所选账号登录。</p>
    {user&&!switching?<form action={approve} className="form-card form-grid">
      <p>当前账号：<strong>{user.username}</strong></p>
      <input type="hidden" name="id" value={id}/><input type="hidden" name="user" value={user.id}/>
      <label>终端验证码<input name="code" autoComplete="off" spellCheck={false} placeholder="例如 ABCD-EFGH" maxLength={9} disabled={busy}/></label>
      {approval.message&&<p className="error" role="alert">{approval.message}</p>}
      <button className="button" type="submit" name="intent" value="approve" disabled={busy}>{approving?'正在确认…':'确认使用此账号登录'}</button>
      <button type="button" className="button secondary" onClick={()=>setSwitching(true)} disabled={busy}>使用其他账号</button>
      <button type="submit" name="intent" value="deny" className="button secondary" disabled={busy}>取消授权</button>
    </form>:<form action={signIn} className="form-card form-grid">
      <input type="hidden" name="id" value={id}/>
      <label>邮箱或用户名<input name="identity" autoComplete="username" required disabled={busy}/></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" minLength={6} required disabled={busy}/></label>
      {login.message&&<p className="error" role="alert">{login.message}</p>}
      <button className="button" type="submit" disabled={busy}>{signingIn?'正在登录…':'登录并继续确认'}</button>
      {user&&<button type="button" className="button secondary" onClick={()=>setSwitching(false)} disabled={busy}>返回当前账号</button>}
    </form>}
    <p>登录不会加入房间或接管座位。进房后使用现有游戏规则。</p>
    <Link href="/">返回大厅</Link>
  </section>;
}
