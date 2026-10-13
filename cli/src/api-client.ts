import { Agent,fetch } from 'undici';
import type { openSession } from './session.js';
import { failure,type PlayerEnvelope } from '../../src/lib/player-api/protocol.js';
const dispatcher=new Agent({connect:{timeout:10000},headersTimeout:125000,bodyTimeout:125000});
export async function api(session:Awaited<ReturnType<typeof openSession>>,path:string,body?:unknown,key?:string,options?:{timeoutMs?:number;readRetries?:number}):Promise<PlayerEnvelope<Record<string,unknown>>> {
  const url=new URL('/api/v1/player'+path,session.state.origin).href;
  const write=body!==undefined;
  const authTransition=['/login','/browser-login/poll','/logout'].includes(path);
  const attempts=write?1:1+(options?.readRetries??2);
  const deadline=options?.timeoutMs===undefined?undefined:Date.now()+options.timeoutMs;
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const response=await fetch(url,{method:write?'POST':'GET',redirect:'manual',dispatcher,signal:AbortSignal.timeout(deadline===undefined?(write?130000:20000):Math.max(1,deadline-Date.now())),
        headers:{'Content-Type':'application/json','X-OnlineSoup-Version':'1','X-OnlineSoup-Client':'cli',Cookie:session.jar.getCookieStringSync(url),...(key?{'Idempotency-Key':key}:{})},
        ...(write?{body:JSON.stringify(body)}:{})});
      const cookies=response.headers.getSetCookie();
      if(!authTransition){
        for(const cookie of cookies)session.jar.setCookieSync(cookie,url);
        await session.save();
      }
      if(response.status>=500) {
        await response.body?.cancel();
        if(write)return failure('REQUEST_RESULT_UNKNOWN',`操作结果未确认，请用 /request ${key??''} 查询`,true);
        if(attempt<attempts-1){await new Promise(r=>setTimeout(r,500*2**attempt));continue;}
        return failure('SERVER_ERROR','服务暂时不可用',true);
      }
      if(response.status>=300 && response.status<400){await response.body?.cancel();return failure('SERVER_ERROR','服务返回了意外跳转');}
      const data=await response.json() as PlayerEnvelope<Record<string,unknown>>;
      if(data.api_version!==1||typeof data.ok!=='boolean'||!('error'in data)||!('data'in data))throw new Error('INVALID_PROTOCOL');
      if(authTransition&&data.ok){
        if(path==='/login'||(path==='/browser-login/poll'&&data.data?.status==='completed')){
          if(typeof data.data?.user_id!=='string'||typeof data.data.username!=='string')throw new Error('INVALID_PROTOCOL');
          if(session.state.user_id!==data.data.user_id){delete session.state.sync;delete session.state.room;}
          session.state.user_id=data.data.user_id;session.state.username=data.data.username;
        }
        if(path==='/logout'){
          delete session.state.user_id;delete session.state.username;delete session.state.sync;delete session.state.room;delete session.state.browser_login;
        }
        // Commit authentication cookies and their identity/cache boundary in one save.
        for(const cookie of cookies)session.jar.setCookieSync(cookie,url);
        await session.save();
      }
      return data;
    }catch {
      if(write)return failure('REQUEST_RESULT_UNKNOWN',`操作结果未确认，请用 /request ${key??''} 查询`,true);
      if(attempt===attempts-1)return failure('NETWORK_ERROR','连接失败，请稍后重试',true);
      await new Promise(r=>setTimeout(r,500*2**attempt));
    }
  }
  return failure('NETWORK_ERROR','连接失败',true);
}
export async function closeConnections(){await dispatcher.close();}
