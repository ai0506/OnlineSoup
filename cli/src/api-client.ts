import { Agent,fetch } from 'undici';
import type { openSession } from './session.js';
import { failure,type PlayerEnvelope } from '../../src/lib/player-api/protocol.js';
const dispatcher=new Agent({connect:{timeout:10000},headersTimeout:125000,bodyTimeout:125000});
export async function api(session:Awaited<ReturnType<typeof openSession>>,path:string,body?:unknown,key?:string,options?:{timeoutMs?:number;readRetries?:number}):Promise<PlayerEnvelope<Record<string,unknown>>> {
  const url=new URL('/api/v1/player'+path,session.state.origin).href;
  const write=body!==undefined;
  const attempts=write?1:1+(options?.readRetries??2);
  const deadline=options?.timeoutMs===undefined?undefined:Date.now()+options.timeoutMs;
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const response=await fetch(url,{method:write?'POST':'GET',redirect:'manual',dispatcher,signal:AbortSignal.timeout(deadline===undefined?(write?130000:20000):Math.max(1,deadline-Date.now())),
        headers:{'Content-Type':'application/json','X-OnlineSoup-Version':'1','X-OnlineSoup-Client':'cli',Cookie:session.jar.getCookieStringSync(url),...(key?{'Idempotency-Key':key}:{})},
        ...(write?{body:JSON.stringify(body)}:{})});
      for(const cookie of response.headers.getSetCookie())session.jar.setCookieSync(cookie,url);
      await session.save();
      if(response.status>=500) {
        await response.body?.cancel();
        if(write)return failure('REQUEST_RESULT_UNKNOWN',`操作结果未确认，请用 /request ${key??''} 查询`,true);
        if(attempt<attempts-1){await new Promise(r=>setTimeout(r,500*2**attempt));continue;}
        return failure('SERVER_ERROR','服务暂时不可用',true);
      }
      if(response.status>=300 && response.status<400){await response.body?.cancel();return failure('SERVER_ERROR','服务返回了意外跳转');}
      const data=await response.json() as PlayerEnvelope<Record<string,unknown>>;
      if(data.api_version!==1||typeof data.ok!=='boolean'||!('error'in data)||!('data'in data))throw new Error('INVALID_PROTOCOL');
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
