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
  previous_membership record;
  closed_room record;
  previous_room_codes text[] := array[]::text[];
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
        remaining_points = previous_membership.points_per_seat,
        occupied_at = null
    where id = previous_membership.seat_id;

    previous_room_codes :=
      array_append(previous_room_codes, previous_membership.code);
  end loop;

  if current_user_id is not null then
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
    'guest_token', raw_token,
    'previous_room_codes', to_jsonb(previous_room_codes)
  );
end;
$$;

revoke all on function public.join_room_as_guest(text, text, text, text)
  from public;
grant execute on function public.join_room_as_guest(text, text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
