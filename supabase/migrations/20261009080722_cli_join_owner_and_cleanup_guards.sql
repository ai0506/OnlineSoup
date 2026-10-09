-- Complete the P0 owner rejection and administrator settlement paths.
create or replace function public.player_write(p_action text,p_room_code text,p_request_key uuid,p_payload jsonb default '{}'::jsonb) returns jsonb
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
    select * into s from public.room_seats where room_id=r.id and user_id=u for update;
    if not found and exists(select 1 from public.rooms where owner_id=u and status<>'closed') then raise exception 'OWNED_ROOM_ACTIVE'; end if;
    if exists(select 1 from public.room_seats a join public.rooms b on a.room_id=b.id where a.user_id=u and b.status<>'closed' and b.id<>r.id) then raise exception 'ACTIVE_ROOM_EXISTS'; end if;
    -- Re-read: FOUND must refer to the target membership, not an auxiliary query.
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

-- Admin cleanup computes the owner settlement before changing room status;
-- its pending requests must be reconciled before that sum as well.
do $migration$
declare d text;
begin
  d:=pg_get_functiondef('public.admin_force_close_and_clear_room(uuid)'::regprocedure);
  d:=replace(d, E'  if target_room.status <> ''closed'' then', E'  perform soup_cli.refund_room(target_room.id);\n  if target_room.status <> ''closed'' then');
  execute d;
end $migration$;
notify pgrst, 'reload schema';

-- CLI limits are account-scoped, independent of prior occupants/system messages
-- at a seat. Keep the legacy seat-based cooldown only for website sessions.
do $migration$
declare d text;
begin
  d:=pg_get_functiondef('soup_cli.send_room_chat_message(text,text,text,text,boolean)'::regprocedure);
  if position('if not soup_cli.is_cli() then' in d)=0 then
    d:=replace(d,'  select count(*) into recent_second_count',E'  if not soup_cli.is_cli() then\n  select count(*) into recent_second_count');
    d:=replace(d,'  insert into public.room_messages',E'  end if;\n  insert into public.room_messages');
    execute d;
  end if;
  d:=pg_get_functiondef('soup_cli.send_room_ai_request(text,text,text,text,boolean)'::regprocedure);
  if position('if not soup_cli.is_cli() then' in d)=0 then
    d:=replace(d,'  select count(*) into recent_ai_count',E'  if not soup_cli.is_cli() then\n  select count(*) into recent_ai_count');
    d:=replace(d,'  if use_personal_points then',E'  end if;\n  if use_personal_points then');
    execute d;
  end if;
end $migration$;
notify pgrst, 'reload schema';
