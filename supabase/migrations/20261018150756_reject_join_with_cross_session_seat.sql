-- 用户在其他未关闭房间已有任意会话占用的座位时拒绝加入（active_room_exists），不再只拦同会话座位；仅释放无会话的旧座位。
create or replace function public.join_room_as_member(room_code text, room_password text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
  previous_room_codes text[] := array[]::text[];
begin
  perform soup_cli.lock_transaction();
  if soup_cli.is_cli() then raise exception 'USE_PLAYER_API'; end if;
  perform soup_cli.reject_unconfirmed_cli_takeover(room_code);
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
    where rooms.owner_id = current_user_id
      and rooms.status <> 'closed'
      and rooms.id <> target_room.id
  ) then
    raise exception 'owned_room_active';
  end if;

  if exists (
    select 1
    from public.rooms
    join public.room_seats
      on room_seats.room_id = rooms.id
      and room_seats.user_id = current_user_id
    where rooms.status <> 'closed'
      and rooms.id <> target_room.id
      and room_seats.active_session_id is not null
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
      and room_seats.active_session_id is null
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
$function$;

revoke all on function public.join_room_as_member(text, text) from public, anon, authenticated;
grant execute on function public.join_room_as_member(text, text) to authenticated;

notify pgrst, 'reload schema';
