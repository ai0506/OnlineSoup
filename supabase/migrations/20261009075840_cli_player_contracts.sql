-- P0: registered CLI sessions, atomic idempotent writes and safe lease cleanup.
create schema if not exists soup_cli;
revoke all on schema soup_cli from public, anon, authenticated;
create table soup_cli.hash_secret (secret bytea not null);
insert into soup_cli.hash_secret values(extensions.gen_random_bytes(32));
revoke all on soup_cli.hash_secret from public, anon, authenticated;

create table public.cli_sessions (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create table public.cli_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key uuid not null,
  action text not null,
  room_code text not null,
  payload_hash text not null,
  result jsonb,
  request_message_id bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);
create table public.cli_rate_events (
  subject text not null,
  action text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index cli_rate_events_lookup on public.cli_rate_events(subject, action, created_at desc);
alter table public.cli_sessions enable row level security;
alter table public.cli_requests enable row level security;
alter table public.cli_rate_events enable row level security;
revoke all on public.cli_sessions, public.cli_requests, public.cli_rate_events from public, anon, authenticated;
grant select, insert, update, delete on public.cli_sessions, public.cli_requests, public.cli_rate_events to service_role;
-- No public policies: all player access goes through authenticated RPCs.
alter table public.room_seats add column membership_id uuid not null default gen_random_uuid();
alter table public.room_seats add column last_cli_action_at timestamptz;
alter table public.guest_removals drop constraint guest_removals_reason_check;
alter table public.guest_removals add constraint guest_removals_reason_check check (reason in ('kicked', 'idle_timeout'));
alter table public.guest_removals add column membership_id uuid;

-- A single short transaction gate is deliberately used in P0. Existing room
-- RPCs lock profiles/seats/requests in incompatible orders, including cross-room
-- joins. Model/network calls run OUTSIDE this gate. Splitting it by room requires
-- a separately tested rewrite of the legacy cross-room operations.
create function soup_cli.lock_transaction() returns void language sql volatile
set search_path = '' as $$ select pg_advisory_xact_lock(1886352752, 1) $$;
revoke all on function soup_cli.lock_transaction() from public, anon, authenticated;

create function soup_cli.is_cli() returns boolean language sql stable security definer
set search_path = '' as $$
  select exists(select 1 from public.cli_sessions where session_id::text = (auth.jwt()->>'session_id'))
$$;
revoke all on function soup_cli.is_cli() from public, anon, authenticated;

create function public.player_session() returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); s uuid; n text;
begin
  if u is null then raise exception 'LOGIN_REQUIRED'; end if;
  s := nullif(auth.jwt()->>'session_id','')::uuid;
  if s is null or not exists(select 1 from auth.sessions where id=s and user_id=u) then raise exception 'AUTH_EXPIRED'; end if;
  if not exists(select 1 from public.cli_sessions where session_id=s and user_id=u and revoked_at is null) then
    raise exception 'CLI_SESSION_REQUIRED';
  end if;
  select username into n from public.profiles where id=u;
  if n is null then raise exception 'USERNAME_REQUIRED'; end if;
  return jsonb_build_object('authenticated',true,'user_id',u,'username',n);
end $$;
revoke all on function public.player_session() from public, anon, authenticated;
grant execute on function public.player_session() to authenticated;

create function public.player_register_session(p_user_id uuid,p_session_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id) then raise exception 'AUTH_EXPIRED'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and username is not null) then raise exception 'USERNAME_REQUIRED'; end if;
  insert into public.cli_sessions(session_id,user_id) values(p_session_id,p_user_id) on conflict do nothing;
end $$;
revoke all on function public.player_register_session(uuid,uuid) from public, anon, authenticated;
grant execute on function public.player_register_session(uuid,uuid) to service_role;

