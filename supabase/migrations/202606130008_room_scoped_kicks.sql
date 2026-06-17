alter table public.guest_sessions
  add column if not exists member_key text;

update public.guest_sessions
set member_key = 'legacy:' || token_hash
where member_key is null;

alter table public.guest_sessions
  alter column member_key set not null;

alter table public.guest_removals
  add column if not exists member_key text;

update public.guest_removals
set member_key = 'legacy:' || token_hash
where member_key is null;

alter table public.guest_removals
  alter column member_key set not null;

create unique index if not exists guest_removals_room_member_key_idx
  on public.guest_removals (room_id, member_key);

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
  stored_password_hash text;
  selected_seat_id uuid;
  raw_token text;
begin
  if char_length(trim(guest_nickname)) not between 1 and 20 then
    raise exception 'invalid_nickname';
  end if;

  if current_user_id is not null then
    current_member_key := 'user:' || current_user_id::text;
  elsif guest_identity is not null
    and guest_identity ~ '^[a-f0-9]{64}$'
  then
    current_member_key :=
      'guest:' || encode(extensions.digest(guest_identity, 'sha256'), 'hex');
  else
    raise exception 'guest_identity_required';
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
    'guest_token', raw_token
  );
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
  target_session public.guest_sessions%rowtype;
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
  into target_session
  from public.guest_sessions
  where room_id = target_room.id
    and seat_id = target_seat_id
  for update;

  if not found then
    raise exception 'guest_membership_not_found';
  end if;

  insert into public.guest_removals (
    room_id,
    token_hash,
    member_key,
    reason
  )
  values (
    target_room.id,
    target_session.token_hash,
    target_session.member_key,
    'kicked'
  )
  on conflict (room_id, member_key)
  do update set token_hash = excluded.token_hash,
                reason = excluded.reason,
                created_at = now();

  delete from public.guest_sessions
  where id = target_session.id;

  update public.room_seats
  set nickname = null,
      remaining_points = target_room.points_per_seat,
      occupied_at = null
  where id = target_session.seat_id;
end;
$$;

drop function if exists public.get_room_exit_reason(text, text);

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
  elsif guest_identity is not null
    and guest_identity ~ '^[a-f0-9]{64}$'
  then
    current_member_key :=
      'guest:' || encode(extensions.digest(guest_identity, 'sha256'), 'hex');
  end if;

  if current_member_key is not null and exists (
    select 1
    from public.guest_removals
    where room_id = target_room.id
      and member_key = current_member_key
      and reason = 'kicked'
  ) then
    return 'kicked';
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
  end if;

  return 'active';
end;
$$;

revoke all on function public.join_room_as_guest(text, text, text, text)
  from public;
revoke all on function public.kick_guest(text, uuid) from public;
revoke all on function public.get_room_exit_reason(text, text, text)
  from public;

grant execute on function public.join_room_as_guest(text, text, text, text)
  to anon, authenticated;
grant execute on function public.kick_guest(text, uuid) to authenticated;
grant execute on function public.get_room_exit_reason(text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
