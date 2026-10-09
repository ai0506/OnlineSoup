import { failure } from './protocol';
const aliases: Record<string,string> = {
  authentication_required:'LOGIN_REQUIRED', room_membership_required:'ROOM_MEMBERSHIP_REQUIRED', room_membership_not_found:'ROOM_MEMBERSHIP_REQUIRED',
  insufficient_points:'INSUFFICIENT_PERSONAL_POINTS', insufficient_hint_tokens:'NO_HINT_TOKEN', guest_kicked:'KICKED',
};
const messages: Record<string,string> = {
  LOGIN_REQUIRED:'请先登录', AUTH_EXPIRED:'登录已失效，请用同一账号重新登录', CLI_SESSION_REQUIRED:'请通过 CLI 登录',
  OWNER_NOT_SUPPORTED:'CLI 暂不支持房主，请使用网页', OWNED_ROOM_ACTIVE:'请先在网页处理自己拥有的开放房间',
  ACTIVE_ROOM_EXISTS:'请先离开当前房间', LEAVE_REQUIRED:'请先离开当前房间', ROOM_DEVICE_IN_USE:'座位已由其他设备使用；只有明确接管才能恢复',
  IDLE_TIMEOUT:'长时间无操作，已离开房间，请重新加入', KICKED:'你已被移出房间', ROOM_CLOSED:'房间已关闭',
  WRONG_PASSWORD:'房间密码错误', ROOM_FULL:'房间已满', USERNAME_REQUIRED:'请先到网站设置用户名',
  RATE_LIMITED:'发送太频繁，请稍后重试', ROOM_AI_BUSY:'AI 正在处理其他请求', PUZZLE_CHANGED:'题目已经变化，请重新读取题目',
  REQUEST_KEY_CONFLICT:'请求键已用于不同内容', REQUEST_KEY_EXPIRED:'请求键已过期，不能重新执行', REQUEST_NOT_FOUND:'尚未查到请求，请用原键和原内容重试',
  INSUFFICIENT_SEAT_POINTS:'座位积分不足', INSUFFICIENT_PERSONAL_POINTS:'个人积分不足', NO_HINT_TOKEN:'没有可用提示机会',
};
export function rpcFailure(error: {message:string; details?:string|null}) {
  const raw=error.message.trim();
  const code=aliases[raw] ?? raw.toUpperCase();
  const known=/^[A-Z_]+$/.test(code) && (raw===raw.toLowerCase() || raw===code) && !['INTERNAL_ERROR','ERROR'].includes(code);
  const safe=known ? code : 'SERVER_ERROR';
  const status=['AUTH_EXPIRED','LOGIN_REQUIRED'].includes(safe)?401:['CLI_SESSION_REQUIRED','OWNER_NOT_SUPPORTED','USE_PLAYER_API'].includes(safe)?403:safe==='RATE_LIMITED'||safe==='ROOM_AI_BUSY'?429:safe==='SERVER_ERROR'?500:409;
  return {status, body:failure(safe,messages[safe]??(safe==='SERVER_ERROR'?'服务暂时不可用':safe),safe==='RATE_LIMITED'||safe==='ROOM_AI_BUSY',safe==='RATE_LIMITED'?Number(error.details)||1:undefined)};
}