create function soup_cli.refund_room(p_room_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  perform soup_cli.lock_transaction();
  for q in select request_message_id from public.room_ai_requests where room_id=p_room_id and status='pending' loop
    perform public.finish_room_ai_request(q.request_message_id,'',false);
  end loop;
end $$;
revoke all on function soup_cli.refund_room(uuid) from public, anon, authenticated;

create function public.player_revoke_session() returns void language plpgsql security definer set search_path = '' as $$
begin
  perform soup_cli.lock_transaction();
  perform public.player_session();
  if exists(select 1 from public.room_seats s join public.rooms r on r.id=s.room_id
    where s.user_id=auth.uid() and s.active_session_id=(auth.jwt()->>'session_id') and r.status <> 'closed') then
    raise exception 'LEAVE_REQUIRED';
  end if;
  update public.cli_sessions set revoked_at=now() where session_id::text=(auth.jwt()->>'session_id');
end $$;
revoke all on function public.player_revoke_session() from public, anon, authenticated;
grant execute on function public.player_revoke_session() to authenticated;

create function soup_cli.rate_limit(p_subject text,p_action text,p_window double precision,p_limit integer) returns void
language plpgsql security definer set search_path = '' as $$
declare oldest timestamptz; n integer;
begin
  perform soup_cli.lock_transaction();
  select count(*),min(created_at) into n,oldest from public.cli_rate_events
    where subject=p_subject and action=p_action and created_at>clock_timestamp()-make_interval(secs=>p_window);
  if n>=p_limit then raise exception 'RATE_LIMITED' using detail=greatest(1,ceil(extract(epoch from oldest+make_interval(secs=>p_window)-clock_timestamp())))::text; end if;
end $$;
revoke all on function soup_cli.rate_limit(text,text,double precision,integer) from public, anon, authenticated;
create function public.player_login_attempt(p_subject text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform soup_cli.lock_transaction();
  perform soup_cli.rate_limit(p_subject,'login',600,10);
  insert into public.cli_rate_events(subject,action) values(p_subject,'login');
end $$;
revoke all on function public.player_login_attempt(text) from public, anon, authenticated;
grant execute on function public.player_login_attempt(text) to service_role;

-- Copy the deployed implementations into a non-exposed schema. Public legacy
-- entry points retain their signatures/grants but reject registered CLI tokens.
do $migration$
declare f record; d text; injection text;
begin
  for f in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
    ('send_room_ai_request','send_room_chat_message','finish_room_ai_request')
  loop
    d := pg_get_functiondef(f.oid);
    d := replace(d,'FUNCTION public.'||f.proname||'(', 'FUNCTION soup_cli.'||f.proname||'(');
    if f.proname='send_room_ai_request' then
      d:=replace(d,'where seat_id = sender_seat.id and message_mode in','where room_messages.seat_id = sender_seat.id and room_messages.message_mode in');
    end if;
    execute d;
  end loop;
  for f in select p.oid,p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
    ('create_room','join_room_as_member','join_room_as_guest','take_over_room_session','leave_room_as_member',
     'leave_room_as_guest','move_seat','kick_guest','gift_points_to_seat','close_room','open_puzzle','close_puzzle',
     'get_puzzle_list','require_active_room_member_seat','get_room_member_state','get_room_chat_bootstrap',
     'get_room_current_puzzle','reconcile_stale_room_ai_requests','admin_force_close_and_clear_room',
     'admin_cleanup_user_before_delete','admin_delete_puzzle','admin_replace_all_puzzles','admin_adjust_user_points')
  loop
    d := pg_get_functiondef(f.oid);
    injection := E'begin\n  perform soup_cli.lock_transaction();';
    if f.proname in ('create_room','join_room_as_member','join_room_as_guest','take_over_room_session',
      'leave_room_as_member','leave_room_as_guest','move_seat','kick_guest','gift_points_to_seat','close_room','open_puzzle','close_puzzle','get_puzzle_list') then
      injection := injection || E'\n  if soup_cli.is_cli() then raise exception ''USE_PLAYER_API''; end if;';
    end if;
    if f.proname='close_room' then
      d:=replace(d,'  -- Sum all remaining seat points',E'  perform soup_cli.refund_room(target_room.id);\n  -- Sum all remaining seat points');
    end if;
    if f.proname='move_seat' then
      d:=replace(d,'occupied_at = source_seat.occupied_at','occupied_at = source_seat.occupied_at, active_session_id = source_seat.active_session_id, active_session_updated_at = source_seat.active_session_updated_at');
      d:=replace(d,'  update public.guest_sessions',E'  update public.room_seats set last_cli_action_at=source_seat.last_cli_action_at where id=target_seat_id;\n  update public.guest_sessions');
    end if;
    -- Replace only the outermost BEGIN, preserving all nested exception blocks.
    d := regexp_replace(d,'\mbegin\M',injection,'i');
    execute d;
  end loop;
end $migration$;
revoke all on all functions in schema soup_cli from public, anon, authenticated;

create or replace function public.send_room_chat_message(room_code text,message_content text,guest_token text default null,
  message_mode text default 'chat',use_personal_points boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform soup_cli.lock_transaction();
  if soup_cli.is_cli() then raise exception 'USE_PLAYER_API'; end if;
  return soup_cli.send_room_chat_message(room_code,message_content,guest_token,message_mode,use_personal_points);
end $$;
create or replace function public.send_room_ai_request(room_code text,message_content text,guest_token text default null,
  message_mode text default 'ask',use_personal_points boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform soup_cli.lock_transaction();
  if soup_cli.is_cli() then raise exception 'USE_PLAYER_API'; end if;
  return soup_cli.send_room_ai_request(room_code,message_content,guest_token,message_mode,use_personal_points);
end $$;
create or replace function public.finish_room_ai_request(request_message_id bigint,ai_content text,is_success boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.room_ai_requests%rowtype;
begin
  perform soup_cli.lock_transaction();
  select * into q from public.room_ai_requests a where a.request_message_id=finish_room_ai_request.request_message_id for update;
  if not found then raise exception 'ai_request_not_found'; end if;
  if q.status <> 'pending' then
    return (select to_jsonb(m)||jsonb_build_object('content',public.player_safe_room_message_content(m.content,m.message_type::text)) from public.room_messages m where m.reply_to_id=q.request_message_id and m.message_type='ai' order by m.id limit 1);
  end if;
  -- Late completion cannot publish a reply for a switched/closed room or charge
  -- a request already refunded by an expiry reconciler.
  return soup_cli.finish_room_ai_request(request_message_id,ai_content,
    is_success and q.lease_expires_at>now() and exists(select 1 from public.rooms r
      where r.id=q.room_id and r.status<>'closed' and r.current_puzzle_id=q.puzzle_id));
end $$;

-- Destructive seat/room changes settle all pending requests BEFORE releasing a
-- membership or settling room balances. Session takeover alone keeps requests.
create function soup_cli.seat_generation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is distinct from new.user_id or old.nickname is distinct from new.nickname then
    new.membership_id := gen_random_uuid();
    new.last_cli_action_at := null;
  end if;
  return new;
end $$;
create trigger cli_seat_generation before update on public.room_seats for each row execute function soup_cli.seat_generation();
create function soup_cli.settle_seat_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  if old.user_id is distinct from new.user_id or old.nickname is distinct from new.nickname then
    for q in select request_message_id from public.room_ai_requests where seat_id=old.id and status='pending' loop
      perform public.finish_room_ai_request(q.request_message_id,'',false);
    end loop;
  end if;
  return new;
end $$;
-- AFTER avoids recursively modifying the tuple being changed by a BEFORE
-- trigger. The gate and seat row lock are still held until transaction commit:
-- no other member can acquire the released seat before its refund completes.
create trigger cli_settle_seat_change after update on public.room_seats for each row execute function soup_cli.settle_seat_change();
create function soup_cli.settle_room_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  if (new.status='closed' and old.status<>'closed') or new.current_puzzle_id is distinct from old.current_puzzle_id then
    for q in select request_message_id from public.room_ai_requests where room_id=old.id and status='pending' loop
      perform public.finish_room_ai_request(q.request_message_id,'',false);
    end loop;
  end if;
  return new;
end $$;
create trigger cli_settle_room_change before update on public.rooms for each row execute function soup_cli.settle_room_change();

create function soup_cli.require_member(p_code text) returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.rooms%rowtype; s uuid;
begin
  perform public.player_session();
  select * into r from public.rooms where code=p_code;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.owner_id=auth.uid() then raise exception 'OWNER_NOT_SUPPORTED'; end if;
  if r.status='closed' then raise exception 'ROOM_CLOSED'; end if;
  if exists(select 1 from public.guest_removals where room_id=r.id and member_key='user:'||auth.uid()::text and reason='kicked') then raise exception 'KICKED'; end if;
  if not exists(select 1 from public.room_seats where room_id=r.id and user_id=auth.uid()) and
    exists(select 1 from public.guest_removals where room_id=r.id and member_key='user:'||auth.uid()::text and reason='idle_timeout') then raise exception 'IDLE_TIMEOUT'; end if;
  s := public.require_active_room_member_seat(r.id,null);
  return s;
end $$;

create function public.player_read(p_action text,p_room_code text default null,p_request_key uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.cli_requests%rowtype; q public.room_ai_requests%rowtype; v jsonb; member_ok boolean:=false;
begin
  perform soup_cli.lock_transaction();
  perform public.player_session();
  if p_action='request' then
    select * into r from public.cli_requests where user_id=auth.uid() and request_key=p_request_key;
    if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
    if r.created_at<now()-interval '7 days' then raise exception 'REQUEST_KEY_EXPIRED'; end if;
    if r.request_message_id is null then return r.result-'execute_ai'-'ai_request'; end if;
    select * into q from public.room_ai_requests where request_message_id=r.request_message_id;
    if not found then raise exception 'REQUEST_RECORD_UNAVAILABLE'; end if;
    if q.status='pending' and q.lease_expires_at<=now() then
      perform public.finish_room_ai_request(q.request_message_id,'',false);
      select * into q from public.room_ai_requests where request_message_id=r.request_message_id;
    end if;
    -- After displacement only reveal payment/status, never message content.
    begin perform soup_cli.require_member(r.room_code); member_ok:=true; exception when others then member_ok:=false; end;
    return jsonb_build_object('action',r.action,'request_key',r.request_key,'room_code',r.room_code,'status',q.status,
      'request_message_id',q.request_message_id,'puzzle_id',q.puzzle_id,'points_spent',case when q.status='refunded' then 0 else q.cost end,
      'paid_from',q.paid_from,'ai_message',case when member_ok then
        (select to_jsonb(m)||jsonb_build_object('content',public.player_safe_room_message_content(m.content,m.message_type::text)) from public.room_messages m
          where reply_to_id=q.request_message_id and message_type='ai' order by id limit 1) else null end);
  end if;
  perform soup_cli.require_member(p_room_code);
  if p_action='state' then
    v:=public.get_room_member_state(p_room_code,null);
    return v||jsonb_build_object('puzzle',public.get_room_current_puzzle(p_room_code,null));
  elsif p_action='puzzle' then return jsonb_build_object('puzzle',public.get_room_current_puzzle(p_room_code,null));
  elsif p_action='messages' then return public.get_room_chat_bootstrap(p_room_code,null)||jsonb_build_object('history_scope','latest_100');
  end if;
  raise exception 'INVALID_COMMAND';
end $$;
revoke all on function public.player_read(text,text,uuid) from public, anon, authenticated;
grant execute on function public.player_read(text,text,uuid) to authenticated;

create function public.player_write(p_action text,p_room_code text,p_request_key uuid,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); sid text:=auth.jwt()->>'session_id'; r public.rooms%rowtype;
  s public.room_seats%rowtype; n text; h text; old public.cli_requests%rowtype; result jsonb; ai jsonb; pw text;
begin
  perform soup_cli.lock_transaction();
  perform public.player_session();
  if p_request_key is null or p_room_code !~ '^[A-Z0-9]{6}$' or p_action not in ('join','leave','say','ask','hint','reason') then raise exception 'INVALID_INPUT'; end if;
  h:=encode(extensions.hmac(p_payload::text,(select encode(secret,'hex') from soup_cli.hash_secret),'sha256'),'hex');
  select * into old from public.cli_requests where user_id=u and request_key=p_request_key;
  if found then
    if old.action<>p_action or old.room_code<>p_room_code or old.payload_hash<>h then raise exception 'REQUEST_KEY_CONFLICT'; end if;
    return public.player_read('request',null,p_request_key)||jsonb_build_object('execute_ai',false);
  end if;
  select * into r from public.rooms where code=p_room_code for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.owner_id=u then raise exception 'OWNER_NOT_SUPPORTED'; end if;
  if r.status='closed' then raise exception 'ROOM_CLOSED'; end if;
  select username into n from public.profiles where id=u;
  if p_action='join' then
    perform soup_cli.rate_limit(u::text,'join',3600,10);
    insert into public.cli_rate_events(subject,action) values(u::text,'join');
    if exists(select 1 from public.guest_removals where room_id=r.id and member_key='user:'||u::text and reason='kicked') then raise exception 'KICKED'; end if;
    if exists(select 1 from public.room_seats a join public.rooms b on a.room_id=b.id where a.user_id=u and b.status<>'closed' and b.id<>r.id) then raise exception 'ACTIVE_ROOM_EXISTS'; end if;
    select * into s from public.room_seats where room_id=r.id and user_id=u for update;
    if found then
      if s.active_session_id is distinct from sid and not coalesce((p_payload->>'takeover')::boolean,false) then raise exception 'ROOM_DEVICE_IN_USE'; end if;
    else
      if exists(select 1 from public.rooms where owner_id=u and status<>'closed') then raise exception 'OWNED_ROOM_ACTIVE'; end if;
      if r.status<>'waiting' then raise exception 'ROOM_NOT_JOINABLE'; end if;
      select password_hash into pw from public.room_private where room_id=r.id;
      if pw is not null and (p_payload->>'password' is null or extensions.crypt(p_payload->>'password',pw)<>pw) then raise exception 'WRONG_PASSWORD'; end if;
      if exists(select 1 from public.room_seats where room_id=r.id and lower(nickname)=lower(n)) then raise exception 'USERNAME_IN_ROOM'; end if;
      select * into s from public.room_seats where room_id=r.id and nickname is null order by seat_number for update limit 1;
      if not found then raise exception 'ROOM_FULL'; end if;
    end if;
    update public.room_seats set user_id=u,nickname=n,occupied_at=coalesce(occupied_at,now()),active_session_id=sid,
      active_session_updated_at=now() where id=s.id;
    update public.room_seats set last_cli_action_at=now() where id=s.id;
    delete from public.guest_removals where room_id=r.id and member_key='user:'||u::text and reason='idle_timeout';
    result:=jsonb_build_object('seat_id',s.id,'membership_id',(select membership_id from public.room_seats where id=s.id));
  else
    select * into s from public.room_seats where id=soup_cli.require_member(p_room_code);
    if p_action='leave' then
      update public.room_seats set user_id=null,nickname=null,occupied_at=null,active_session_id=null,active_session_updated_at=null where id=s.id;
      result:=jsonb_build_object('left',true);
    elsif p_action='say' then
      perform soup_cli.rate_limit(u::text,'say',1,1);
      perform soup_cli.rate_limit(u::text,'say',60,20);
      result:=jsonb_build_object('message',soup_cli.send_room_chat_message(p_room_code,p_payload->>'content',null,'chat',false));
    else
      if p_payload->>'expected_puzzle_id' is null then raise exception 'REQUIRED_INPUT_MISSING'; end if;
      if r.current_puzzle_id is distinct from (p_payload->>'expected_puzzle_id')::integer then raise exception 'PUZZLE_CHANGED'; end if;
      perform soup_cli.rate_limit(u::text,'ai',7.5,1);
      perform soup_cli.rate_limit(u::text,'ai',600,80);
      ai:=soup_cli.send_room_ai_request(p_room_code,p_payload->>'content',null,p_action,coalesce((p_payload->>'use_personal_points')::boolean,false));
      result:=jsonb_build_object('execute_ai',true,'ai_request',ai);
    end if;
    if p_action<>'leave' then
      insert into public.cli_rate_events(subject,action) values(u::text,case when p_action='say' then 'say' else 'ai' end);
      update public.room_seats set last_cli_action_at=now() where id=s.id;
    end if;
  end if;
  result:=result||jsonb_build_object('action',p_action,'request_key',p_request_key,'room_code',p_room_code,'status',case when ai is null then 'completed' else 'pending' end);
  insert into public.cli_requests(user_id,request_key,action,room_code,payload_hash,result,request_message_id)
    values(u,p_request_key,p_action,p_room_code,h,result,(ai->>'request_id')::bigint);
  return result;
end $$;
revoke all on function public.player_write(text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.player_write(text,text,uuid,jsonb) to authenticated;

create function public.player_cleanup_idle() returns integer language plpgsql security definer set search_path = '' as $$
declare candidate record; s public.room_seats%rowtype; n integer:=0;
begin
  perform soup_cli.lock_transaction();
  for candidate in select a.id,a.membership_id from public.room_seats a join public.rooms r on r.id=a.room_id
    where a.last_cli_action_at<=now()-interval '1 hour' and a.user_id is not null and r.status<>'closed'
  loop
    select * into s from public.room_seats where id=candidate.id for update;
    if s.membership_id<>candidate.membership_id or s.user_id is null or s.last_cli_action_at>now()-interval '1 hour'
      or not exists(select 1 from public.cli_sessions where session_id::text=s.active_session_id) then continue; end if;
    if exists(select 1 from public.room_ai_requests where seat_id=s.id and status='pending' and lease_expires_at>now()) then continue; end if;
    perform public.reconcile_stale_room_ai_requests(s.room_id);
    if exists(select 1 from public.room_ai_requests where seat_id=s.id and status='pending') then continue; end if;
    insert into public.guest_removals(room_id,token_hash,member_key,reason,membership_id)
      values(s.room_id,encode(extensions.digest(s.membership_id::text,'sha256'),'hex'),'user:'||s.user_id::text,'idle_timeout',s.membership_id)
      on conflict(room_id,member_key) do update set reason=excluded.reason,membership_id=excluded.membership_id,created_at=now();
    update public.room_seats set user_id=null,nickname=null,occupied_at=null,active_session_id=null,active_session_updated_at=null where id=s.id;
    insert into public.room_messages(room_id,seat_id,sender_name,sender_seat_number,sender_type,message_type,content)
      values(s.room_id,s.id,s.nickname,s.seat_number,'registered','system',s.nickname||' 长时间无操作，已离开');
    n:=n+1;
  end loop;
  delete from public.cli_rate_events where created_at<now()-interval '1 day';
  -- Retain key tombstones permanently; an expired UUID can never execute again.
  update public.cli_requests set result=null where created_at<now()-interval '7 days' and result is not null;
  return n;
end $$;
revoke all on function public.player_cleanup_idle() from public, anon, authenticated;
grant execute on function public.player_cleanup_idle() to service_role;
revoke all on all functions in schema soup_cli from public, anon, authenticated;
-- pg_cron is already installed in the hosted project. Local fixture can omit it.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('cli-idle-cleanup','*/5 * * * *','select public.player_cleanup_idle()');
  end if;
end $$;
notify pgrst, 'reload schema';
