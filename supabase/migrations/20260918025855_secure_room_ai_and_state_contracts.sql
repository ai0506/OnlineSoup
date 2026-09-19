-- Security and consistency contract for room state and paid AI requests.
-- A pending request owns a lease.  The database, rather than a Node invocation,
-- is responsible for reconciling a request whose owner disappeared.
alter table public.room_ai_requests
  add column if not exists lease_expires_at timestamptz;

update public.room_ai_requests
set lease_expires_at = created_at + interval '2 minutes'
where status = 'pending'
  and lease_expires_at is null;

create index if not exists room_ai_requests_pending_lease_idx
  on public.room_ai_requests (room_id, lease_expires_at)
  where status = 'pending';

-- Returns the current member seat only after checking both the room credential
-- and, for registered users, the room-scoped active Supabase session.
create or replace function public.require_active_room_member_seat(
  p_room_id uuid,
  p_guest_token text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  member_seat public.room_seats%rowtype;
begin
  if current_user_id is not null then
    select * into member_seat
    from public.room_seats
    where room_id = p_room_id
      and user_id = current_user_id
      and nickname is not null
    for update;

    if not found then
      raise exception 'room_membership_required';
    end if;

    if current_session_id is not null
      and member_seat.active_session_id is not null
      and member_seat.active_session_id <> current_session_id
    then
      raise exception 'room_device_in_use';
    end if;

    return member_seat.id;
  end if;

  if p_guest_token is null or p_guest_token = '' then
    raise exception 'room_membership_required';
  end if;

  select rs.* into member_seat
  from public.guest_sessions gs
  join public.room_seats rs on rs.id = gs.seat_id
  where gs.room_id = p_room_id
    and gs.token_hash = encode(extensions.digest(p_guest_token, 'sha256'), 'hex')
    and rs.nickname is not null
  for update of rs;

  if not found then
    raise exception 'room_membership_required';
  end if;

  return member_seat.id;
end;
$$;

revoke all on function public.require_active_room_member_seat(uuid, text)
  from public, anon, authenticated;

-- Reconcile only requests whose lease has expired. finish_room_ai_request locks
-- and changes status, making repeated cleanup calls harmless.
create or replace function public.reconcile_stale_room_ai_requests(
  p_room_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_request record;
  reconciled integer := 0;
begin
  for stale_request in
    select request_message_id
    from public.room_ai_requests
    where status = 'pending'
      and lease_expires_at <= now()
      and (p_room_id is null or room_id = p_room_id)
    order by lease_expires_at
    for update skip locked
  loop
    perform public.finish_room_ai_request(stale_request.request_message_id, '', false);
    reconciled := reconciled + 1;
  end loop;
  return reconciled;
end;
$$;

revoke all on function public.reconcile_stale_room_ai_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_stale_room_ai_requests(uuid)
  to service_role;

create or replace function public.send_room_chat_message(
  room_code text,
  message_content text,
  guest_token text default null,
  message_mode text default 'chat',
  use_personal_points boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  sender_seat public.room_seats%rowtype;
  inserted_message public.room_messages%rowtype;
  recent_second_count integer;
  recent_minute_count integer;
begin
  if message_mode <> 'chat' then raise exception 'invalid_message_mode'; end if;
  if char_length(trim(message_content)) not between 1 and 300 then raise exception 'invalid_message'; end if;

  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;

  select * into sender_seat
  from public.room_seats
  where id = public.require_active_room_member_seat(target_room.id, guest_token);

  select count(*) into recent_second_count from public.room_messages
  where seat_id = sender_seat.id and message_mode = 'chat' and created_at > now() - interval '1 second';
  if recent_second_count >= 2 then raise exception 'rate_limited'; end if;
  select count(*) into recent_minute_count from public.room_messages
  where seat_id = sender_seat.id and message_mode = 'chat' and created_at > now() - interval '60 seconds';
  if recent_minute_count >= 40 then raise exception 'rate_limited'; end if;

  insert into public.room_messages (room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content)
  values (target_room.id, sender_seat.id, sender_seat.nickname, sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end, 'chat', 'chat', trim(message_content))
  returning * into inserted_message;
  return to_jsonb(inserted_message);
end;
$$;

create or replace function public.get_room_chat_bootstrap(room_code text, guest_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  member_seat_id uuid;
  messages jsonb;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;
  member_seat_id := public.require_active_room_member_seat(target_room.id, guest_token);

  select coalesce(jsonb_agg(to_jsonb(recent_messages) order by recent_messages.created_at, recent_messages.id), '[]'::jsonb)
  into messages
  from (
    select id, room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode,
      public.player_safe_room_message_content(content, message_type::text) as content, puzzle_id, reply_to_id, created_at
    from (select rm.* from public.room_messages rm where rm.room_id = target_room.id order by rm.created_at desc, rm.id desc limit 100) newest_first
  ) recent_messages;

  return jsonb_build_object('messages', messages, 'seat_id', member_seat_id);
end;
$$;

create or replace function public.get_room_join_info(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_room public.rooms%rowtype;
begin
  select * into target_room from public.rooms where code = upper(trim(p_room_code));
  if not found or target_room.status = 'closed' then
    return jsonb_build_object('exists', false);
  end if;
  return jsonb_build_object(
    'exists', true,
    'name', target_room.name,
    'status', target_room.status,
    'max_members', target_room.max_members,
    'points_per_seat', target_room.points_per_seat,
    'requires_password', exists(select 1 from public.room_private where room_id = target_room.id and password_hash is not null),
    'occupied_count', (select count(*) from public.room_seats where room_id = target_room.id and nickname is not null)
  );
end;
$$;

create or replace function public.get_room_member_state(p_room_code text, p_guest_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  member_seat_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  select * into target_room from public.rooms where code = upper(trim(p_room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;
  member_seat_id := public.require_active_room_member_seat(target_room.id, p_guest_token);

  return jsonb_build_object(
    'room', jsonb_build_object('id', target_room.id, 'code', target_room.code, 'name', target_room.name, 'status', target_room.status,
      'max_members', target_room.max_members, 'points_per_seat', target_room.points_per_seat,
      'is_owner', current_user_id = target_room.owner_id),
    'seat_id', member_seat_id,
    'seats', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'seat_number', seat_number, 'nickname', nickname,
      'remaining_points', remaining_points, 'hint_tokens', hint_tokens, 'occupied_at', occupied_at,
      'is_current_user', id = member_seat_id) order by seat_number), '[]'::jsonb) from public.room_seats where room_id = target_room.id),
    'personal_points', case when current_user_id is null then null else (select points from public.profiles where id = current_user_id) end,
    'requires_password', exists(select 1 from public.room_private where room_id = target_room.id and password_hash is not null)
  );
end;
$$;

revoke all on function public.get_room_join_info(text), public.get_room_member_state(text, text)
  from public, anon, authenticated;
grant execute on function public.get_room_join_info(text) to anon, authenticated;
grant execute on function public.get_room_member_state(text, text) to anon, authenticated;

create or replace function public.get_room_current_puzzle(room_code text, guest_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  puzzle public.puzzles%rowtype;
  is_solved boolean;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found or target_room.status = 'closed' then raise exception 'room_not_found'; end if;
  perform public.require_active_room_member_seat(target_room.id, guest_token);
  if target_room.current_puzzle_id is null then return null; end if;
  select * into puzzle from public.puzzles where id = target_room.current_puzzle_id;
  if not found then return null; end if;
  select coalesce(solved, false) into is_solved from public.puzzle_progress
    where room_id = target_room.id and puzzle_id = puzzle.id;
  return jsonb_build_object('id', puzzle.id, 'title', puzzle.title, 'surface', puzzle.surface,
    'difficulty', puzzle.difficulty, 'solved', coalesce(is_solved, false));
end;
$$;

revoke all on function public.get_room_current_puzzle(text, text) from public, anon, authenticated;
grant execute on function public.get_room_current_puzzle(text, text) to anon, authenticated;

-- The paid AI path is rebuilt after the helper above so old sessions cannot
-- charge a seat. The 120-second lease covers the full route, including cache
-- and fact-summary calls, not merely the model's 30-second inner deadline.
create or replace function public.send_room_ai_request(
  room_code text, message_content text, guest_token text default null,
  message_mode text default 'ask', use_personal_points boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  sender_seat public.room_seats%rowtype;
  inserted_message public.room_messages%rowtype;
  mode_cost integer;
  max_length integer;
  current_personal_pts integer;
  paid_from_value text;
  room_busy_count integer;
  recent_ai_count integer;
begin
  if message_mode not in ('ask', 'hint', 'reason') then raise exception 'invalid_message_mode'; end if;
  mode_cost := case when message_mode = 'reason' then 2 else 1 end;
  max_length := case when message_mode = 'ask' then 100 when message_mode = 'reason' then 300 else 50 end;
  if char_length(trim(message_content)) not between 1 and max_length then raise exception 'invalid_message'; end if;
  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;
  if target_room.current_puzzle_id is null then raise exception 'no_active_puzzle'; end if;
  select * into sender_seat from public.room_seats where id = public.require_active_room_member_seat(target_room.id, guest_token);
  if message_mode = 'hint' and sender_seat.hint_tokens < 1 then raise exception 'insufficient_hint_tokens'; end if;

  perform pg_advisory_xact_lock(hashtext('room_ai_request:' || target_room.id::text));
  perform public.reconcile_stale_room_ai_requests(target_room.id);
  select count(*) into room_busy_count from public.room_ai_requests
  where room_id = target_room.id and status = 'pending' and lease_expires_at > now();
  if room_busy_count > 0 then raise exception 'room_ai_busy'; end if;
  select count(*) into recent_ai_count from public.room_messages
  where seat_id = sender_seat.id and message_mode in ('ask', 'hint', 'reason') and created_at > now() - interval '3 seconds';
  if recent_ai_count >= 1 then raise exception 'rate_limited'; end if;

  if use_personal_points then
    if current_user_id is null then raise exception 'authentication_required'; end if;
    select points into current_personal_pts from public.profiles where id = current_user_id for update;
    if current_personal_pts < mode_cost then raise exception 'insufficient_points'; end if;
    update public.profiles set points = points - mode_cost, updated_at = now() where id = current_user_id;
    insert into public.points_transactions (user_id, room_id, type, amount, balance_after)
      values (current_user_id, target_room.id, 'seat_query', -mode_cost, current_personal_pts - mode_cost);
    paid_from_value := 'personal';
  else
    if sender_seat.remaining_points < mode_cost then raise exception 'insufficient_seat_points'; end if;
    update public.room_seats set remaining_points = remaining_points - mode_cost where id = sender_seat.id;
    paid_from_value := 'seat';
  end if;

  update public.room_seats
  set ask_count = case when message_mode = 'ask' then ask_count + 1 else ask_count end,
      hint_tokens = case when message_mode = 'hint' then hint_tokens - 1 when message_mode = 'reason' then hint_tokens + 1
        when message_mode = 'ask' and (ask_count + 1) % 3 = 0 then hint_tokens + 1 else hint_tokens end
  where id = sender_seat.id;

  insert into public.room_messages (room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content, puzzle_id)
  values (target_room.id, sender_seat.id, sender_seat.nickname, sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end, 'chat', message_mode, trim(message_content), target_room.current_puzzle_id)
  returning * into inserted_message;
  insert into public.room_ai_requests (request_message_id, room_id, seat_id, user_id, puzzle_id, message_mode, cost, paid_from, lease_expires_at)
  values (inserted_message.id, target_room.id, sender_seat.id, current_user_id, target_room.current_puzzle_id, message_mode, mode_cost, paid_from_value, now() + interval '2 minutes');
  return jsonb_build_object('message', to_jsonb(inserted_message), 'request_id', inserted_message.id, 'room_id', target_room.id, 'puzzle_id', target_room.current_puzzle_id);
end;
$$;

revoke all on function public.send_room_chat_message(text, text, text, text, boolean),
  public.send_room_ai_request(text, text, text, text, boolean),
  public.get_room_chat_bootstrap(text, text) from public, anon, authenticated;
grant execute on function public.send_room_chat_message(text, text, text, text, boolean),
  public.send_room_ai_request(text, text, text, text, boolean),
  public.get_room_chat_bootstrap(text, text) to anon, authenticated;

-- Browser clients now use get_room_join_info and get_room_member_state.  Do
-- not leave the old table grants/policies as a bypass around those checks.
drop policy if exists "rooms are publicly readable" on public.rooms;
drop policy if exists "room seats are publicly readable" on public.room_seats;
revoke select on table public.rooms, public.room_seats from anon, authenticated;

-- Message polling uses the protected bootstrap endpoint, so activity metadata
-- no longer needs to be enumerable through the public Realtime doorbell table.
drop policy if exists "open room message events are readable" on public.room_message_events;
revoke select on table public.room_message_events from anon, authenticated;

notify pgrst, 'reload schema';
