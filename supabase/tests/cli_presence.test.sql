-- Run as postgres; all fixtures and changes are rolled back.
begin;
select '1..1';
do $$
declare
  u uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  rid uuid := gen_random_uuid();
  seat uuid := gen_random_uuid();
  code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  username text := 'p' || substr(replace(u::text, '-', ''), 1, 7);
  payload jsonb;
  online boolean;
  mode text;
  puzzle integer;
  message_id bigint;
begin
  insert into auth.users(id, raw_user_meta_data) values(u, jsonb_build_object('username', username));
  insert into public.rooms(id, code, name, owner_id, max_members, points_per_seat, reserved_points)
    values(rid, code, 'CLI presence test', u, 2, 0, 0);
  insert into public.room_seats(id, room_id, seat_number, nickname, user_id, remaining_points, occupied_at, active_session_id)
    values(seat, rid, 1, username, u, 0, now(), sid::text);
  insert into public.cli_sessions(session_id, user_id) values(sid, u);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'session_id',sid,'role','authenticated')::text, true);
  foreach mode in array array['recent','boundary','expired','missing','revoked','web','empty'] loop
    update public.cli_sessions set revoked_at = case when mode='revoked' then now() else null end where session_id=sid;
    update public.room_seats set
      last_cli_action_at = case mode when 'boundary' then now()-interval '2 minutes'
        when 'expired' then now()-interval '3 minutes' when 'missing' then null else now() end,
      nickname = case when mode='empty' then null else username end,
      active_session_id = case when mode='web' then gen_random_uuid()::text else sid::text end
      where id=seat;
    -- Empty seat and takeover are read from a separate valid guest observer.
    if mode in ('empty','web') then
      perform set_config('request.jwt.claims', '{}', true);
      insert into public.room_seats(room_id,seat_number,nickname,remaining_points,occupied_at)
        values(rid,2,'Observer',0,now()) on conflict(room_id,seat_number) do nothing;
      insert into public.guest_sessions(room_id,seat_id,token_hash,member_key)
        select rid,id,encode(extensions.digest('presence-test-token','sha256'),'hex'),'guest:' || rid::text
        from public.room_seats where room_id=rid and seat_number=2
        on conflict(seat_id) do nothing;
      payload := public.get_room_member_state(code,'presence-test-token');
    else
      payload := public.get_room_member_state(code,null);
    end if;
    select (value->>'cli_online')::boolean into online from jsonb_array_elements(payload->'seats') where value->>'id'=seat::text;
    if online is distinct from (mode='recent') then raise exception 'CLI presence case failed: %',mode; end if;
    if payload::text ~ 'active_session_id|last_cli_action_at|revoked_at' then raise exception 'private fields leaked'; end if;
  end loop;
  select id into puzzle from public.puzzles order by id limit 1;
  if puzzle is null then raise exception 'pending AI fixture needs one puzzle'; end if;
  update public.room_seats set nickname=username,active_session_id=sid::text where id=seat;
  update public.room_seats set last_cli_action_at=now()-interval '3 minutes' where id=seat;
  insert into public.room_messages(room_id,seat_id,sender_name,sender_seat_number,sender_type,message_type,message_mode,content,puzzle_id)
    values(rid,seat,username,1,'registered','chat','ask','Presence test',puzzle) returning id into message_id;
  insert into public.room_ai_requests(request_message_id,room_id,seat_id,user_id,puzzle_id,message_mode,cost,paid_from,status,lease_expires_at)
    values(message_id,rid,seat,u,puzzle,'ask',1,'seat','pending',now()+interval '1 minute');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',u,'session_id',sid,'role','authenticated')::text, true);
  payload := public.get_room_member_state(code,null);
  select (value->>'cli_online')::boolean into online from jsonb_array_elements(payload->'seats') where value->>'id'=seat::text;
  if online is distinct from true then raise exception 'pending AI must stay online'; end if;
  update public.room_ai_requests set lease_expires_at=now()-interval '1 second' where request_message_id=message_id;
  payload := public.get_room_member_state(code,null);
  select (value->>'cli_online')::boolean into online from jsonb_array_elements(payload->'seats') where value->>'id'=seat::text;
  if online is distinct from false then raise exception 'expired AI lease must not stay online'; end if;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_room_member_state(code,null);
    raise exception 'non-member unexpectedly allowed';
  exception when others then
    if sqlerrm <> 'room_membership_required' then raise; end if;
  end;
end $$;
select 'ok 1 - CLI presence: recent, boundary, expired, missing, revoked, web takeover, empty, pending AI, expired AI lease, non-member and private output';
rollback;
