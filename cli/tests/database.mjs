// Run only against a disposable local database with the project migrations.
import {Client} from 'pg';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
const url=process.env.ONLINESOUP_TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('A disposable local PostgreSQL URL is required');
const connect=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query("set statement_timeout='8s'");return c;};
const db=await connect();const connections=[db];let passed=0;
const check=(name,fn)=>async()=>{await fn();passed++;console.log('PASS',name);};
const ids={owner:randomUUID(),member:randomUUID(),other:randomUUID()};const sessions={owner:randomUUID(),member:randomUUID(),other:randomUUID(),web:randomUUID()};
const auth=async(c,user,session,role='authenticated')=>{await c.query('reset role');await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:session,role})]);await c.query('set role '+role);};
const rpc=async(c,fn,args=[]) => (await c.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0].v;
const webTakeover=async(c,code)=>{const status=await rpc(c,'get_room_takeover_status',[code]);return status.cli_in_use?rpc(c,'confirm_cli_room_takeover',[code,status.session_version]):rpc(c,'take_over_room_session',[code]);};
const register=async(c,u,s)=>{await c.query('reset role');await rpc(c,'player_register_session',[u,s]);await auth(c,u,s);};
const write=(c,action,key,payload={},room=code)=>rpc(c,'player_write',[action,room,key,payload]);
const reject=async(fn,expected)=>assert.rejects(fn,e=>e.message===expected);
let code,roomId,seatId,puzzleId,requestId,otherCode,otherRoomId;
try{
await db.query('begin');
for(const [name,id]of Object.entries(ids))await db.query('insert into auth.users(id,email,raw_user_meta_data)values($1,$2,$3)',[id,name+'@fixture.invalid',{username:'T'+name}]);
for(const[name,id]of Object.entries(sessions))await db.query('insert into auth.sessions(id,user_id)values($1,$2)',[id,ids[name]??ids.member]);
await db.query('grant usage on schema public to authenticated,anon; grant select on public.profiles to authenticated');
await auth(db,ids.owner,sessions.owner);code=await rpc(db,'create_room',['CLI测试',3,15,'123456']);
await db.query('reset role');roomId=(await db.query('select id from public.rooms where code=$1',[code])).rows[0].id;
puzzleId=(await db.query("insert into public.puzzles(title,surface,bottom,difficulty,key_points,examples)values('CLI测试题','一杯水。','未公开汤底','简单','[]','[]')returning id")).rows[0].id;
await db.query('update public.rooms set current_puzzle_id=$1 where id=$2',[puzzleId,roomId]);await db.query('commit');
await auth(db,ids.other,sessions.other);otherCode=await rpc(db,'create_room',['另一个房间',2,5,null]);await db.query('reset role');otherRoomId=(await db.query('select id from public.rooms where code=$1',[otherCode])).rows[0].id;
await register(db,ids.other,sessions.other);
await check('owned open room rejects first CLI join without implicitly closing it',async()=>{
await reject(()=>write(db,'join',randomUUID(),{password:'123456'}),'OWNED_ROOM_ACTIVE');await db.query('reset role');assert.equal((await db.query('select status from public.rooms where id=$1',[otherRoomId])).rows[0].status,'waiting');
})();
await auth(db,ids.member,sessions.member);await register(db,ids.member,sessions.member);
await check('web sessions cannot use player RPC',async()=>{await auth(db,ids.member,sessions.web);await reject(()=>rpc(db,'player_session'),'CLI_SESSION_REQUIRED');await auth(db,ids.member,sessions.member);})();
await check('wrong password changes nothing',async()=>{await reject(()=>write(db,'join',randomUUID(),{password:'999999'}),'WRONG_PASSWORD');})();
const joinKey=randomUUID();let joined=await write(db,'join',joinKey,{password:'123456'});seatId=joined.seat_id;
await check('join key replay retains same seat',async()=>assert.equal((await write(db,'join',joinKey,{password:'123456'})).seat_id,seatId))();
await check('key content conflict',async()=>reject(()=>write(db,'join',joinKey,{password:'654321'}),'REQUEST_KEY_CONFLICT'))();
await check('active membership rejects cross-room join',async()=>reject(()=>write(db,'join',randomUUID(),{},otherCode),'ACTIVE_ROOM_EXISTS'))();
await check('full room rejects new registered member; kicked member cannot rejoin',async()=>{
await db.query('reset role');const empty=(await db.query('select id from public.room_seats where room_id=$1 and nickname is null',[roomId])).rows[0].id;
await db.query("update public.room_seats set nickname='Fixture',occupied_at=now() where id=$1",[empty]);
// The other fixture account owns a room: remove its owner seat only in this test,
// close that disposable room, then prove ROOM_FULL for a genuine new player.
await db.query("update public.rooms set status='closed' where id=$1",[otherRoomId]);await auth(db,ids.other,sessions.other);await reject(()=>write(db,'join',randomUUID(),{password:'123456'}),'ROOM_FULL');
await db.query('reset role');await db.query('update public.room_seats set nickname=null,occupied_at=null where id=$1',[empty]);await db.query("update public.rooms set status='waiting' where id=$1",[otherRoomId]);
await auth(db,ids.owner,sessions.owner);await rpc(db,'kick_guest',[code,seatId]);await auth(db,ids.member,sessions.member);await reject(()=>write(db,'join',randomUUID(),{password:'123456'}),'KICKED');
await db.query('reset role');await db.query("delete from public.guest_removals where room_id=$1 and member_key=$2",[roomId,'user:'+ids.member]);await auth(db,ids.member,sessions.member);await write(db,'join',randomUUID(),{password:'123456'});
})();
await check('CLI old RPCs are blocked',async()=>{for(const fn of ['join_room_as_member','take_over_room_session','leave_room_as_member','close_room'])await reject(()=>rpc(db,fn,[code]),'USE_PLAYER_API');await reject(()=>rpc(db,'send_room_chat_message',[code,'绕过']),'USE_PLAYER_API');})();
const sayKey=randomUUID();
await check('same-key concurrent sends insert once',async()=>{
const c2=await connect();connections.push(c2);await auth(c2,ids.member,sessions.member);
const results=await Promise.all([write(db,'say',sayKey,{content:'测试并发'}),write(c2,'say',sayKey,{content:'测试并发'})]);assert.equal(results[0].message.id,results[1].message.id);
})();
await check('rate limit shared across keys',async()=>reject(()=>write(db,'say',randomUUID(),{content:'太快'}),'RATE_LIMITED'))();
await check('paid request mismatch does not charge',async()=>reject(()=>write(db,'ask',randomUUID(),{content:'是吗？',expected_puzzle_id:puzzleId+1}),'PUZZLE_CHANGED'))();
const askKey=randomUUID();const ai=await write(db,'ask',askKey,{content:'是吗？',expected_puzzle_id:puzzleId});requestId=ai.ai_request.request_id;
await check('admin nickname repair preserves membership, idle timer and pending AI',async()=>{
await db.query('reset role');
const before=(await db.query('select membership_id,last_cli_action_at from public.room_seats where id=$1',[seatId])).rows[0];
await db.query('update public.profiles set username=null where id=$1',[ids.member]);
await db.query("select set_config('request.jwt.claim.role','service_role',false)");
await db.query('set role service_role');await rpc(db,'admin_set_username',[ids.member,'RenameT']);await db.query('reset role');
const after=(await db.query('select membership_id,last_cli_action_at from public.room_seats where id=$1',[seatId])).rows[0];
assert.deepEqual(after,before);assert.equal((await db.query('select status from public.room_ai_requests where request_message_id=$1',[requestId])).rows[0].status,'pending');
await auth(db,ids.member,sessions.member);
})();
await check('AI replay does not dispatch or debit twice',async()=>{const replay=await write(db,'ask',askKey,{content:'是吗？',expected_puzzle_id:puzzleId});assert.equal(replay.execute_ai,false);assert.equal(replay.status,'pending');})();
await check('busy room rejects without another debit',async()=>reject(()=>write(db,'ask',randomUUID(),{content:'另一个？',expected_puzzle_id:puzzleId}),'RATE_LIMITED'))();
await check('explicit website takeover displaces CLI without losing request',async()=>{await auth(db,ids.member,sessions.web);await webTakeover(db,code);await auth(db,ids.member,sessions.member);await reject(()=>rpc(db,'player_read',['state',code]),'room_device_in_use');const result=await rpc(db,'player_read',['request',null,askKey]);assert.equal(result.status,'pending');assert.equal(result.ai_message,null);await reject(()=>write(db,'join',randomUUID(),{}),'ROOM_DEVICE_IN_USE');})();
await check('explicit CLI takeover restores same seat',async()=>assert.equal((await write(db,'join',randomUUID(),{takeover:true})).seat_id,seatId))();
await check('expiry reconcile refunds exactly once',async()=>{
await db.query('reset role');await db.query("update public.room_ai_requests set lease_expires_at=now()-interval '1 second' where request_message_id=$1",[requestId]);
await auth(db,ids.member,sessions.member);assert.equal((await rpc(db,'player_read',['request',null,askKey])).status,'refunded');assert.equal((await rpc(db,'player_read',['request',null,askKey])).status,'refunded');
await db.query('reset role');assert.equal((await db.query('select remaining_points from public.room_seats where id=$1',[seatId])).rows[0].remaining_points,15);await auth(db,ids.member,sessions.member);
})();
await check('leave replay cannot clear a later membership',async()=>{
const key=randomUUID();await write(db,'leave',key);await write(db,'join',randomUUID(),{password:'123456'});await write(db,'leave',key);const state=await rpc(db,'player_read',['state',code]);assert.equal(state.seat_id,seatId);
})();
await check('idle candidate taken over by web is retained; CLI idle releases and rejoin clears reason',async()=>{
await db.query('reset role');await db.query("update public.room_seats set last_cli_action_at=now()-interval '2 hours' where id=$1",[seatId]);
await auth(db,ids.member,sessions.web);await webTakeover(db,code);await db.query('reset role');assert.equal(await rpc(db,'player_cleanup_idle'),0);
await auth(db,ids.member,sessions.member);await write(db,'join',randomUUID(),{takeover:true});await db.query('reset role');await db.query("update public.room_seats set last_cli_action_at=now()-interval '2 hours' where id=$1",[seatId]);assert.equal(await rpc(db,'player_cleanup_idle'),1);
await auth(db,ids.member,sessions.member);await reject(()=>rpc(db,'player_read',['state',code]),'IDLE_TIMEOUT');await write(db,'join',randomUUID(),{password:'123456'});assert.ok(await rpc(db,'player_read',['state',code]));
})();
await check('website rejoin clears old idle reason even after website leave',async()=>{
await db.query('reset role');await db.query("update public.room_seats set last_cli_action_at=now()-interval '2 hours' where id=$1",[seatId]);assert.equal(await rpc(db,'player_cleanup_idle'),1);
await auth(db,ids.member,sessions.web);await rpc(db,'join_room_as_member',[code,'123456']);await rpc(db,'leave_room_as_member',[code]);
await auth(db,ids.member,sessions.member);await reject(()=>rpc(db,'player_read',['state',code]),'room_membership_required');await write(db,'join',randomUUID(),{password:'123456'});
})();
await check('pending AI survives cleanup, stale lease is refunded before releasing seat',async()=>{
await db.query('reset role');await db.query("delete from public.cli_rate_events where subject=$1 and action='ai'",[ids.member]);await db.query("update public.room_messages set created_at=now()-interval '10 seconds' where room_id=$1",[roomId]);await auth(db,ids.member,sessions.member);
const key=randomUUID();const request=await write(db,'ask',key,{content:'会退款吗？',expected_puzzle_id:puzzleId});
await db.query('reset role');await db.query("update public.room_seats set last_cli_action_at=now()-interval '2 hours' where id=$1",[seatId]);
assert.equal(await rpc(db,'player_cleanup_idle'),0);
await db.query("update public.room_ai_requests set lease_expires_at=now()-interval '1 second' where request_message_id=$1",[request.ai_request.request_id]);
const parallel=await connect();connections.push(parallel);
const outputs=await Promise.all([rpc(db,'player_cleanup_idle'),rpc(parallel,'reconcile_stale_room_ai_requests',[roomId]),rpc(db,'finish_room_ai_request',[request.ai_request.request_id,'',false])]);
assert.equal(outputs[0],1);assert.equal((await db.query('select remaining_points from public.room_seats where id=$1',[seatId])).rows[0].remaining_points,15);
await auth(db,ids.member,sessions.member);assert.equal((await rpc(db,'player_read',['request',null,key])).status,'refunded');
await write(db,'join',randomUUID(),{password:'123456'});
})();
await check('completed replies strip internal audit',async()=>{
await db.query('reset role');await db.query("delete from public.cli_rate_events where subject=$1 and action='ai'",[ids.member]);await db.query("update public.room_messages set created_at=now()-interval '10 seconds' where room_id=$1 and message_mode in ('ask','hint','reason')",[roomId]);await auth(db,ids.member,sessions.member);
const key=randomUUID();const request=await write(db,'ask',key,{content:'完成了吗？',expected_puzzle_id:puzzleId});
await db.query('reset role');await rpc(db,'finish_room_ai_request',[request.ai_request.request_id,JSON.stringify({kind:'answer',text:'是',ask_audit:{secret:'private'},cache_hit:{id:1},fact_summary:'公开事实'}),true]);
await auth(db,ids.member,sessions.member);const result=await rpc(db,'player_read',['request',null,key]);assert.equal(result.status,'completed');assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!result.ai_message.content.includes('ask_audit'));assert.ok(!result.ai_message.content.includes('cache_hit'));
})();
await check('room close refunds pending cost before owner settlement; late finish cannot charge twice',async()=>{
await db.query('reset role');await db.query("delete from public.cli_rate_events where subject=$1 and action='ai'",[ids.member]);await db.query("update public.room_messages set created_at=now()-interval '10 seconds' where room_id=$1 and message_mode in ('ask','hint','reason')",[roomId]);await auth(db,ids.member,sessions.member);
const key=randomUUID();const request=await write(db,'ask',key,{content:'关房了吗？',expected_puzzle_id:puzzleId});
await auth(db,ids.owner,sessions.owner);await rpc(db,'close_room',[code]);await db.query('reset role');
assert.equal((await db.query('select points from public.profiles where id=$1',[ids.owner])).rows[0].points,99); // one successful ask above
assert.equal((await db.query('select status from public.room_ai_requests where request_message_id=$1',[request.ai_request.request_id])).rows[0].status,'refunded');
assert.equal(await rpc(db,'finish_room_ai_request',[request.ai_request.request_id,JSON.stringify({kind:'answer',text:'是'}),true]),null);
await db.query("update public.rooms set status='waiting',current_puzzle_id=$1 where id=$2",[puzzleId,roomId]); // disposable fixture only
await auth(db,ids.member,sessions.member);
})();
await check('expired key tombstone never executes again',async()=>{await db.query('reset role');await db.query("update public.cli_requests set created_at=now()-interval '8 days' where request_key=$1",[sayKey]);await auth(db,ids.member,sessions.member);await reject(()=>write(db,'say',sayKey,{content:'测试并发'}),'REQUEST_KEY_EXPIRED');})();
await check('owner cannot use CLI player operations; owned room stays open',async()=>{
await auth(db,ids.owner,sessions.owner);await register(db,ids.owner,sessions.owner);await reject(()=>write(db,'join',randomUUID(),{}),'OWNER_NOT_SUPPORTED');
await db.query('reset role');assert.equal((await db.query('select status from public.rooms where id=$1',[roomId])).rows[0].status,'waiting');
})();
await check('public roles cannot read private tables/core functions',async()=>{
await db.query('set role anon');await assert.rejects(()=>db.query('select * from public.cli_sessions'),/permission denied/);await assert.rejects(()=>db.query('select soup_cli.lock_transaction()'),/permission denied/);
})();
console.log(`DATABASE_TESTS_PASSED ${passed}`);
}catch(e){console.error("DATABASE_TEST_FAILURE",e.message,e.where);throw e;}finally{
await db.query("rollback");
await db.query('reset role');await db.query('begin');
await db.query('delete from public.room_messages where room_id=$1',[roomId]);await db.query('delete from public.room_ai_requests where room_id=$1',[roomId]);
await db.query('delete from public.points_transactions where user_id=any($1::uuid[])',[Object.values(ids)]);
await db.query('delete from public.rooms where id=any($1::uuid[])',[[roomId,otherRoomId].filter(Boolean)]);await db.query('delete from public.puzzles where id=$1',[puzzleId]);await db.query('delete from auth.sessions where id=any($1::uuid[])',[Object.values(sessions)]);await db.query('delete from auth.users where id=any($1::uuid[])',[Object.values(ids)]);await db.query('commit');
await Promise.all(connections.map(c=>c.end()));
}
