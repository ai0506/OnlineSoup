alter table public.room_messages
  drop constraint if exists room_messages_message_type_check,
  add constraint room_messages_message_type_check
    check (message_type in ('chat', 'system'));

create or replace function public.record_room_seat_system_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_reason text;
  player_name text;
  player_seat_number integer;
  player_type text;
  system_content text;
begin
  if tg_op = 'INSERT' then
    if new.nickname is null then
      return new;
    end if;

    player_name := new.nickname;
    player_seat_number := new.seat_number;
    player_type := case when new.user_id is null then 'guest' else 'registered' end;
    system_content := new.nickname || ' 加入了房间';
  elsif old.nickname is null and new.nickname is not null then
    player_name := new.nickname;
    player_seat_number := new.seat_number;
    player_type := case when new.user_id is null then 'guest' else 'registered' end;
    system_content := new.nickname || ' 加入了房间';
  elsif old.nickname is not null and new.nickname is null then
    event_reason := current_setting('app.room_exit_reason', true);
    player_name := old.nickname;
    player_seat_number := old.seat_number;
    player_type := case when old.user_id is null then 'guest' else 'registered' end;
    system_content := case
      when event_reason = 'kicked'
        then old.nickname || ' 被房主移出了房间'
      else old.nickname || ' 退出了房间'
    end;
  else
    return new;
  end if;

  insert into public.room_messages (
    room_id,
    seat_id,
    sender_name,
    sender_seat_number,
    sender_type,
    message_type,
    content
  )
  values (
    new.room_id,
    new.id,
    player_name,
    player_seat_number,
    player_type,
    'system',
    system_content
  );

  return new;
end;
$$;

revoke all on function public.record_room_seat_system_message()
  from public, anon, authenticated;

drop trigger if exists room_seat_system_message on public.room_seats;
create trigger room_seat_system_message
after insert or update of nickname on public.room_seats
for each row
execute function public.record_room_seat_system_message();

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

  perform set_config('app.room_exit_reason', 'left', true);

  update public.room_seats
  set nickname = null,
      user_id = null,
      remaining_points = target_points,
      occupied_at = null
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

  perform set_config('app.room_exit_reason', 'left', true);

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

  perform set_config('app.room_exit_reason', 'kicked', true);

  update public.room_seats
  set nickname = null,
      user_id = null,
      remaining_points = target_room.points_per_seat,
      occupied_at = null
  where id = target_seat_id;
end;
$$;

revoke all on function public.leave_room_as_guest(text, text)
  from public, anon, authenticated;
revoke all on function public.leave_room_as_member(text)
  from public, anon, authenticated;
revoke all on function public.kick_guest(text, uuid)
  from public, anon, authenticated;

grant execute on function public.leave_room_as_guest(text, text)
  to anon, authenticated;
grant execute on function public.leave_room_as_member(text)
  to authenticated;
grant execute on function public.kick_guest(text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
