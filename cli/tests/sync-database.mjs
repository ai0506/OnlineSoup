import{Client}from'pg';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';import{performance}from'node:perf_hooks';
const url=process.env.ONLINESOUP_TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Disposable local database required');
const clients=[];const connect=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query("set statement_timeout='8s'");clients.push(c);return c;};
const db=await connect(),reader=await connect(),web=await connect(),slow=await connect();
const ids=[randomUUID(),randomUUID(),randomUUID()],sids=ids.map(()=>randomUUID()),webSid=randomUUID();const rooms=[],puzzles=[];let seat,code,otherCode,passed=0;
const auth=async(c,i,sid=sids[i])=>{await c.query('reset role');await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[i],session_id:sid,role:'authenticated'})]);await c.query('set role authenticated');};
const rpc=async(c,name,args=[]) => (await c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
const webTakeover=async(c,code)=>{const status=await rpc(c,'get_room_takeover_status',[code]);return status.cli_in_use?rpc(c,'confirm_cli_room_takeover',[code,status.session_version]):rpc(c,'take_over_room_session',[code]);};
const check=async(name,fn)=>{await fn();console.log('PASS',name);passed++;};
const reject=(fn,msg)=>assert.rejects(fn,e=>e.message===msg);
const insert=async(c,content,type='chat',puzzle=null)=> (await c.query("insert into public.room_messages(room_id,seat_id,sender_name,sender_seat_number,sender_type,message_type,message_mode,content,puzzle_id) values($1,$2,'Fixture',2,'registered',$3,'chat',$4,$5) returning id::text",[rooms[0],seat,type,content,puzzle])).rows[0].id;
try{
for(let i=0;i<3;i++){await db.query('insert into auth.users(id,email,raw_user_meta_data)values($1,$2,$3)',[ids[i],`${ids[i]}@sync.invalid`,{username:'S'+ids[i].slice(0,6)}]);await db.query('insert into auth.sessions(id,user_id)values($1,$2)',[sids[i],ids[i]]);}
await db.query('insert into auth.sessions(id,user_id)values($1,$2)',[webSid,ids[2]]);
for(let i=0;i<2;i++){await auth(web,i);const value=await rpc(web,'create_room',['同步测试',3,15,null]);if(i===0)code=value;else otherCode=value;rooms.push((await db.query('select id from public.rooms where code=$1',[value])).rows[0].id);}
await rpc(db,'player_register_session',[ids[2],sids[2]]);await auth(reader,2);await rpc(reader,'player_write',['join',code,randomUUID(),{}]);
seat=(await db.query('select id from public.room_seats where room_id=$1 and user_id=$2',[rooms[0],ids[2]])).rows[0].id;
let head=(await rpc(reader,'player_messages',[code])).next_cursor;
await check('late low-ID system transaction is not skipped by a committed website message',async()=>{
await slow.query('begin');const low=await insert(slow,'低 ID 后提交','system');
await auth(web,0);const high=await rpc(web,'send_room_chat_message',[code,'网页先提交']);assert.ok(BigInt(high.id)>BigInt(low));
const during=await rpc(reader,'player_messages',[code,head]);assert.equal(during.messages.length,0);assert.equal(during.visibility_delayed,true);
await slow.query('commit');const after=await rpc(reader,'player_messages',[code,during.next_cursor]);assert.deepEqual(after.messages.map(m=>m.id),[low,String(high.id)]);head=after.next_cursor;
});
await check('500 messages catch up across fixed-watermark pages while new writes continue',async()=>{
await db.query('begin');for(let i=0;i<500;i++)await insert(db,'批次 '+i);await db.query('commit');
let result=await rpc(reader,'player_messages',[code,head,null,73]);assert.equal(result.has_more,true);const all=[...result.messages];
const later=await insert(db,'分页期间的新消息');
while(result.has_more){result=await rpc(reader,'player_messages',[code,result.next_cursor,null,73]);all.push(...result.messages);}
assert.equal(all.length,500);assert.equal(new Set(all.map(m=>m.id)).size,500);assert.ok(!all.some(m=>m.id===later));
result=await rpc(reader,'player_messages',[code,result.next_cursor]);assert.deepEqual(result.messages.map(m=>m.id),[later]);head=result.next_cursor;
});
await check('latest and before navigate retained history without overlap',async()=>{
const latest=await rpc(reader,'player_messages',[code,null,null,30]);assert.equal(latest.messages.length,30);assert.ok(latest.previous_cursor);const older=await rpc(reader,'player_messages',[code,null,latest.previous_cursor,30]);
assert.equal(older.messages.length,30);assert.equal(new Set([...latest.messages,...older.messages].map(m=>m.id)).size,60);assert.equal(older.has_more,true);
});
await check('tampered cursor and invalid page sizes are rejected',async()=>{
await reject(()=>rpc(reader,'player_messages',[code,head.slice(0,-1)+(head.endsWith('0')?'1':'0')]),'INVALID_CURSOR');await reject(()=>rpc(reader,'player_messages',[code,head,head]),'INVALID_INPUT');for(const size of [0,101,null])await reject(()=>rpc(reader,'player_messages',[code,null,null,size]),'INVALID_INPUT');
});
for(let i=0;i<2;i++)puzzles.push((await db.query("insert into public.puzzles(title,surface,bottom,difficulty,key_points,examples)values($1,'汤面','PRIVATE_BOTTOM','简单','[]','[]')returning id",['同步题'+i])).rows[0].id);
await db.query('update public.rooms set current_puzzle_id=$1 where id=$2',[puzzles[0],rooms[0]]);
await check('facts cover >100 messages, deduplicate and isolate puzzle/source/invalid JSON',async()=>{
await insert(db,JSON.stringify({kind:'answer',text:'是',fact_summary:'早期事实',ask_audit:{secret:'PRIVATE_AUDIT'},cache_hit:{private:1}}),'ai',puzzles[0]);
await insert(db,JSON.stringify({kind:'hint',text:'提示',fact_summary:'提示事实'}),'ai',puzzles[0]);
await insert(db,JSON.stringify({kind:'answer',fact_summary:'早期事实'}),'ai',puzzles[0]);
for(const kind of ['reasoning_result','reveal'])await insert(db,JSON.stringify({kind,fact_summary:'不应成为事实'}),'ai',puzzles[0]);
await insert(db,'not json','ai',puzzles[0]);await insert(db,JSON.stringify({kind:'answer',fact_summary:'旧题事实'}),'ai',puzzles[1]);
for(let i=0;i<120;i++)await insert(db,'普通聊天 '+i);
const result=await rpc(reader,'player_facts',[code]);assert.deepEqual(result.facts.map(f=>[f.text,f.source]),[['早期事实','ask'],['提示事实','hint']]);
const state=await rpc(reader,'player_snapshot',[code]);assert.equal(state.current_puzzle_id,puzzles[0]);assert.equal(JSON.stringify(state).includes('PRIVATE_BOTTOM'),false);
const historical=await rpc(reader,'player_messages',[code,null,null,100]);let token=historical.previous_cursor;let all=[...historical.messages];
while(token){const page=await rpc(reader,'player_messages',[code,null,token,100]);all.push(...page.messages);token=page.previous_cursor;}
assert.equal(JSON.stringify(all).includes('PRIVATE_AUDIT'),false);assert.equal(JSON.stringify(all).includes('cache_hit'),false);
await db.query('update public.rooms set current_puzzle_id=$1 where id=$2',[puzzles[1],rooms[0]]);assert.deepEqual((await rpc(reader,'player_facts',[code])).facts.map(f=>f.text),['旧题事实']);
});
await check('hint consumes one point/token; successful reasoning consumes two and publishes the reveal',async()=>{
await db.query('update public.room_seats set hint_tokens=2 where id=$1',[seat]);
const before=await rpc(reader,'player_snapshot',[code]);const own=before.seats.find(s=>s.id===seat);
let request=await rpc(reader,'player_write',['hint',code,randomUUID(),{content:'给个提示',expected_puzzle_id:puzzles[1]}]);
await rpc(db,'finish_room_ai_request',[request.ai_request.request_id,JSON.stringify({kind:'hint',text:'提示文本',fact_summary:'正式提示事实'}),true]);
let state=await rpc(reader,'player_snapshot',[code]);let current=state.seats.find(s=>s.id===seat);assert.equal(current.remaining_points,own.remaining_points-1);assert.equal(current.hint_tokens,1);
await db.query("delete from public.cli_rate_events where subject=$1 and action='ai'",[ids[2]]);await db.query("update public.room_messages set created_at=now()-interval '10 seconds' where room_id=$1 and message_mode in ('ask','hint','reason')",[rooms[0]]);
const cursor=(await rpc(reader,'player_messages',[code])).next_cursor;
request=await rpc(reader,'player_write',['reason',code,randomUUID(),{content:'完整推理',expected_puzzle_id:puzzles[1]}]);
await rpc(db,'finish_room_ai_request',[request.ai_request.request_id,JSON.stringify({kind:'reasoning_result',text:'推理正确',verdict:'推理正确'}),true]);
state=await rpc(reader,'player_snapshot',[code]);current=state.seats.find(s=>s.id===seat);assert.equal(current.remaining_points,own.remaining_points-3);assert.equal(current.hint_tokens,2);assert.equal(state.current_puzzle_id,null);assert.equal(state.puzzle,null);
const feed=await rpc(reader,'player_messages',[code,cursor]);assert.ok(feed.messages.some(m=>m.message_type==='system'));assert.ok(feed.messages.some(m=>m.content.includes('PRIVATE_BOTTOM')&&m.content.includes('reveal')));assert.deepEqual((await rpc(reader,'player_facts',[code])).facts,[]);
});
await check('CLI state/facts/feed do not queue behind the global write gate or refresh idle time',async()=>{
const before=(await db.query('select last_cli_action_at from public.room_seats where id=$1',[seat])).rows[0].last_cli_action_at;
await slow.query('begin');await slow.query('select soup_cli.lock_transaction()');const t=performance.now();
await rpc(reader,'player_snapshot',[code]);await rpc(reader,'player_facts',[code]);await rpc(reader,'player_messages',[code]);assert.ok(performance.now()-t<1000);await slow.query('rollback');
assert.deepEqual((await db.query('select last_cli_action_at from public.room_seats where id=$1',[seat])).rows[0].last_cli_action_at,before);
});
await check('history deletion and edits explicitly expire existing cursors',async()=>{
let cursor=(await rpc(reader,'player_messages',[code])).next_cursor;const id=await insert(db,'待清理');await db.query('delete from public.room_messages where id=$1',[id]);await reject(()=>rpc(reader,'player_messages',[code,cursor]),'CURSOR_EXPIRED');
cursor=(await rpc(reader,'player_messages',[code])).next_cursor;await db.query('update public.room_messages set content=$1 where id=(select min(id) from public.room_messages where room_id=$2)',['编辑后的消息',rooms[0]]);await reject(()=>rpc(reader,'player_messages',[code,cursor]),'CURSOR_EXPIRED');
});
await check('web takeover rejects all CLI reads and never silently restores the seat',async()=>{
await auth(web,2,webSid);await webTakeover(web,code);for(const name of ['player_messages','player_snapshot','player_facts'])await reject(()=>rpc(reader,name,[code]),'ROOM_DEVICE_IN_USE');await rpc(reader,'player_write',['join',code,randomUUID(),{takeover:true}]);
});
await check('signed cursor is bound to the original room',async()=>{
const cursor=(await rpc(reader,'player_messages',[code])).next_cursor;await rpc(reader,'player_write',['leave',code,randomUUID(),{}]);await rpc(reader,'player_write',['join',otherCode,randomUUID(),{}]);await reject(()=>rpc(reader,'player_messages',[otherCode,cursor]),'INVALID_CURSOR');await rpc(reader,'player_write',['leave',otherCode,randomUUID(),{}]);
});
await check('nonmembers, ordinary web sessions and anonymous callers cannot read P1 data',async()=>{
await reject(()=>rpc(reader,'player_messages',[code]),'ROOM_MEMBERSHIP_REQUIRED');await auth(web,2,webSid);await reject(()=>rpc(web,'player_facts',[code]),'CLI_SESSION_REQUIRED');await db.query('set role anon');await assert.rejects(()=>rpc(db,'player_snapshot',[code]),/permission denied/);await db.query('reset role');
});
await check('kicked, idle-removed and closed rooms terminate every P1 read with the precise reason',async()=>{
const denied=async reason=>{for(const name of ['player_messages','player_snapshot','player_facts'])await reject(()=>rpc(reader,name,[code]),reason);};
await rpc(reader,'player_write',['join',code,randomUUID(),{}]);await auth(web,0);await rpc(web,'kick_guest',[code,seat]);await denied('KICKED');
await db.query("delete from public.guest_removals where room_id=$1 and member_key=$2",[rooms[0],'user:'+ids[2]]);await rpc(reader,'player_write',['join',code,randomUUID(),{}]);
await db.query("update public.room_seats set last_cli_action_at=now()-interval '2 hours' where id=$1",[seat]);await rpc(db,'player_cleanup_idle');await denied('IDLE_TIMEOUT');
await rpc(reader,'player_write',['join',code,randomUUID(),{}]);await rpc(web,'close_room',[code]);await denied('ROOM_CLOSED');
});
console.log('P1_DATABASE_TESTS_PASSED',passed);
}catch(e){console.error('P1_DATABASE_FAILURE',e.message,e.where);throw e;}finally{
for(const c of clients)await c.query('rollback').catch(()=>{});await db.query('reset role');await db.query('begin');
await db.query('delete from public.points_transactions where user_id=any($1::uuid[])',[ids]);await db.query('delete from public.rooms where id=any($1::uuid[])',[rooms]);await db.query('delete from public.puzzles where id=any($1::integer[])',[puzzles]);await db.query('delete from auth.sessions where user_id=any($1::uuid[])',[ids]);await db.query('delete from auth.users where id=any($1::uuid[])',[ids]);await db.query('commit');await Promise.all(clients.map(c=>c.end()));
}
