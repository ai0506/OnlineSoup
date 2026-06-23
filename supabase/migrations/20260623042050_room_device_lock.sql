alter table public.room_seats
  add column if not exists active_session_id text,
  add column if not exists active_session_updated_at timestamptz;

drop function if exists public.can_use_room_session(text);

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

  if target_seat.active_session_id is null then
    update public.room_seats
    set active_session_id = current_session_id,
        active_session_updated_at = now()
    where id = target_seat.id;
    return true;
  end if;

  return target_seat.active_session_id = current_session_id;
end;
$$;

revoke all on function public.can_use_room_session(text) from public, anon, authenticated;
grant execute on function public.can_use_room_session(text) to authenticated;

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
    and (
      nullif((select auth.jwt() ->> 'session_id'), '') is null
      or room_seats.active_session_id = nullif((select auth.jwt() ->> 'session_id'), '')
    )
  order by
    case when rooms.owner_id = (select auth.uid()) then 0 else 1 end,
    rooms.created_at desc
  limit 1;
$$;

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

  if char_length(trim(room_name)) not between 2 and 30 then
    raise exception 'invalid_room_name';
  end if;

  if seat_count is null or seat_count < 1 then
    raise exception 'invalid_seat_count';
  end if;

  if seat_points is null or seat_points < 0 or seat_points > 100 then
    raise exception 'invalid_seat_points';
  end if;

  if room_password is not null and char_length(room_password) > 32 then
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
    if current_session_id is not null
      and existing_seat.active_session_id is not null
      and existing_seat.active_session_id <> current_session_id
    then
      raise exception 'room_device_in_use';
    end if;

    if current_session_id is not null and existing_seat.active_session_id is null then
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
      and room_seats.active_session_id <> current_session_id
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
      remaining_points = target_room.points_per_seat,
      occupied_at = null,
      active_session_id = null,
      active_session_updated_at = null
  where id = target_seat.id;
end;
$$;

revoke all on function public.get_my_active_room() from public, anon, authenticated;
revoke all on function public.create_room(text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.join_room_as_member(text, text) from public, anon, authenticated;
revoke all on function public.leave_room_as_member(text) from public, anon, authenticated;

grant execute on function public.get_my_active_room() to authenticated;
grant execute on function public.create_room(text, integer, integer, text) to authenticated;
grant execute on function public.join_room_as_member(text, text) to authenticated;
grant execute on function public.leave_room_as_member(text) to authenticated;

notify pgrst, 'reload schema';
