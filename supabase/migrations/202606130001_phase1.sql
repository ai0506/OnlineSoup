create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.room_status as enum ('waiting', 'playing', 'closed');
create type public.points_transaction_type as enum (
  'signup_bonus',
  'room_reservation'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  points integer not null default 100 check (points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  name text not null check (char_length(name) between 2 and 30),
  owner_id uuid not null references public.profiles(id),
  status public.room_status not null default 'waiting',
  max_members integer not null check (max_members >= 1),
  points_per_seat integer not null check (points_per_seat between 1 and 100),
  reserved_points integer not null check (reserved_points > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_private (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text
);

create table public.room_seats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat_number integer not null check (seat_number > 0),
  nickname text check (nickname is null or char_length(nickname) between 1 and 20),
  remaining_points integer not null check (remaining_points >= 0),
  occupied_at timestamptz,
  unique (room_id, seat_number)
);

create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat_id uuid not null unique references public.room_seats(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.points_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  room_id uuid references public.rooms(id),
  type public.points_transaction_type not null,
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index rooms_status_created_at_idx
  on public.rooms (status, created_at desc);
create unique index rooms_one_active_per_owner_idx
  on public.rooms (owner_id)
  where status <> 'closed';
create index room_seats_room_id_idx
  on public.room_seats (room_id, seat_number);
create index guest_sessions_room_id_idx
  on public.guest_sessions (room_id);
create index points_transactions_user_id_idx
  on public.points_transactions (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_private enable row level security;
alter table public.room_seats enable row level security;
alter table public.guest_sessions enable row level security;
alter table public.points_transactions enable row level security;

create policy "users can read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "rooms are publicly readable"
  on public.rooms for select
  to anon, authenticated
  using (status <> 'closed');

create policy "room seats are publicly readable"
  on public.room_seats for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.rooms
      where rooms.id = room_seats.room_id
        and rooms.status <> 'closed'
    )
  );

create policy "users can read own points history"
  on public.points_transactions for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.room_private from anon, authenticated;
revoke all on public.guest_sessions from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select on table public.rooms to anon, authenticated;
grant select on table public.room_seats to anon, authenticated;
grant select on table public.points_transactions to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_name text;
begin
  initial_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(coalesce(new.email, '新玩家'), '@', 1)
  );

  insert into public.profiles (id, display_name, points)
  values (new.id, left(initial_name, 30), 100);

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
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  index_value integer;
begin
  for counter in 1..6 loop
    index_value := floor(random() * length(alphabet))::integer + 1;
    result := result || substr(alphabet, index_value, 1);
  end loop;
  return result;
end;
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

  if current_points < total_cost then
    raise exception 'insufficient_points';
  end if;

  if exists (
    select 1
    from public.rooms
    where owner_id = current_user_id
      and status <> 'closed'
  ) then
    raise exception 'active_room_exists';
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

create or replace function public.verify_guest_membership(
  room_code text,
  guest_token text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guest_sessions
    join public.rooms on rooms.id = guest_sessions.room_id
    where rooms.code = upper(trim(room_code))
      and guest_sessions.token_hash =
        encode(extensions.digest(guest_token, 'sha256'), 'hex')
  );
$$;

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
  target_points integer;
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

  select points_per_seat
  into target_points
  from public.rooms
  where id = target_session.room_id;

  delete from public.guest_sessions
  where id = target_session.id;

  update public.room_seats
  set nickname = null,
      remaining_points = target_points,
      occupied_at = null
  where id = target_session.seat_id;
end;
$$;

revoke all on function public.create_room(text, integer, integer, text)
  from public;
revoke all on function public.join_room_as_guest(text, text, text)
  from public;
revoke all on function public.verify_guest_membership(text, text)
  from public;
revoke all on function public.close_room(text)
  from public;
revoke all on function public.leave_room_as_guest(text, text)
  from public;

grant execute on function public.create_room(text, integer, integer, text)
  to authenticated;
grant execute on function public.join_room_as_guest(text, text, text)
  to anon, authenticated;
grant execute on function public.verify_guest_membership(text, text)
  to anon, authenticated;
grant execute on function public.close_room(text)
  to authenticated;
grant execute on function public.leave_room_as_guest(text, text)
  to anon, authenticated;
