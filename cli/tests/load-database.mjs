// Disposable LOCAL database only. This is saturation testing, not a production capacity claim.
import {Client} from 'pg';import{randomUUID}from'node:crypto';import{performance}from'node:perf_hooks';
const url=process.env.ONLINESOUP_TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Local disposable PostgreSQL URL required');
const count=20,rounds=50,clients=[],fixtures=[];
const connect=async()=>{const c=new Client({connectionString:url});await c.connect();await c.query("set statement_timeout='10s'");clients.push(c);return c;};
const db=await connect();
function stats(label,samples,elapsed){samples.sort((a,b)=>a-b);console.log(JSON.stringify({label,rooms:count,requests:samples.length,elapsed_ms:Math.round(elapsed),rps:Math.round(samples.length*1000/elapsed),p50_ms:+samples[Math.floor(samples.length*.5)].toFixed(2),p95_ms:+samples[Math.floor(samples.length*.95)].toFixed(2),max_ms:+samples.at(-1).toFixed(2)}));}
try{
for(let i=0;i<count;i++){
const user=randomUUID(),sid=randomUUID();fixtures.push({user});
await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[user,`${user}@load.invalid`,{username:'L'+user.slice(0,7)}]);
await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,user]);const c=await connect();
await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:sid,role:'authenticated'})]);await c.query('set role authenticated');
const code=(await c.query("select public.create_room('并发测试',2,5,null) code")).rows[0].code;
const room=(await db.query('select id from public.rooms where code=$1',[code])).rows[0].id;
Object.assign(fixtures[i],{c,code,room});
await db.query("insert into public.room_messages(room_id,seat_id,sender_seat_number,sender_name,sender_type,message_type,message_mode,content) select $1,(select id from public.room_seats where room_id=$1 and seat_number=1),1,'fixture','registered','chat','chat','load fixture' from generate_series(1,100)",[room]);
}
let samples=[],start=performance.now();
await Promise.all(fixtures.map(async({c,code})=>{for(let i=0;i<rounds;i++){const t=performance.now();await c.query(`select public.${i%2?'get_room_chat_bootstrap':'get_room_member_state'}($1)`,[code]);samples.push(performance.now()-t);}}));
stats('20-room mixed polling saturation',samples,performance.now()-start);
// Explicitly inject a slow transaction to measure cross-room blocking by the global gate.
await db.query('begin');await db.query('select soup_cli.lock_transaction()');
start=performance.now();const waiting=Promise.all(fixtures.map(async({c,code})=>{const t=performance.now();await c.query('select public.get_room_member_state($1)',[code]);return performance.now()-t;}));
await db.query('select pg_sleep(0.25)');await db.query('commit');samples=await waiting;
stats('250ms gate holder fault injection',samples,performance.now()-start);
}catch(e){console.error('LOAD_TEST_FAILURE',e.message);throw e;}finally{
await db.query('rollback');for(const {room,user}of fixtures){if(room){await db.query('delete from public.points_transactions where room_id=$1',[room]);await db.query('delete from public.rooms where id=$1',[room]);}await db.query('delete from public.points_transactions where user_id=$1',[user]);await db.query('delete from auth.sessions where user_id=$1',[user]);await db.query('delete from auth.users where id=$1',[user]);}
await Promise.all(clients.map(c=>c.end()));
}
