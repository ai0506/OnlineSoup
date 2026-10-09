-- 座位相关系统消息改为结构化 JSON，座位号与身份由前端渲染成标签。
-- 旧的纯文本消息保持原样，前端保留兼容分支。

create or replace function public.move_seat(
  room_code text,
  source_seat_id uuid,
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
  source_seat public.room_seats%rowtype;
  target_seat public.room_seats%rowtype;
  owner_seat public.room_seats%rowtype;
  source_type_label text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if source_seat_id = target_seat_id then
    raise exception 'same_seat';
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
  into source_seat
  from public.room_seats
  where id = source_seat_id
    and room_id = target_room.id
  for update;

  if not found then
    raise exception 'seat_not_in_room';
  end if;

  if source_seat.seat_number = 1 then
    raise exception 'cannot_move_owner_seat';
  end if;

  if source_seat.nickname is null then
    raise exception 'source_seat_empty';
  end if;

  select *
  into target_seat
  from public.room_seats
  where id = target_seat_id
    and room_id = target_room.id
  for update;

  if not found then
    raise exception 'seat_not_in_room';
  end if;

  if target_seat.seat_number = 1 then
    raise exception 'cannot_move_owner_seat';
  end if;

  if target_seat.nickname is not null then
    raise exception 'target_seat_occupied';
  end if;

  select *
  into owner_seat
  from public.room_seats
  where room_id = target_room.id
    and seat_number = 1;

  source_type_label := case
    when source_seat.user_id is null then 'guest'
    else 'registered'
  end;

  perform set_config('app.seat_action', 'move', true);

  -- The partial unique index on (room_id, user_id) is immediate, so release
  -- the registered member's old seat before assigning the new one.
  update public.room_seats
  set nickname = null,
      user_id = null,
      occupied_at = null
  where id = source_seat_id;

  -- Temporary points belong to the seat and intentionally stay unchanged.
  update public.room_seats
  set nickname = source_seat.nickname,
      user_id = source_seat.user_id,
      occupied_at = source_seat.occupied_at
  where id = target_seat_id;

  update public.guest_sessions
  set seat_id = target_seat_id
  where room_id = target_room.id
    and seat_id = source_seat_id;

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
    target_room.id,
    owner_seat.id,
    owner_seat.nickname,
    1,
    'registered',
    'system',
    jsonb_build_object(
      'kind', 'seat_moved',
      'actor_name', owner_seat.nickname,
      'actor_seat', 1,
      'actor_type', 'registered',
      'target_name', source_seat.nickname,
      'target_seat', source_seat.seat_number,
      'target_type', source_type_label,
      'to_seat', target_seat.seat_number
    )::text
  );

  perform set_config('app.seat_action', '', true);
end;
$$;

create or replace function public.gift_points_to_seat(
  room_code text,
  target_seat_id uuid,
  amount integer
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
  owner_seat  public.room_seats%rowtype;
  current_points integer;
  target_type_label text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if amount is null or amount <= 0 then
    raise exception 'invalid_amount';
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
  where id = target_seat_id
    and room_id = target_room.id
  for update;

  if not found then
    raise exception 'seat_not_in_room';
  end if;

  if target_seat.seat_number = 1 then
    raise exception 'cannot_gift_to_own_seat';
  end if;

  if target_seat.nickname is null then
    raise exception 'seat_is_empty';
  end if;

  select points
  into current_points
  from public.profiles
  where id = current_user_id
  for update;

  if current_points < amount then
    raise exception 'insufficient_points';
  end if;

  update public.profiles
  set points     = points - amount,
      updated_at = now()
  where id = current_user_id;

  update public.room_seats
  set remaining_points = remaining_points + amount
  where id = target_seat_id;

  insert into public.points_transactions (
    user_id,
    room_id,
    type,
    amount,
    balance_after
  )
  values (
    current_user_id,
    target_room.id,
    'gift_sent',
    -amount,
    current_points - amount
  );

  -- Get owner's seat for the system message
  select *
  into owner_seat
  from public.room_seats
  where room_id = target_room.id
    and seat_number = 1;

  target_type_label := case when target_seat.user_id is null then 'guest' else 'registered' end;

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
    target_room.id,
    owner_seat.id,
    owner_seat.nickname,
    1,
    'registered',
    'system',
    jsonb_build_object(
      'kind', 'points_gifted',
      'actor_name', owner_seat.nickname,
      'actor_seat', 1,
      'actor_type', 'registered',
      'target_name', target_seat.nickname,
      'target_seat', target_seat.seat_number,
      'target_type', target_type_label,
      'amount', amount
    )::text
  );
end;
$$;

revoke all on function public.move_seat(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.gift_points_to_seat(text, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.move_seat(text, uuid, uuid)
  to authenticated;
grant execute on function public.gift_points_to_seat(text, uuid, integer)
  to authenticated;

notify pgrst, 'reload schema';
