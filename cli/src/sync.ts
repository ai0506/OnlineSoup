import { api } from './api-client.js';
import type { openSession } from './session.js';
import { failure,success,type PlayerEnvelope } from '../../src/lib/player-api/protocol.js';
type Session=Awaited<ReturnType<typeof openSession>>;
export type Message={id:string;sender_name:string;content:unknown;[key:string]:unknown};
export type Checkpoint={cursor?:string;previous_cursor?:string|null;messages:Message[];fingerprint?:string;has_more?:boolean};
export function checkpoint(s:Session,room:string):Checkpoint {
  s.state.sync??={};return s.state.sync[`${s.state.user_id??'anonymous'}:${room}`]??={messages:[]};
}
export function stateFingerprint(data:Record<string,unknown>):string {
  const room=data.room as Record<string,unknown>|undefined;
  return JSON.stringify({status:room?.status,current_puzzle_id:data.current_puzzle_id,puzzle:data.puzzle,
    seat_id:data.seat_id,seats:data.seats,personal_points:data.personal_points});
}
export async function messagePage(s:Session,room:string,options:Record<string,string|boolean>={},timeoutMs?:number):Promise<PlayerEnvelope<Record<string,unknown>>> {
  const cp=checkpoint(s,room);
  if(options.cached && Object.keys(options).length!==1)throw new Error('INVALID_INPUT');
  if(options.cached)return success({messages:cp.messages,cached:true,next_cursor:cp.cursor??null,previous_cursor:cp.previous_cursor??null,has_more:cp.has_more??false});
  const limit=options.limit??'50';
  if(typeof limit!=='string'||!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limit)|| (options.after && options.before) || (options.reset && (options.after||options.before)))throw new Error('INVALID_INPUT');
  const query=new URLSearchParams({limit});
  const after=typeof options.after==='string'?options.after:(!options.before&&!options.reset?cp.cursor:undefined);
  if(after)query.set('after',after);
  if(typeof options.before==='string')query.set('before',options.before);
  const result=await api(s,`/rooms/${room}/messages?${query}`,undefined,undefined,timeoutMs===undefined?undefined:{timeoutMs,readRetries:0});
  if(!result.ok)return result;
  if(!Array.isArray(result.data?.messages)||typeof result.data.next_cursor!=='string')return failure('CLIENT_TOO_OLD','服务器尚不支持可靠分页，请等待网站更新');
  if(!options.before){
    const batch=result.data.messages as Message[];
    const received=new Set(batch.map(m=>String(m.id)));
    cp.messages=[...(options.reset?[]:cp.messages).filter(m=>!received.has(String(m.id))),...batch].slice(-200);
    cp.cursor=result.data.next_cursor;cp.previous_cursor=result.data.previous_cursor as string|null;cp.has_more=result.data.has_more===true;
    await s.save(); // Persist message bodies and cursor together before returning/output.
  }
  if(options.reset)result.data={...result.data,history_reset:true,history_gap_possible:true};
  return result;
}
export async function waitForChanges(s:Session,room:string,seconds:number):Promise<PlayerEnvelope<Record<string,unknown>>> {
  if(!Number.isInteger(seconds)||seconds<1||seconds>60)throw new Error('INVALID_INPUT');
  const deadline=Date.now()+seconds*1000,cp=checkpoint(s,room);let baseline=cp.fingerprint;
  const all:Message[]=[];let state:Record<string,unknown>|undefined;let changed=false;let page:Record<string,unknown>|undefined;let incomplete=false;
  do {
    if(Date.now()>=deadline)break;
    const current=await api(s,`/rooms/${room}/state`,undefined,undefined,{timeoutMs:Math.max(1,deadline-Date.now()),readRetries:0});
    if(!current.ok){
      if(current.error?.code==='NETWORK_ERROR' && Date.now()>=deadline){incomplete=true;break;}
      return current;
    }
    state=current.data!;const fingerprint=stateFingerprint(state);
    changed=baseline!==undefined && fingerprint!==baseline;baseline??=fingerprint;
    if(cp.fingerprint===undefined)cp.fingerprint=fingerprint;
    do {
      if(Date.now()>=deadline){incomplete=true;break;}
      const result=await messagePage(s,room,{},Math.max(1,deadline-Date.now()));
      if(!result.ok){
        if(result.error?.code==='NETWORK_ERROR' && Date.now()>=deadline){incomplete=true;break;}
        return result;
      }
      page=result.data!;all.push(...page.messages as Message[]);
    }while(page?.has_more && all.length<1000);
    cp.fingerprint=fingerprint;await s.save();
    if(all.length||changed)break;
    const remaining=deadline-Date.now();if(remaining>0)await new Promise(r=>setTimeout(r,Math.min(5000,remaining)));
  }while(Date.now()<deadline);
  return success({messages:all,state:state??null,state_changed:changed,timed_out:!all.length&&!changed,
    next_cursor:cp.cursor??null,previous_cursor:cp.previous_cursor??null,has_more:cp.has_more??false,poll_incomplete:incomplete});
}
