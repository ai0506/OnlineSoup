import type { PlayerEnvelope } from '../../src/lib/player-api/protocol.js';
function content(value:unknown):string {
  if(typeof value!=='string')return String(value??'');
  try{const parsed=JSON.parse(value);return typeof parsed.text==='string'?parsed.text:value;}catch{return value;}
}
export function textOutput(result:PlayerEnvelope):string {
  if(!result.ok)return `${result.error!.code}: ${result.error!.message}`;
  const data=result.data as Record<string,unknown>|null;
  if(!data)return '完成';
  if(data.help)return String(data.help);
  if(data.exited)return '已退出，登录和座位已保留。';
  if(data.authenticated!==undefined)return data.authenticated?`已登录：${data.username}`:'已登出';
  if(data.action){
    const prefix=`${data.action} ${data.status} · 请求键 ${data.request_key}`;
    const message=data.ai_message as {content:unknown}|undefined;
    if(message)return `${prefix}\nAI 主持：${content(message.content)}`;
    const chat=data.message as {content:unknown}|undefined;
    if(chat)return `${prefix}\n${content(chat.content)}`;
    return prefix;
  }
  if(Array.isArray(data.messages))return data.messages.map((m:{sender_name:string;content:unknown})=>`${m.sender_name}: ${content(m.content)}`).join('\n')+'\n（最近 100 条）';
  const puzzle=data.puzzle as {title:string;surface:string}|null;
  const room=data.room as {code:string;name:string}|undefined;
  const lines:string[]=[];
  if(room){lines.push(`${room.name} · ${room.code}`);lines.push(`当前座位：${data.seat_id}`);}
  if(puzzle)lines.push(`《${puzzle.title}》\n${puzzle.surface}`);else if('puzzle'in data)lines.push('当前没有题目');
  if(data.personal_points!==undefined)lines.push(`个人积分：${data.personal_points}`);
  if(Array.isArray(data.seats))for(const seat of data.seats as {seat_number:number;nickname:string|null;remaining_points:number;hint_tokens:number}[]){lines.push(`${seat.seat_number}: ${seat.nickname??'空座'} · 积分 ${seat.remaining_points} · 提示机会 ${seat.hint_tokens}`);}
  return lines.length?lines.join('\n'):JSON.stringify(data,null,2);
}
