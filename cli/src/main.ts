#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parse,tokenize,parseLine,inputErrorDetail,type Command } from './parser.js';
import { openSession,type Pending } from './session.js';
import { api,closeConnections } from './api-client.js';
import { checkpoint,messagePage,stateFingerprint,waitForChanges } from './sync.js';
import { browserLogin } from './browser-login.js';
import { readCredentials } from './credentials.js';
import { withMessageCheck,type NotifiedResult } from './message-notice.js';
import { textOutput } from './output.js';
import { success,failure,exitCode,type PlayerEnvelope } from '../../src/lib/player-api/protocol.js';

const help=`OnlineSoup CLI（协议 1）
/login [--no-browser]  浏览器登录；--json 返回链接，/login --wait 等待确认
/login USERNAME_OR_EMAIL  密码从终端隐藏输入或 --password-stdin 读取
/login --credentials-file FILE  从私有 JSON 文件读取 identity 和 password
/join CODE [--takeover] [--request-key UUID]  密码房隐藏输入或 --password-stdin
/state（或 /room） /puzzle /facts /seats /points
/messages [--after CURSOR | --before CURSOR] [--limit 1-100]
  默认从本地游标补拉；--reset 重建最新快照，--cached 查看已落盘的最近消息
/wait [--timeout 1-60]  默认 30 秒，约每 5 秒观察变化
/say TEXT  /ask TEXT  /hint [TEXT]  /reason TEXT
  写入可带 --request-key UUID；付费指令可带 --use-personal-points
/request UUID  /leave  /logout  /exit
房间操作后自动检查新消息并提醒；/messages 获取正文，提醒不推进游标。
普通文字直接聊天；//help 发送字面 /help；-- 后的内容按原文处理。
全局：--json、--password-stdin；ONLINESOUP_HOME 隔离本地身份。
ONLINESOUP_URL 默认 https://onlinesoup.ai0506.com，只允许 HTTPS 或本机 HTTP。`;
let json=false,passwordStdin=false,stopping=false;
let session:Awaited<ReturnType<typeof openSession>>|undefined;
function output(result:NotifiedResult) {
  process.exitCode=exitCode(result.error?.code);
  if(json)process.stdout.write(JSON.stringify(result)+'\n');
  else (result.ok?process.stdout:process.stderr).write(textOutput(result)+'\n');
}
async function password():Promise<string> {
  if(passwordStdin){let value='';for await(const chunk of process.stdin)value+=chunk;return value.replace(/^\uFEFF/,'').replace(/[\r\n]+$/,'');}
  if(!process.stdin.isTTY)throw new Error('REQUIRED_INPUT_MISSING');
  process.stderr.write('密码: ');process.stdin.setRawMode(true);process.stdin.resume();
  try{return await new Promise<string>((resolve,reject)=>{
    let value='';const listener=(chunk:Buffer)=>{for(const c of chunk.toString('utf8')){
      if(c==='\r'||c==='\n'){process.stdin.off('data',listener);resolve(value);return;}
      if(c==='\u0003'){process.stdin.off('data',listener);reject(new Error('INPUT_CANCELLED'));return;}
      if(c==='\u007f'||c==='\b')value=[...value].slice(0,-1).join('');else if(c>=' ')value+=c;
    }};process.stdin.on('data',listener);
  });}finally{process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');}
}
const contentLimits:Record<string,number>={say:300,ask:100,hint:50,reason:300};
const invalidRooms=new Set(['IDLE_TIMEOUT','KICKED','ROOM_CLOSED','ROOM_NOT_FOUND','ROOM_MEMBERSHIP_REQUIRED']);
async function execute(command:Command):Promise<PlayerEnvelope> {
  const {name,text,options}=command;
  if(name==='help')return success({help});
  if(name==='exit'){stopping=true;return success({exited:true,session_preserved:true});}
  const s=session!;
  if(name==='login') {
    if(/\s/.test(text)||(text&&Object.keys(options).length))throw new Error('INVALID_INPUT');
    const credentialsFile=options['credentials-file'];
    if(credentialsFile!==undefined&&(typeof credentialsFile!=='string'||!credentialsFile||passwordStdin||Object.keys(options).length!==1))throw new Error('INVALID_INPUT');
    if(s.state.room) {
      const current=await api(s,'/session');
      if(current.ok&&current.data?.authenticated) {
        const member=await api(s,`/rooms/${s.state.room}/state`);
        if(member.ok)return failure('LEAVE_REQUIRED','请先离开当前房间');
        if(!invalidRooms.has(member.error?.code??'')&&member.error?.code!=='ROOM_DEVICE_IN_USE')return member;
        delete s.state.room;
      }else if(!current.ok && !['AUTH_EXPIRED','LOGIN_REQUIRED'].includes(current.error?.code??''))return current;
    }
    if(!text&&!credentialsFile)return browserLogin(s,options,json);
    const credentials=typeof credentialsFile==='string'?await readCredentials(credentialsFile):{identity:text,password:await password()};
    const result=await api(s,'/login',{...credentials,...(s.state.room?{previous_user_id:s.state.user_id}:{})});
    if(result.ok){delete s.state.browser_login;if(s.state.user_id!==result.data!.user_id)delete s.state.sync;s.state.user_id=String(result.data!.user_id);s.state.username=String(result.data!.username);await s.save();}
    return result;
  }
  if(name==='logout') {
    if(s.state.room){const status=await api(s,`/rooms/${s.state.room}/state`);
      if(status.ok)return failure('LEAVE_REQUIRED','请先离开当前房间');
      if(!invalidRooms.has(status.error?.code??'')&&status.error?.code!=='ROOM_DEVICE_IN_USE')return status;
      delete s.state.room;
    }
    const result=await api(s,'/logout',{});
    if(result.ok){delete s.state.browser_login;delete s.state.user_id;delete s.state.username;delete s.state.sync;await s.save();}return result;
  }
  if(name==='request') {
    if(!/^[0-9a-f-]{36}$/i.test(text))throw new Error('INVALID_INPUT');
    const result=await api(s,`/requests/${text}`);
    if(result.ok){
      const pending=s.state.pending[text];
      if(pending && result.data?.status==='completed'){
        if(pending.action==='join')s.state.room=pending.room;
        if(pending.action==='leave'&&s.state.room===pending.room)delete s.state.room;
      }
      if(['completed','refunded','expired'].includes(String(result.data?.status)))delete s.state.pending[text];
      await s.save();
    }
    return result;
  }
  const room=name==='join'?text.trim().toUpperCase():s.state.room;
  if(!room)return failure('ROOM_MEMBERSHIP_REQUIRED','请先 /join CODE');
  if(!/^[A-Z0-9]{6}$/.test(room))throw new Error('INVALID_INPUT');
  if(['state','puzzle','facts','seats','points','messages','wait'].includes(name)) {
    if(text)throw new Error('INVALID_INPUT');
    let result:PlayerEnvelope<Record<string,unknown>>;
    if(name==='messages')result=await messagePage(s,room,options);
    else if(name==='wait'){
      const timeout=options.timeout??'30';if(typeof timeout!=='string'||!/^\d+$/.test(timeout))throw new Error('INVALID_INPUT');
      result=await waitForChanges(s,room,Number(timeout));
    }else result=await api(s,`/rooms/${room}/${name==='facts'?'facts':'state'}`);
    if(invalidRooms.has(result.error?.code??'')){delete s.state.room;await s.save();}
    if(result.ok && ['state','puzzle','seats','points'].includes(name)){
      checkpoint(s,room).fingerprint=stateFingerprint(result.data!);await s.save();
      if(name==='puzzle')return success({puzzle:result.data!.puzzle});
      if(name==='seats')return success({seats:result.data!.seats,seat_id:result.data!.seat_id});
      if(name==='points'){
        const own=(result.data!.seats as {id:string;remaining_points:number;hint_tokens:number}[]).find(seat=>seat.id===result.data!.seat_id);
        return success({seat_points:own?.remaining_points??null,hint_tokens:own?.hint_tokens??null,personal_points:result.data!.personal_points});
      }
    }
    return result;
  }
  if(!['join','leave','say','ask','hint','reason'].includes(name))throw new Error('INVALID_COMMAND');
  const key=typeof options['request-key']==='string'?options['request-key']:randomUUID();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))throw new Error('INVALID_INPUT');
  const old=s.state.pending[key];
  if(old?.user_id && old.user_id!==s.state.user_id)return failure('REQUEST_KEY_CONFLICT','该本地请求键属于另一个账号');
  if(old?.created_at && old.created_at<Date.now()-7*24*60*60*1000)return failure("REQUEST_KEY_EXPIRED","本地请求键已超过 7 天，不再重提交");
  let payload:Record<string,unknown>={};
  if(name==='join') {
    payload={takeover:options.takeover===true};
    const info=await api(s,`/rooms/${room}/join-info`);if(!info.ok)return info;
    let restored=false;
    if(!old && s.state.room===room && !passwordStdin)restored=(await api(s,`/rooms/${room}/state`)).ok;
    if(old?.password_required || (info.data?.requires_password && !restored))payload.password=await password();
  }
  if(['say','ask','hint','reason'].includes(name)){
    const content=name==='hint'&&!text?'请给我一个提示':text;if(!content.trim())throw new Error('REQUIRED_INPUT_MISSING');
    const limit=contentLimits[name],length=content.trim().length;
    if(length>limit)return failure('INVALID_INPUT',`内容超过 ${limit} 字上限（当前 ${length} 字）`);
    payload={content};
    if(name!=='say') {
      if(old)payload={...old.payload,content,use_personal_points:options['use-personal-points']===true};
      else{
        const current=await api(s,`/rooms/${room}/state`);if(!current.ok)return current;
        const puzzle=current.data?.puzzle as {id:number}|null;
        if(!puzzle)return failure('NO_ACTIVE_PUZZLE','房间尚未开始题目');
        payload={content,message_mode:name,use_personal_points:options['use-personal-points']===true,expected_puzzle_id:puzzle.id};
      }
    }
  }
  if(old&&(old.action!==name||old.room!==room||JSON.stringify(old.payload)!==JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='password')))))return failure('REQUEST_KEY_CONFLICT','原请求内容不同，请使用原内容恢复');
  if(old?.password_required&&!payload.password)return failure('REQUIRED_INPUT_MISSING','请重新提供房间密码并沿用原请求键');
  const pending:Pending={key,action:name,room,user_id:s.state.user_id,created_at:old?.created_at??Date.now(),payload:Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='password')),...(payload.password?{password_required:true}:{})};
  s.state.pending[key]=pending;await s.save();
  const path=name==='say'?'messages':['ask','hint','reason'].includes(name)?'ask':name;
  const result=await api(s,`/rooms/${room}/${path}`,payload,key);
  if(result.ok && result.data?.status==='completed'){
    if(name==='join')s.state.room=room;
    if(name==='leave')delete s.state.room;
  }
  if(['completed','refunded','expired'].includes(String(result.data?.status)))delete s.state.pending[key];
  if(invalidRooms.has(result.error?.code??''))delete s.state.room;
  await s.save();
  if(result.error?.code==='REQUEST_RESULT_UNKNOWN')result.error.message+=`（原请求键 ${key}）`;
  return result;
}
async function executeAndCheck(command:Command):Promise<NotifiedResult> {
  return withMessageCheck(session!,command,await execute(command));
}
async function main() {
  const args=process.argv.slice(2);
  // Only leading global options are consumed; chat text can contain --json.
  while(args[0]==='--json'||args[0]==='--password-stdin'){
    if(args.shift()==='--json')json=true;else passwordStdin=true;
  }
  const origin=new URL(process.env.ONLINESOUP_URL??'https://onlinesoup.ai0506.com');
  if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw new Error('UNSAFE_SERVER_URL');
  if(args[0]==='/help'){output(success({help}));return;}
  session=await openSession(origin.origin);
  if(args.length){output(await executeAndCheck(parse(args.length===1&&args[0].startsWith('/')&&args[0].includes(' ')?tokenize(args[0]):args)));return;}
  if(json||!process.stdin.isTTY){output(failure('REQUIRED_INPUT_MISSING','非交互调用需要命令'));return;}
  process.stderr.write('OnlineSoup CLI。/help 查看命令，/exit 保留座位并退出。\n');
  while(!stopping){
    const input=createInterface({input:process.stdin,output:process.stderr});
    let line:string;try{line=await input.question('soup> ');}catch{break;}finally{input.close();}
    if(!line.trim())continue;
    try{output(await executeAndCheck(parseLine(line)));}catch(e){output(failure((e as Error).message,inputErrorDetail(e)??'请检查命令或输入'));}
  }
}
try{await main();}catch(e){output(failure((e as Error).message,inputErrorDetail(e)??'操作未完成，请检查命令、权限或会话目录'));}
finally{await session?.close();await closeConnections();}
