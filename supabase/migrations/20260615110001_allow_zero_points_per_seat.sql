-- Allow points_per_seat = 0 (free rooms)

alter table public.rooms
  drop constraint if exists rooms_points_per_seat_check;

alter table public.rooms
  add constraint rooms_points_per_seat_check
  check (points_per_seat between 0 and 100);

alter table public.rooms
  drop constraint if exists rooms_reserved_points_check;

alter table public.rooms
  add constraint rooms_reserved_points_check
  check (reserved_points >= 0);

-- Rewrite create_room to allow seat_points = 0
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
    left join public.room_seats
      on room_seats.room_id = rooms.id
      and room_seats.user_id = current_user_id
    where rooms.status <> 'closed'
      and (
        rooms.owner_id = current_user_id
        or room_seats.id is not null
      )
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
    occupied_at
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
    case when generated_seat.seat_number = 1 then now() else null end
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

revoke all on function public.create_room(text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_room(text, integer, integer, text)
  to authenticated;

notify pgrst, 'reload schema';
