-- Multi-device room takeover:
-- 1. get_my_active_room: remove session filter so any device sees the active room
-- 2. can_use_room_session: take over (update session_id) instead of returning false
-- 3. is_my_seat_session_active: read-only check for the displaced device to self-detect
-- 4. join_room_as_member: take over when same user rejoins with different session

create or replace function public.get_my_active_room()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rooms.code
  from public.rooms
  join public.room_seats
    on room_seats.room_id = rooms.id
    and room_seats.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and rooms.status <> 'closed'
  order by
    case when rooms.owner_id = (select auth.uid()) then 0 else 1 end,
    rooms.created_at desc
  limit 1;
$$;

-- Read-only check: is this session still the active one for the seat?
-- Device A calls this periodically; if Device B took over, returns false.
create or replace function public.is_my_seat_session_active(p_room_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  seat_session_id text;
begin
  if current_user_id is null then
    return false;
  end if;

  if current_session_id is null then
    return true;
  end if;

  select rs.active_session_id
  into seat_session_id
  from public.room_seats rs
  join public.rooms r on r.id = rs.room_id
  where r.code = upper(trim(p_room_code))
    and rs.user_id = current_user_id;

  if not found then
    return false;
  end if;

  if seat_session_id is null then
    return true;
  end if;

  return seat_session_id = current_session_id;
end;
$$;

revoke all on function public.is_my_seat_session_active(text) from public, anon, authenticated;
grant execute on function public.is_my_seat_session_active(text) to authenticated;

-- can_use_room_session: always take over when entering room page
create or replace function public.can_use_room_session(room_code text)
returns boolean
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
    return false;
  end if;

  if current_session_id is null then
    return true;
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found or target_room.status = 'closed' then
    return false;
  end if;

  select *
  into target_seat
  from public.room_seats
  where room_id = target_room.id
    and user_id = current_user_id
  for update;

  if not found then
    return false;
  end if;

  -- Always take over: update session_id to current device
  if target_seat.active_session_id is distinct from current_session_id then
    update public.room_seats
    set active_session_id = current_session_id,
        active_session_updated_at = now()
    where id = target_seat.id;
  end if;

  return true;
end;
$$;

-- join_room_as_member: take over when same user rejoins with different session
create or replace function public.join_room_as_member(
  room_code text,
  room_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  current_username text;
  current_member_key text;
  stored_password_hash text;
  selected_seat_id uuid;
  existing_seat public.room_seats%rowtype;
  previous_seat record;
  closed_room record;
  previous_room_codes text[] := array[]::text[];
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select profiles.username
  into current_username
  from public.profiles
  where profiles.id = current_user_id
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if current_username is null then
    raise exception 'username_required';
  end if;

  current_member_key := 'user:' || current_user_id::text;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status <> 'waiting' then
    raise exception 'room_not_joinable';
  end if;

  if exists (
    select 1
    from public.guest_removals
    where room_id = target_room.id
      and member_key = current_member_key
      and reason = 'kicked'
  ) then
    raise exception 'guest_kicked';
  end if;

  if current_user_id = target_room.owner_id then
    raise exception 'owner_already_seated';
  end if;

  select *
  into existing_seat
  from public.room_seats
  where room_seats.room_id = target_room.id
    and room_seats.user_id = current_user_id
  for update;

  if found then
    -- Take over: update session_id to current device
    if current_session_id is not null
      and existing_seat.active_session_id is distinct from current_session_id
    then
      update public.room_seats
      set active_session_id = current_session_id,
          active_session_updated_at = now()
      where id = existing_seat.id;
    end if;

    return jsonb_build_object(
      'seat_id', existing_seat.id,
      'previous_room_codes', '[]'::jsonb
    );
  end if;

  if exists (
    select 1
    from public.rooms
    join public.room_seats
      on room_seats.room_id = rooms.id
      and room_seats.user_id = current_user_id
    where rooms.status <> 'closed'
      and rooms.id <> target_room.id
      and current_session_id is not null
      and room_seats.active_session_id is not null
      and room_seats.active_session_id = current_session_id
  ) then
    raise exception 'active_room_exists';
  end if;

  select password_hash
  into stored_password_hash
  from public.room_private
  where room_id = target_room.id;

  if stored_password_hash is not null
    and (
      room_password is null
      or extensions.crypt(room_password, stored_password_hash) <>
        stored_password_hash
    )
  then
    raise exception 'wrong_password';
  end if;

  if exists (
    select 1
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.nickname is not null
      and lower(room_seats.nickname) = lower(current_username)
  ) then
    raise exception 'username_in_room';
  end if;

  select id
  into selected_seat_id
  from public.room_seats
  where room_id = target_room.id
    and nickname is null
  order by seat_number
  for update skip locked
  limit 1;

  if selected_seat_id is null then
    raise exception 'room_full';
  end if;

  for previous_seat in
    select
      room_seats.id,
      rooms.code,
      rooms.points_per_seat
    from public.room_seats
    join public.rooms on rooms.id = room_seats.room_id
    where room_seats.user_id = current_user_id
      and room_seats.room_id <> target_room.id
      and rooms.status <> 'closed'
      and (
        current_session_id is null
        or room_seats.active_session_id is null
        or room_seats.active_session_id = current_session_id
      )
    for update of room_seats
  loop
    update public.room_seats
    set nickname = null,
        user_id = null,
        remaining_points = previous_seat.points_per_seat,
        occupied_at = null,
        active_session_id = null,
        active_session_updated_at = null
    where id = previous_seat.id;

    previous_room_codes :=
      array_append(previous_room_codes, previous_seat.code);
  end loop;

  delete from public.guest_sessions
  where member_key = current_member_key;

  for closed_room in
    update public.rooms
    set status = 'closed',
        updated_at = now()
    where owner_id = current_user_id
      and status <> 'closed'
      and id <> target_room.id
    returning code
  loop
    previous_room_codes :=
      array_append(previous_room_codes, closed_room.code);
  end loop;

  update public.room_seats
  set nickname = current_username,
      user_id = current_user_id,
      occupied_at = now(),
      active_session_id = current_session_id,
      active_session_updated_at = case
        when current_session_id is null then null
        else now()
      end
  where id = selected_seat_id;

  return jsonb_build_object(
    'seat_id', selected_seat_id,
    'previous_room_codes', to_jsonb(previous_room_codes)
  );
end;
$$;

revoke all on function public.get_my_active_room() from public, anon, authenticated;
revoke all on function public.can_use_room_session(text) from public, anon, authenticated;
revoke all on function public.join_room_as_member(text, text) from public, anon, authenticated;

grant execute on function public.get_my_active_room() to authenticated;
grant execute on function public.can_use_room_session(text) to authenticated;
grant execute on function public.join_room_as_member(text, text) to authenticated;

notify pgrst, 'reload schema';
