import { api } from './api-client.js';
import { checkpoint } from './sync.js';
import type { Command } from './parser.js';
import type { openSession } from './session.js';
import type { PlayerEnvelope } from '../../src/lib/player-api/protocol.js';

type Session=Awaited<ReturnType<typeof openSession>>;
export type MessageCheck={status:'unread'|'caught_up'|'unknown'|'cursor_expired';has_unread:boolean|null;next_command?:string;reason?:string};
export type NotifiedResult=PlayerEnvelope & {message_check?:MessageCheck};
const commands=new Set(['join','leave','say','ask','hint','reason','state','puzzle','facts','seats','points','request']);
const stopErrors=new Set(['LOGIN_REQUIRED','CLI_SESSION_REQUIRED','AUTH_EXPIRED','ROOM_DEVICE_IN_USE','IDLE_TIMEOUT','KICKED','ROOM_CLOSED','ROOM_NOT_FOUND','ROOM_MEMBERSHIP_REQUIRED']);
function messageId(value:unknown):string|undefined {
  if(typeof value==='string'&&/^\d+$/.test(value))return value;
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return String(value);
}

export async function withMessageCheck(s:Session,command:Command,result:PlayerEnvelope):Promise<NotifiedResult> {
  const room=s.state.room;
  if(!room||!s.state.user_id||stopErrors.has(result.error?.code??'')||
    (!commands.has(command.name)&&!(command.name==='messages'&&command.options.before)))return result;
  const unknown=(reason:string):NotifiedResult=>({...result,message_check:{status:'unknown',has_unread:null,reason,next_command:'/messages'}});
  try {
    const cp=checkpoint(s,room);
    const seen=new Set(cp.displayed_message_ids??[]);
    const data=result.data as Record<string,unknown>|null;
    // These bodies were already shown in the write/request response, but never advance the feed cursor.
    if(result.ok&&data?.room_code===room){
      for(const id of [data.request_message_id,(data.message as {id?:unknown}|undefined)?.id,(data.ai_message as {id?:unknown}|undefined)?.id]){
        const value=messageId(id);if(value)seen.add(value);
      }
      cp.displayed_message_ids=[...seen].slice(-200);await s.save();
    }
    const query=new URLSearchParams({limit:'100'});if(cp.cursor)query.set('after',cp.cursor);
    const check=await api(s,`/rooms/${room}/messages?${query}`,undefined,undefined,{timeoutMs:2000,readRetries:0});
    if(!check.ok){
      if(check.error?.code==='CURSOR_EXPIRED')return {...result,message_check:{status:'cursor_expired',has_unread:null,reason:'CURSOR_EXPIRED',next_command:'/messages --reset'}};
      return unknown(check.error?.code??'SERVER_ERROR');
    }
    if(!Array.isArray(check.data?.messages)||typeof check.data.next_cursor!=='string')return unknown('INVALID_PROTOCOL');
    const unread=check.data.messages.some((m:{id?:unknown})=>!seen.has(messageId(m.id)??''));
    if(unread)return {...result,message_check:{status:'unread',has_unread:true,next_command:'/messages'}};
    if(check.data.has_more||(!cp.cursor&&check.data.previous_cursor))return unknown('MORE_MESSAGES');
    if(check.data.visibility_delayed)return unknown('VISIBILITY_DELAYED');
    return {...result,message_check:{status:'caught_up',has_unread:false}};
  }catch{return unknown('CHECK_FAILED');}
}
