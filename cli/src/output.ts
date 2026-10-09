import type { PlayerEnvelope } from '../../src/lib/player-api/protocol.js';
import type { NotifiedResult } from './message-notice.js';
function content(value:unknown):string {
  if(typeof value!=='string')return String(value??'');
  try{const parsed=JSON.parse(value);return typeof parsed.text==='string'?parsed.text:value;}catch{return value;}
}
export function textOutput(result:NotifiedResult):string {
  const text=formatOutput(result),check=result.message_check;
  if(check?.status==='unread')return text+'\n房间有新消息尚未获取，输入 /messages 查看。';
  if(check?.status==='cursor_expired')return text+'\n消息历史已变化，请用 /messages --reset 重新同步；更早历史可能存在缺口。';
  if(check?.status==='unknown')return text+`\n新消息状态暂未确认（${check.reason}），可用 /messages 检查。`;
  return text;
}
function formatOutput(result:PlayerEnvelope):string {
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
  if(Array.isArray(data.facts))return data.facts.length?(data.facts as {text:string;source:string}[]).map(f=>`[${f.source}] ${f.text}`).join('\n'):'当前题目暂无已知事实';
  if(Array.isArray(data.messages)){
    const lines=(data.messages as {sender_name:string;content:unknown}[]).map(m=>`${m.sender_name}: ${content(m.content)}`);
    if(data.cached)lines.push('（本地已保存的最近消息）');
    if(data.timed_out)lines.push('等待结束，暂无变化');
    if(data.poll_incomplete)lines.push('等待时限已到，最后一轮读取未完成；下次继续补拉');
    if(data.state_changed)lines.push('房间状态已变化\n'+textOutput({api_version:1,ok:true,data:data.state,error:null}));
    if(data.history_gap_possible)lines.push('已重建最新快照；更早历史可能存在缺口');
    if(data.visibility_delayed)lines.push('部分新消息仍在等待事务完成');
    if(data.has_more)lines.push('还有消息可继续补拉');
    if(data.previous_cursor)lines.push(`更早历史：/messages --before ${data.previous_cursor}`);
    return lines.length?lines.join('\n'):'暂无新消息';
  }
  const puzzle=data.puzzle as {title:string;surface:string}|null;
  const room=data.room as {code:string;name:string}|undefined;
  const lines:string[]=[];
  if(room){lines.push(`${room.name} · ${room.code}`);lines.push(`当前座位：${data.seat_id}`);}
  if(puzzle)lines.push(`《${puzzle.title}》\n${puzzle.surface}`);else if('puzzle'in data)lines.push('当前没有题目');
  if(data.seat_points!==undefined)lines.push(`座位积分：${data.seat_points} · 提示机会 ${data.hint_tokens}`);
  if(data.personal_points!==undefined)lines.push(`个人积分：${data.personal_points}`);
  if(Array.isArray(data.seats))for(const seat of data.seats as {seat_number:number;nickname:string|null;remaining_points:number;hint_tokens:number}[]){lines.push(`${seat.seat_number}: ${seat.nickname??'空座'} · 积分 ${seat.remaining_points} · 提示机会 ${seat.hint_tokens}`);}
  return lines.length?lines.join('\n'):JSON.stringify(data,null,2);
}
