-- Update trigger to suppress messages during move_seat
create or replace function public.record_room_seat_system_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_reason text;
  seat_action text;
  player_name text;
  player_seat_number integer;
  player_type text;
  system_content text;
begin
  -- Skip: move_seat sets this flag and inserts its own system message
  seat_action := current_setting('app.seat_action', true);
  if seat_action = 'move' then
    return new;
  end if;

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

-- Rewrite move_seat to suppress trigger and insert a single correct message
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
  owner_seat  public.room_seats%rowtype;
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

  -- Get owner's seat for the system message
  select *
  into owner_seat
  from public.room_seats
  where room_id = target_room.id
    and seat_number = 1;

  source_type_label := case when source_seat.user_id is null then '访客' else '已注册' end;

  -- Suppress trigger so we can insert a single correct message
  perform set_config('app.seat_action', 'move', true);

  -- Move player data to target seat (carry their remaining_points)
  update public.room_seats
  set nickname         = source_seat.nickname,
      user_id          = source_seat.user_id,
      occupied_at      = source_seat.occupied_at,
      remaining_points = source_seat.remaining_points
  where id = target_seat_id;

  -- Reset source seat
  update public.room_seats
  set nickname         = null,
      user_id          = null,
      occupied_at      = null,
      remaining_points = target_room.points_per_seat
  where id = source_seat_id;

  -- Update guest_sessions if this is a guest player
  update public.guest_sessions
  set seat_id = target_seat_id
  where room_id = target_room.id
    and seat_id = source_seat_id;

  -- Insert single system message describing the move
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
    format('[1][已注册] %s 把 %s[%s] 从 [%s] 移到了 [%s]',
      owner_seat.nickname,
      source_seat.nickname,
      source_type_label,
      source_seat.seat_number,
      target_seat.seat_number)
  );

  -- Reset flag
  perform set_config('app.seat_action', '', true);
end;
$$;

-- Rewrite gift_points_to_seat to also insert a system message
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

  target_type_label := case when target_seat.user_id is null then '访客' else '已注册' end;

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
    format('[1][已注册] %s 赠送了 %s 积分给 %s[%s][%s]',
      owner_seat.nickname,
      amount,
      target_seat.nickname,
      target_seat.seat_number,
      target_type_label)
  );
end;
$$;

revoke all on function public.gift_points_to_seat(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.move_seat(text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.gift_points_to_seat(text, uuid, integer)
  to authenticated;
grant execute on function public.move_seat(text, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
