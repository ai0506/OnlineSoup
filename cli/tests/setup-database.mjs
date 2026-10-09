// Minimal Supabase fixture for an EMPTY, disposable PostgreSQL database.
// Real hosted Auth/Realtime/Cron are verified separately, never mocked in production.
import{Client}from'pg';import{readFile,readdir}from'node:fs/promises';
const url=process.env.ONLINESOUP_TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('Local disposable PostgreSQL URL required');
const c=new Client({connectionString:url});await c.connect();
try{
if(Number((await c.query("select count(*) n from information_schema.tables where table_schema in ('public','auth')")).rows[0].n))throw new Error('Fixture requires an empty database; no existing schema will be removed');
await c.query(`do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;
if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;
if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
create schema auth;create schema realtime;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
create function realtime.send(jsonb,text,text,boolean) returns void language sql as $$select$$;
grant usage on schema auth,public to anon,authenticated,service_role;
grant execute on all functions in schema auth to anon,authenticated,service_role;
create publication supabase_realtime;`);
const root=new URL('../../supabase/migrations/',import.meta.url);
for(const name of(await readdir(root)).filter(n=>n.endsWith('.sql')).sort()){
if(name==='20260622044346_schedule_qa_cache_pending_cleanup.sql')continue;
await c.query(await readFile(new URL(name,root),'utf8'));
}
console.log('LOCAL_FIXTURE_READY (Auth/Realtime stubs; pg_cron scheduling excluded)');
}finally{await c.end();}
