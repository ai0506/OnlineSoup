alter table public.profiles
  add column if not exists username text;

alter table public.profiles
  drop constraint if exists profiles_username_format_check;

alter table public.profiles
  add constraint profiles_username_format_check
  check (
    username is null
    or username ~ '^[A-Za-z0-9_]{3,8}$'
  );

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

alter table public.room_seats
  add column if not exists user_id uuid
  references public.profiles(id) on delete set null;

update public.room_seats
set user_id = rooms.owner_id
from public.rooms
where room_seats.room_id = rooms.id
  and room_seats.seat_number = 1;

update public.room_seats
set user_id = parsed_members.user_id
from (
  select
    filtered_sessions.seat_id,
    substring(filtered_sessions.member_key from 6)::uuid as user_id
  from (
    select guest_sessions.seat_id, guest_sessions.member_key
    from public.guest_sessions
    where guest_sessions.member_key ~
      '^user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) filtered_sessions
  join public.profiles
    on profiles.id = substring(filtered_sessions.member_key from 6)::uuid
) parsed_members
where room_seats.id = parsed_members.seat_id;

delete from public.guest_sessions
where member_key ~
  '^user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

with duplicate_members as (
  select
    room_seats.id,
    row_number() over (
      partition by room_seats.room_id, room_seats.user_id
      order by room_seats.seat_number
    ) as member_rank
  from public.room_seats
  where room_seats.user_id is not null
)
update public.room_seats
set nickname = null,
    user_id = null,
    occupied_at = null
from duplicate_members
where room_seats.id = duplicate_members.id
  and duplicate_members.member_rank > 1;

create unique index if not exists room_seats_room_user_idx
  on public.room_seats (room_id, user_id)
  where user_id is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text :=
    nullif(trim(new.raw_user_meta_data ->> 'username'), '');
begin
  if requested_username is null
    or requested_username !~ '^[A-Za-z0-9_]{3,8}$'
  then
    raise exception 'invalid_username';
  end if;

  insert into public.profiles (id, display_name, username, points)
  values (new.id, requested_username, requested_username, 100);

  insert into public.points_transactions (
    user_id,
    type,
    amount,
    balance_after
  )
  values (
    new.id,
    'signup_bonus',
    100,
    100
  );

  return new;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

create or replace function public.is_username_available(
  requested_username text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    requested_username is not null
    and trim(requested_username) ~ '^[A-Za-z0-9_]{3,8}$'
    and not exists (
      select 1
      from public.profiles
      where lower(profiles.username) = lower(trim(requested_username))
    );
$$;

create or replace function public.set_my_username(
  requested_username text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_username text;
  next_username text := trim(requested_username);
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if next_username is null
    or next_username !~ '^[A-Za-z0-9_]{3,8}$'
  then
    raise exception 'invalid_username';
  end if;

  select profiles.username
  into current_username
  from public.profiles
  where profiles.id = current_user_id
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if current_username = next_username then
    return;
  end if;

  if current_username is not null and exists (
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

  if current_username is null and exists (
    select 1
    from public.room_seats own_seat
    join public.rooms on rooms.id = own_seat.room_id
    join public.room_seats conflicting_seat
      on conflicting_seat.room_id = own_seat.room_id
      and conflicting_seat.id <> own_seat.id
      and lower(conflicting_seat.nickname) = lower(next_username)
    where own_seat.user_id = current_user_id
      and rooms.status <> 'closed'
  ) then
    raise exception 'room_name_conflict';
  end if;

  update public.profiles
  set username = next_username,
      display_name = next_username,
      updated_at = now()
  where id = current_user_id;

  if current_username is null then
    update public.room_seats
    set nickname = next_username
    from public.rooms
    where room_seats.room_id = rooms.id
      and room_seats.user_id = current_user_id
      and rooms.status <> 'closed';
  end if;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

create or replace function public.admin_set_username(
  target_user_id uuid,
  requested_username text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_username text;
  next_username text := trim(requested_username);
begin
  if coalesce(
    current_setting('request.jwt.claim.role', true),
    ''
  ) <> 'service_role' then
    raise exception 'admin_required';
  end if;

  if next_username is null
    or next_username !~ '^[A-Za-z0-9_]{3,8}$'
  then
    raise exception 'invalid_username';
  end if;

  select profiles.username
  into current_username
  from public.profiles
  where profiles.id = target_user_id
  for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if current_username = next_username then
    return;
  end if;

  if current_username is not null and exists (
    select 1
    from public.rooms
    left join public.room_seats
      on room_seats.room_id = rooms.id
      and room_seats.user_id = target_user_id
    where rooms.status <> 'closed'
      and (
        rooms.owner_id = target_user_id
        or room_seats.id is not null
      )
  ) then
    raise exception 'active_room_exists';
  end if;

  if current_username is null and exists (
    select 1
    from public.room_seats own_seat
    join public.rooms on rooms.id = own_seat.room_id
    join public.room_seats conflicting_seat
      on conflicting_seat.room_id = own_seat.room_id
      and conflicting_seat.id <> own_seat.id
      and lower(conflicting_seat.nickname) = lower(next_username)
    where own_seat.user_id = target_user_id
      and rooms.status <> 'closed'
  ) then
    raise exception 'room_name_conflict';
  end if;

  update public.profiles
  set username = next_username,
      display_name = next_username,
      updated_at = now()
  where id = target_user_id;

  if current_username is null then
    update public.room_seats
    set nickname = next_username
    from public.rooms
    where room_seats.room_id = rooms.id
      and room_seats.user_id = target_user_id
      and rooms.status <> 'closed';
  end if;
exception
  when unique_violation then
    raise exception 'username_taken';
end;
$$;

create or replace function public.get_my_active_room()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rooms.code
  from public.rooms
  left join public.room_seats
    on room_seats.room_id = rooms.id
    and room_seats.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and rooms.status <> 'closed'
    and (
      rooms.owner_id = (select auth.uid())
      or room_seats.id is not null
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

  if seat_points is null or seat_points not between 1 and 100 then
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

  update public.profiles
  set points = points - total_cost,
      updated_at = now()
  where id = current_user_id;

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

drop function if exists public.join_room_as_guest(text, text, text);

create or replace function public.join_room_as_guest(
  room_code text,
  guest_nickname text,
  room_password text default null,
  guest_identity text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  current_member_key text;
  next_nickname text := trim(guest_nickname);
  stored_password_hash text;
  selected_seat_id uuid;
  raw_token text;
  previous_membership record;
  previous_room_codes text[] := array[]::text[];
begin
  if current_user_id is not null then
    raise exception 'registered_member_required';
  end if;

  if next_nickname is null
    or next_nickname !~ '^[A-Za-z0-9_]{3,8}$'
  then
    raise exception 'invalid_nickname';
  end if;

  if guest_identity is null
    or guest_identity !~ '^[a-f0-9]{64}$'
  then
    raise exception 'guest_identity_required';
  end if;

  current_member_key :=
    'guest:' || encode(
      extensions.digest(guest_identity, 'sha256'),
      'hex'
    );

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
    from public.profiles
    where lower(profiles.username) = lower(next_nickname)
  ) then
    raise exception 'nickname_registered';
  end if;

  if exists (
    select 1
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.nickname is not null
      and lower(room_seats.nickname) = lower(next_nickname)
  ) then
    raise exception 'nickname_in_room';
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

  for previous_membership in
    select
      guest_sessions.id,
      guest_sessions.seat_id,
      rooms.code,
      rooms.points_per_seat
    from public.guest_sessions
    join public.rooms on rooms.id = guest_sessions.room_id
    where guest_sessions.member_key = current_member_key
      and guest_sessions.room_id <> target_room.id
    for update of guest_sessions
  loop
    delete from public.guest_sessions
    where id = previous_membership.id;

    update public.room_seats
    set nickname = null,
        user_id = null,
        remaining_points = previous_membership.points_per_seat,
        occupied_at = null
    where id = previous_membership.seat_id;

    previous_room_codes :=
      array_append(previous_room_codes, previous_membership.code);
  end loop;

  update public.room_seats
  set nickname = next_nickname,
      user_id = null,
      occupied_at = now()
  where id = selected_seat_id;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.guest_sessions (
    room_id,
    seat_id,
    token_hash,
    member_key
  )
  values (
    target_room.id,
    selected_seat_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    current_member_key
  );

  return jsonb_build_object(
    'seat_id', selected_seat_id,
    'guest_token', raw_token,
    'previous_room_codes', to_jsonb(previous_room_codes)
  );
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
  current_username text;
  current_member_key text;
  stored_password_hash text;
  selected_seat_id uuid;
  existing_seat_id uuid;
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

  select room_seats.id
  into existing_seat_id
  from public.room_seats
  where room_seats.room_id = target_room.id
    and room_seats.user_id = current_user_id;

  if existing_seat_id is not null then
    return jsonb_build_object(
      'seat_id', existing_seat_id,
      'previous_room_codes', '[]'::jsonb
    );
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
    for update of room_seats
  loop
    update public.room_seats
    set nickname = null,
        user_id = null,
        remaining_points = previous_seat.points_per_seat,
        occupied_at = null
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
      occupied_at = now()
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
  target_room public.rooms%rowtype;
  target_seat_id uuid;
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

  select room_seats.id
  into target_seat_id
  from public.room_seats
  where room_seats.room_id = target_room.id
    and room_seats.user_id = current_user_id
  for update;

  if target_seat_id is null then
    raise exception 'room_membership_not_found';
  end if;

  update public.room_seats
  set nickname = null,
      user_id = null,
      remaining_points = target_room.points_per_seat,
      occupied_at = null
  where id = target_seat_id;
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

  update public.room_seats
  set nickname = null,
      user_id = null,
      remaining_points = target_room.points_per_seat,
      occupied_at = null
  where id = target_seat_id;
end;
$$;

create or replace function public.get_room_exit_reason(
  room_code text,
  guest_token text default null,
  guest_identity text default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  current_member_key text;
  hashed_token text;
begin
  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    return 'not_found';
  end if;

  if target_room.status = 'closed' then
    return 'closed';
  end if;

  if current_user_id is not null then
    current_member_key := 'user:' || current_user_id::text;

    if exists (
      select 1
      from public.guest_removals
      where room_id = target_room.id
        and member_key = current_member_key
        and reason = 'kicked'
    ) then
      return 'kicked';
    end if;

    if target_room.owner_id = current_user_id or exists (
      select 1
      from public.room_seats
      where room_seats.room_id = target_room.id
        and room_seats.user_id = current_user_id
    ) then
      return 'active';
    end if;
  end if;

  if guest_token is not null and guest_token <> '' then
    hashed_token :=
      encode(extensions.digest(guest_token, 'sha256'), 'hex');

    if exists (
      select 1
      from public.guest_removals
      where room_id = target_room.id
        and token_hash = hashed_token
        and reason = 'kicked'
    ) then
      return 'kicked';
    end if;

    if exists (
      select 1
      from public.guest_sessions
      where room_id = target_room.id
        and token_hash = hashed_token
    ) then
      return 'active';
    end if;
  end if;

  if guest_identity is not null
    and guest_identity ~ '^[a-f0-9]{64}$'
  then
    current_member_key :=
      'guest:' || encode(
        extensions.digest(guest_identity, 'sha256'),
        'hex'
      );

    if exists (
      select 1
      from public.guest_removals
      where room_id = target_room.id
        and member_key = current_member_key
        and reason = 'kicked'
    ) then
      return 'kicked';
    end if;
  end if;

  return 'active';
end;
$$;

create or replace function public.get_room_chat_bootstrap(
  room_code text,
  guest_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  member_seat_id uuid;
  topic text;
  messages jsonb;
begin
  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select room_seats.id
    into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.seat_number = 1
      and room_seats.nickname is not null;
  elsif current_user_id is not null then
    select room_seats.id
    into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.user_id = current_user_id
      and room_seats.nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select guest_sessions.seat_id
    into member_seat_id
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

  select realtime_topic
  into topic
  from public.room_private
  where room_id = target_room.id;

  select coalesce(jsonb_agg(to_jsonb(recent_messages)), '[]'::jsonb)
  into messages
  from (
    select
      id,
      room_id,
      seat_id,
      sender_name,
      message_type,
      content,
      created_at
    from (
      select
        room_messages.id,
        room_messages.room_id,
        room_messages.seat_id,
        room_messages.sender_name,
        room_messages.message_type,
        room_messages.content,
        room_messages.created_at
      from public.room_messages
      where room_messages.room_id = target_room.id
      order by room_messages.created_at desc, room_messages.id desc
      limit 100
    ) newest_first
    order by created_at, id
  ) recent_messages;

  return jsonb_build_object(
    'realtime_topic', topic,
    'messages', messages,
    'seat_id', member_seat_id
  );
end;
$$;

create or replace function public.send_room_chat_message(
  room_code text,
  message_content text,
  guest_token text default null
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
begin
  if char_length(trim(message_content)) not between 1 and 500 then
    raise exception 'invalid_message';
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select *
    into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and seat_number = 1
      and nickname is not null;
  elsif current_user_id is not null then
    select *
    into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and user_id = current_user_id
      and nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select room_seats.*
    into sender_seat
    from public.guest_sessions
    join public.room_seats on room_seats.id = guest_sessions.seat_id
    where guest_sessions.room_id = target_room.id
      and guest_sessions.token_hash =
        encode(extensions.digest(guest_token, 'sha256'), 'hex')
      and room_seats.nickname is not null;
  end if;

  if sender_seat.id is null then
    raise exception 'room_membership_required';
  end if;

  insert into public.room_messages (
    room_id,
    seat_id,
    sender_name,
    content
  )
  values (
    target_room.id,
    sender_seat.id,
    sender_seat.nickname,
    trim(message_content)
  )
  returning * into inserted_message;

  return to_jsonb(inserted_message);
end;
$$;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;
revoke all on function public.is_username_available(text)
  from public, anon, authenticated;
revoke all on function public.set_my_username(text)
  from public, anon, authenticated;
revoke all on function public.admin_set_username(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_active_room()
  from public, anon, authenticated;
revoke all on function public.create_room(text, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.join_room_as_guest(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.join_room_as_member(text, text)
  from public, anon, authenticated;
revoke all on function public.leave_room_as_member(text)
  from public, anon, authenticated;
revoke all on function public.kick_guest(text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_room_exit_reason(text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_room_chat_bootstrap(text, text)
  from public, anon, authenticated;
revoke all on function public.send_room_chat_message(text, text, text)
  from public, anon, authenticated;

grant execute on function public.is_username_available(text)
  to anon, authenticated;
grant execute on function public.set_my_username(text)
  to authenticated;
grant execute on function public.admin_set_username(uuid, text)
  to service_role;
grant execute on function public.get_my_active_room()
  to authenticated;
grant execute on function public.create_room(text, integer, integer, text)
  to authenticated;
grant execute on function public.join_room_as_guest(text, text, text, text)
  to anon;
grant execute on function public.join_room_as_member(text, text)
  to authenticated;
grant execute on function public.leave_room_as_member(text)
  to authenticated;
grant execute on function public.kick_guest(text, uuid)
  to authenticated;
grant execute on function public.get_room_exit_reason(text, text, text)
  to anon, authenticated;
grant execute on function public.get_room_chat_bootstrap(text, text)
  to anon, authenticated;
grant execute on function public.send_room_chat_message(text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
