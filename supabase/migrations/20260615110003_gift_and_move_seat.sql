-- gift_points_to_seat: owner transfers personal points to a player's seat
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
  current_points integer;
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

  -- Owner cannot gift to their own seat (seat_number = 1)
  if target_seat.seat_number = 1 then
    raise exception 'cannot_gift_to_own_seat';
  end if;

  -- Target seat must be occupied
  if target_seat.nickname is null then
    raise exception 'seat_is_empty';
  end if;

  -- Deduct from owner's personal points
  select points
  into current_points
  from public.profiles
  where id = current_user_id
  for update;

  if current_points < amount then
    raise exception 'insufficient_points';
  end if;

  update public.profiles
  set points = points - amount,
      updated_at = now()
  where id = current_user_id;

  -- Add to target seat's remaining_points
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
end;
$$;

-- move_seat: owner moves a player to a different empty seat
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

  -- Lock both seats in a consistent order to avoid deadlocks
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

  -- Move player data to target seat (carry their remaining_points)
  update public.room_seats
  set nickname     = source_seat.nickname,
      user_id      = source_seat.user_id,
      occupied_at  = source_seat.occupied_at,
      remaining_points = source_seat.remaining_points
  where id = target_seat_id;

  -- Reset source seat
  update public.room_seats
  set nickname     = null,
      user_id      = null,
      occupied_at  = null,
      remaining_points = target_room.points_per_seat
  where id = source_seat_id;

  -- Update guest_sessions if this is a guest player
  update public.guest_sessions
  set seat_id = target_seat_id
  where room_id = target_room.id
    and seat_id = source_seat_id;
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
