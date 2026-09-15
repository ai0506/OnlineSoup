-- Stop public signups from choosing their own starting balance. Admin-created
-- accounts are adjusted afterwards through the existing service-role-only RPC.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text :=
    nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  initial_points constant integer := 100;
begin
  if requested_username is null
    or requested_username !~ '^[A-Za-z0-9_]{3,8}$'
  then
    raise exception 'invalid_username';
  end if;

  insert into public.profiles (id, display_name, username, points)
  values (new.id, requested_username, requested_username, initial_points);

  insert into public.points_transactions (
    user_id,
    type,
    amount,
    balance_after
  )
  values (
    new.id,
    'signup_bonus',
    initial_points,
    initial_points
  );

  return new;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

-- Existing rooms are preserved even if a previous direct RPC call created an
-- oversized one. The new contract is enforced for every new or changed room.
alter table public.rooms
  drop constraint if exists rooms_max_members_check;

alter table public.rooms
  add constraint rooms_max_members_check
  check (max_members between 1 and 20) not valid;

create or replace function public.create_room(
  room_name text,
  seat_count integer default 5,
  seat_points integer default 15,
  room_password text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  current_points integer;
  total_cost integer;
  new_room_id uuid;
  new_code text;
  owner_name text;
  attempt integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if char_length(trim(room_name)) not between 2 and 8 then
    raise exception 'invalid_room_name';
  end if;

  if seat_count is null or seat_count not between 1 and 20 then
    raise exception 'invalid_seat_count';
  end if;

  if seat_points is null or seat_points < 0 or seat_points > 100 then
    raise exception 'invalid_seat_points';
  end if;

  if room_password is not null
    and nullif(room_password, '') is not null
    and room_password !~ '^[0-9]{6}$'
  then
    raise exception 'invalid_room_password';
  end if;

  total_cost := seat_count * seat_points;

  select profiles.points, profiles.username
  into current_points, owner_name
  from public.profiles
  where profiles.id = current_user_id
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if owner_name is null then
    raise exception 'username_required';
  end if;

  if exists (
    select 1
    from public.rooms
    join public.room_seats
      on room_seats.room_id = rooms.id
      and room_seats.user_id = current_user_id
    where rooms.status <> 'closed'
  ) then
    raise exception 'active_room_exists';
  end if;

  if current_points < total_cost then
    raise exception 'insufficient_points';
  end if;

  loop
    attempt := attempt + 1;
    new_code := public.generate_room_code();
    exit when not exists (
      select 1 from public.rooms where code = new_code
    );

    if attempt >= 20 then
      raise exception 'room_code_generation_failed';
    end if;
  end loop;

  if total_cost > 0 then
    update public.profiles
    set points = points - total_cost,
        updated_at = now()
    where id = current_user_id;
  end if;

  insert into public.rooms (
    code,
    name,
    owner_id,
    status,
    max_members,
    points_per_seat,
    reserved_points
  )
  values (
    new_code,
    trim(room_name),
    current_user_id,
    'waiting',
    seat_count,
    seat_points,
    total_cost
  )
  returning id into new_room_id;

  insert into public.room_private (room_id, password_hash)
  values (
    new_room_id,
    case
      when nullif(room_password, '') is null then null
      else extensions.crypt(room_password, extensions.gen_salt('bf'))
    end
  );

  insert into public.room_seats (
    room_id,
    seat_number,
    nickname,
    user_id,
    remaining_points,
    occupied_at,
    active_session_id,
    active_session_updated_at
  )
  select
    new_room_id,
    generated_seat.seat_number,
    case when generated_seat.seat_number = 1 then owner_name else null end,
    case
      when generated_seat.seat_number = 1 then current_user_id
      else null
    end,
    seat_points,
    case when generated_seat.seat_number = 1 then now() else null end,
    case when generated_seat.seat_number = 1 then current_session_id else null end,
    case when generated_seat.seat_number = 1 and current_session_id is not null then now() else null end
  from generate_series(1, seat_count) as generated_seat(seat_number);

  if total_cost > 0 then
    insert into public.points_transactions (
      user_id,
      room_id,
      type,
      amount,
      balance_after
    )
    values (
      current_user_id,
      new_room_id,
      'room_reservation',
      -total_cost,
      current_points - total_cost
    );
  end if;

  return new_code;
end;
$$;

-- A seat's balance is a room budget, not a member attribute. Releasing or
-- kicking a member therefore clears identity/session state but never refills
-- or truncates the budget that remains on that seat.
create or replace function public.leave_room_as_guest(
  room_code text,
  guest_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.guest_sessions%rowtype;
begin
  select guest_sessions.*
  into target_session
  from public.guest_sessions
  join public.rooms on rooms.id = guest_sessions.room_id
  where rooms.code = upper(trim(room_code))
    and guest_sessions.token_hash =
      encode(extensions.digest(guest_token, 'sha256'), 'hex')
  for update of guest_sessions;

  if not found then
    raise exception 'guest_membership_not_found';
  end if;

  delete from public.guest_sessions
  where id = target_session.id;

  perform set_config('app.room_exit_reason', 'left', true);

  update public.room_seats
  set nickname = null,
      user_id = null,
      occupied_at = null,
      active_session_id = null,
      active_session_updated_at = null
  where id = target_session.seat_id;
end;
$$;

create or replace function public.leave_room_as_member(
  room_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  target_room public.rooms%rowtype;
  target_seat public.room_seats%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.owner_id = current_user_id then
    raise exception 'room_owner_must_close';
  end if;

  select *
  into target_seat
  from public.room_seats
  where room_seats.room_id = target_room.id
    and room_seats.user_id = current_user_id
  for update;

  if not found then
    raise exception 'room_membership_not_found';
  end if;

  if current_session_id is not null
    and target_seat.active_session_id is not null
    and target_seat.active_session_id <> current_session_id
  then
    raise exception 'room_device_in_use';
  end if;

  update public.room_seats
  set nickname = null,
      user_id = null,
      occupied_at = null,
      active_session_id = null,
      active_session_updated_at = null
  where id = target_seat.id;
end;
$$;

create or replace function public.kick_guest(
  room_code text,
  target_seat_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.rooms%rowtype;
  target_seat public.room_seats%rowtype;
  target_session public.guest_sessions%rowtype;
  target_member_key text;
  removal_token_hash text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.owner_id <> current_user_id then
    raise exception 'not_room_owner';
  end if;

  select *
  into target_seat
  from public.room_seats
  where room_id = target_room.id
    and id = target_seat_id
    and seat_number <> 1
    and nickname is not null
  for update;

  if not found then
    raise exception 'guest_membership_not_found';
  end if;

  if target_seat.user_id is not null then
    target_member_key := 'user:' || target_seat.user_id::text;
    removal_token_hash := encode(
      extensions.digest(target_member_key, 'sha256'),
      'hex'
    );
  else
    select *
    into target_session
    from public.guest_sessions
    where room_id = target_room.id
      and seat_id = target_seat_id
    for update;

    if not found then
      raise exception 'guest_membership_not_found';
    end if;

    target_member_key := target_session.member_key;
    removal_token_hash := target_session.token_hash;
  end if;

  insert into public.guest_removals (
    room_id,
    token_hash,
    member_key,
    reason
  )
  values (
    target_room.id,
    removal_token_hash,
    target_member_key,
    'kicked'
  )
  on conflict (room_id, member_key)
  do update set token_hash = excluded.token_hash,
                reason = excluded.reason,
                created_at = now();

  delete from public.guest_sessions
  where room_id = target_room.id
    and seat_id = target_seat_id;

  perform set_config('app.room_exit_reason', 'kicked', true);

  update public.room_seats
  set nickname = null,
      user_id = null,
      occupied_at = null,
      active_session_id = null,
      active_session_updated_at = null
  where id = target_seat_id;
end;
$$;

-- The ordinary chat RPC must never become a paid AI shortcut. All three paid
-- modes are handled by send_room_ai_request instead.
create or replace function public.send_room_chat_message(
  room_code           text,
  message_content     text,
  guest_token         text    default null,
  message_mode        text    default 'chat',
  use_personal_points boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room          public.rooms%rowtype;
  current_user_id      uuid := (select auth.uid());
  sender_seat          public.room_seats%rowtype;
  inserted_message     public.room_messages%rowtype;
  guest_seat_id        uuid;
  recent_second_count  integer;
  recent_minute_count  integer;
begin
  if message_mode <> 'chat' then
    raise exception 'invalid_message_mode';
  end if;

  if char_length(trim(message_content)) not between 1 and 300 then
    raise exception 'invalid_message';
  end if;

  select * into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select * into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and seat_number = 1
      and nickname is not null
    for update;
  elsif current_user_id is not null then
    select * into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and user_id = current_user_id
      and nickname is not null
    for update;
  elsif guest_token is not null and guest_token <> '' then
    select gs.seat_id into guest_seat_id
    from public.guest_sessions gs
    where gs.room_id = target_room.id
      and gs.token_hash = encode(extensions.digest(guest_token, 'sha256'), 'hex');

    if guest_seat_id is not null then
      select * into sender_seat
      from public.room_seats
      where id = guest_seat_id
        and nickname is not null
      for update;
    end if;
  end if;

  if sender_seat.id is null then
    raise exception 'room_membership_required';
  end if;

  select count(*) into recent_second_count
  from public.room_messages rm
  where rm.seat_id = sender_seat.id
    and rm.message_mode = 'chat'
    and rm.created_at > now() - interval '1 second';

  if recent_second_count >= 2 then
    raise exception 'rate_limited';
  end if;

  select count(*) into recent_minute_count
  from public.room_messages rm
  where rm.seat_id = sender_seat.id
    and rm.message_mode = 'chat'
    and rm.created_at > now() - interval '60 seconds';

  if recent_minute_count >= 40 then
    raise exception 'rate_limited';
  end if;

  insert into public.room_messages (
    room_id, seat_id, sender_name, sender_seat_number,
    sender_type, message_type, message_mode, content
  )
  values (
    target_room.id,
    sender_seat.id,
    sender_seat.nickname,
    sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end,
    'chat',
    'chat',
    trim(message_content)
  )
  returning * into inserted_message;

  return to_jsonb(inserted_message);
end;
$$;

create or replace function public.player_safe_room_message_content(
  p_content text,
  p_message_type text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if p_message_type <> 'ai' then
    return p_content;
  end if;

  payload := p_content::jsonb;
  if jsonb_typeof(payload) <> 'object' then
    return p_content;
  end if;

  payload := payload - 'ask_audit' - 'cache_hit';
  if payload ->> 'kind' = 'reasoning_result' then
    payload := payload - 'coverage';
  end if;

  return payload::text;
exception
  when invalid_text_representation then
    return p_content;
end;
$$;

revoke all on function public.player_safe_room_message_content(text, text)
  from public, anon, authenticated;

create or replace function public.get_room_chat_bootstrap(
  room_code   text,
  guest_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room     public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  member_seat_id  uuid;
  topic           text;
  messages        jsonb;
begin
  select * into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select room_seats.id into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.seat_number = 1
      and room_seats.nickname is not null;
  elsif current_user_id is not null then
    select room_seats.id into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.user_id = current_user_id
      and room_seats.nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select guest_sessions.seat_id into member_seat_id
    from public.guest_sessions
    join public.room_seats on room_seats.id = guest_sessions.seat_id
    where guest_sessions.room_id = target_room.id
      and guest_sessions.token_hash =
        encode(extensions.digest(guest_token, 'sha256'), 'hex')
      and room_seats.nickname is not null;
  end if;

  if member_seat_id is null then
    raise exception 'room_membership_required';
  end if;

  select realtime_topic into topic
  from public.room_private
  where room_id = target_room.id;

  select coalesce(
    jsonb_agg(to_jsonb(recent_messages) order by recent_messages.created_at, recent_messages.id),
    '[]'::jsonb
  )
  into messages
  from (
    select id, room_id, seat_id, sender_name, sender_seat_number,
           sender_type, message_type, message_mode,
           public.player_safe_room_message_content(content, message_type::text) as content,
           puzzle_id, created_at
    from (
      select rm.id, rm.room_id, rm.seat_id, rm.sender_name, rm.sender_seat_number,
             rm.sender_type, rm.message_type, rm.message_mode, rm.content,
             rm.puzzle_id, rm.created_at
      from public.room_messages rm
      where rm.room_id = target_room.id
      order by rm.created_at desc, rm.id desc
      limit 100
    ) newest_first
  ) recent_messages;

  return jsonb_build_object(
    'realtime_topic', topic,
    'messages',       messages,
    'seat_id',        member_seat_id
  );
end;
$$;

revoke all on function public.leave_room_as_guest(text, text)
  from public, anon, authenticated;
revoke all on function public.leave_room_as_member(text)
  from public, anon, authenticated;
revoke all on function public.kick_guest(text, uuid)
  from public, anon, authenticated;
revoke all on function public.create_room(text, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.send_room_chat_message(text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.get_room_chat_bootstrap(text, text)
  from public, anon, authenticated;

grant execute on function public.leave_room_as_guest(text, text)
  to anon, authenticated;
grant execute on function public.leave_room_as_member(text)
  to authenticated;
grant execute on function public.kick_guest(text, uuid)
  to authenticated;
grant execute on function public.create_room(text, integer, integer, text)
  to authenticated;
grant execute on function public.send_room_chat_message(text, text, text, text, boolean)
  to anon, authenticated;
grant execute on function public.get_room_chat_bootstrap(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
