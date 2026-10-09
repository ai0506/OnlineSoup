import { createHash,randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { openSession } from './session.js';
import { api } from './api-client.js';
import { failure,success,type PlayerEnvelope } from '../../src/lib/player-api/protocol.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function browserLogin(s:Awaited<ReturnType<typeof openSession>>,options:Record<string,string|boolean>,json:boolean):Promise<PlayerEnvelope> {
  if(s.state.browser_login&&s.state.browser_login.expires_at<=Date.now()){delete s.state.browser_login;await s.save();}
  if(!s.state.browser_login){
    const secret=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    const started=await api(s,'/browser-login/start',{secret,challenge:hash(verifier),...(s.state.room?{previous_user_id:s.state.user_id}:{})});
    if(!started.ok)return started;
    const data=started.data!;
    if(typeof data.id!=='string'||!/^[0-9a-f-]{36}$/.test(data.id)||typeof data.user_code!=='string'||!/^[A-Z2-9]{8}$/.test(data.user_code))return failure('SERVER_ERROR','登录响应格式不正确');
    s.state.browser_login={id:data.id,secret,verifier,user_code:data.user_code,expires_at:Date.now()+Math.min(Number(data.expires_in)||300,300)*1000};await s.save();
  }
  const pending=s.state.browser_login;
  const url=new URL('/auth/cli',s.state.origin);url.searchParams.set('id',pending.id);
  const code=pending.user_code.slice(0,4)+'-'+pending.user_code.slice(4);
  if(process.stdin.isTTY&&!options['no-browser']){
    const executable=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';
    const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url.href]:[url.href];
    await new Promise<void>(resolve=>execFile(executable,args,{timeout:3000},()=>resolve()));
  }
  if(json&&!options.wait)return success({status:'authorization_required',verification_uri:url.href,user_code:code,expires_at:pending.expires_at,next_command:'/login --wait'});
  process.stderr.write(`请在浏览器确认账号：${url.href}\n终端验证码：${code}\n等待授权（5 分钟内有效）；Ctrl+C 后可再次 /login 恢复。\n`);
  const payload={id:pending.id,secret:pending.secret,verifier:pending.verifier};
  while(Date.now()<pending.expires_at){
    const result=await api(s,'/browser-login/poll',payload);
    if(!result.ok){
      if(['REQUEST_RESULT_UNKNOWN','NETWORK_ERROR','SERVER_ERROR'].includes(result.error?.code??'')){await new Promise(r=>setTimeout(r,3000));continue;}
      return result;
    }
    const data=result.data!;
    if(data.status==='completed'){
      if(s.state.user_id!==data.user_id){delete s.state.sync;delete s.state.room;}
      s.state.user_id=String(data.user_id);s.state.username=String(data.username);
      delete s.state.browser_login;await s.save();
      await api(s,'/browser-login/ack',payload);
      return success({authenticated:true,user_id:s.state.user_id,username:s.state.username});
    }
    if(['denied','expired','failed','consumed'].includes(String(data.status))){delete s.state.browser_login;await s.save();return failure('BROWSER_LOGIN_CANCELLED',data.status==='denied'?'已取消网页登录':'登录请求已失效，请重新 /login');}
    await new Promise(r=>setTimeout(r,3000));
  }
  delete s.state.browser_login;await s.save();return failure('BROWSER_LOGIN_EXPIRED','网页授权已过期，请重新 /login');
}
