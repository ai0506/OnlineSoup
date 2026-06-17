-- Fix bug from 20260616030906_chat_message_rate_limit.sql:
-- the rate-limit COUNT queries referenced bare `message_mode`, which is
-- ambiguous with the function parameter of the same name (plpgsql default
-- variable_conflict = error), causing every chat send to fail with a raw
-- Postgres error instead of the intended exception. Qualify the column
-- with the table alias to resolve the ambiguity.
drop function if exists public.send_room_chat_message(text, text, text, text, boolean);

create or replace function public.send_room_chat_message(
  room_code           text,
  message_content     text,
  guest_token         text    default null,
  message_mode        text    default 'chat',
  use_personal_points boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room            public.rooms%rowtype;
  current_user_id        uuid    := (select auth.uid());
  sender_seat            public.room_seats%rowtype;
  inserted_message       public.room_messages%rowtype;
  mode_cost              integer;
  max_length             integer;
  current_personal_pts   integer;
  guest_seat_id          uuid;
  recent_second_count    integer;
  recent_minute_count    integer;
begin
  if message_mode not in ('chat', 'ask', 'hint', 'reason') then
    raise exception 'invalid_message_mode';
  end if;

  mode_cost := case message_mode
    when 'ask'    then 1
    when 'hint'   then 1
    when 'reason' then 2
    else 0
  end;

  max_length := case message_mode
    when 'ask'    then 50
    when 'hint'   then 50
    when 'reason' then 200
    else 500
  end;

  if char_length(trim(message_content)) not between 1 and max_length then
    raise exception 'invalid_message';
  end if;

  select * into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select * into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and seat_number = 1
      and nickname is not null
    for update;

  elsif current_user_id is not null then
    select * into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and user_id = current_user_id
      and nickname is not null
    for update;

  elsif guest_token is not null and guest_token <> '' then
    select gs.seat_id into guest_seat_id
    from public.guest_sessions gs
    where gs.room_id = target_room.id
      and gs.token_hash = encode(extensions.digest(guest_token, 'sha256'), 'hex');

    if guest_seat_id is not null then
      select * into sender_seat
      from public.room_seats
      where id = guest_seat_id
        and nickname is not null
      for update;
    end if;
  end if;

  if sender_seat.id is null then
    raise exception 'room_membership_required';
  end if;

  if message_mode = 'chat' then
    select count(*) into recent_second_count
    from public.room_messages rm
    where rm.seat_id = sender_seat.id
      and rm.message_mode = 'chat'
      and rm.created_at > now() - interval '1 second';

    if recent_second_count >= 2 then
      raise exception 'rate_limited';
    end if;

    select count(*) into recent_minute_count
    from public.room_messages rm
    where rm.seat_id = sender_seat.id
      and rm.message_mode = 'chat'
      and rm.created_at > now() - interval '60 seconds';

    if recent_minute_count >= 40 then
      raise exception 'rate_limited';
    end if;
  end if;

  if mode_cost > 0 then
    if use_personal_points then
      if current_user_id is null then
        raise exception 'authentication_required';
      end if;

      select points into current_personal_pts
      from public.profiles
      where id = current_user_id
      for update;

      if current_personal_pts < mode_cost then
        raise exception 'insufficient_points';
      end if;

      update public.profiles
      set points     = points - mode_cost,
          updated_at = now()
      where id = current_user_id;

      insert into public.points_transactions (user_id, room_id, type, amount, balance_after)
      values (current_user_id, target_room.id, 'seat_query', -mode_cost, current_personal_pts - mode_cost);

    else
      if sender_seat.remaining_points < mode_cost then
        raise exception 'insufficient_seat_points';
      end if;

      update public.room_seats
      set remaining_points = remaining_points - mode_cost
      where id = sender_seat.id;
    end if;
  end if;

  insert into public.room_messages (
    room_id, seat_id, sender_name, sender_seat_number,
    sender_type, message_type, message_mode, content
  )
  values (
    target_room.id,
    sender_seat.id,
    sender_seat.nickname,
    sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end,
    'chat',
    message_mode,
    trim(message_content)
  )
  returning * into inserted_message;

  return to_jsonb(inserted_message);
end;
$$;

revoke all on function public.send_room_chat_message(text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.send_room_chat_message(text, text, text, text, boolean)
  to anon, authenticated;

notify pgrst, 'reload schema';
