alter table public.rooms
  drop constraint if exists rooms_max_members_check;

alter table public.rooms
  add constraint rooms_max_members_check check (max_members >= 1);

create unique index if not exists rooms_one_active_per_owner_idx
  on public.rooms (owner_id)
  where status <> 'closed';

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

  if seat_count < 1 then
    raise exception 'invalid_seat_count';
  end if;

  if seat_points not between 1 and 100 then
    raise exception 'invalid_seat_points';
  end if;

  if room_password is not null and char_length(room_password) > 32 then
    raise exception 'invalid_room_password';
  end if;

  total_cost := seat_count * seat_points;

  select points, display_name
  into current_points, owner_name
  from public.profiles
  where id = current_user_id
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if exists (
    select 1
    from public.rooms
    where owner_id = current_user_id
      and status <> 'closed'
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

  update public.profiles
  set points = points - total_cost,
      updated_at = now()
  where id = current_user_id;

  insert into public.rooms (
    code,
    name,
    owner_id,
    max_members,
    points_per_seat,
    reserved_points
  )
  values (
    new_code,
    trim(room_name),
    current_user_id,
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
    remaining_points,
    occupied_at
  )
  select
    new_room_id,
    seat_number,
    case when seat_number = 1 then owner_name else null end,
    seat_points,
    case when seat_number = 1 then now() else null end
  from generate_series(1, seat_count) as seat_number;

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

  return new_code;
end;
$$;

create or replace function public.join_room_as_guest(
  room_code text,
  guest_nickname text,
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
  stored_password_hash text;
  selected_seat_id uuid;
  raw_token text;
begin
  if char_length(trim(guest_nickname)) not between 1 and 20 then
    raise exception 'invalid_nickname';
  end if;

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

  if current_user_id = target_room.owner_id then
    raise exception 'owner_already_seated';
  end if;

  if current_user_id is not null and exists (
    select 1
    from public.rooms
    where owner_id = current_user_id
      and status <> 'closed'
      and id <> target_room.id
  ) then
    raise exception 'active_room_conflict';
  end if;

  select password_hash
  into stored_password_hash
  from public.room_private
  where room_id = target_room.id;

  if stored_password_hash is not null
    and (
      room_password is null
      or extensions.crypt(room_password, stored_password_hash) <> stored_password_hash
    )
  then
    raise exception 'wrong_password';
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

  update public.room_seats
  set nickname = trim(guest_nickname),
      occupied_at = now()
  where id = selected_seat_id;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.guest_sessions (
    room_id,
    seat_id,
    token_hash
  )
  values (
    target_room.id,
    selected_seat_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex')
  );

  return jsonb_build_object(
    'seat_id', selected_seat_id,
    'guest_token', raw_token
  );
end;
$$;

create or replace function public.close_room(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.rooms%rowtype;
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

  update public.rooms
  set status = 'closed',
      updated_at = now()
  where id = target_room.id;
end;
$$;

revoke all on function public.close_room(text) from public;
grant execute on function public.close_room(text) to authenticated;
