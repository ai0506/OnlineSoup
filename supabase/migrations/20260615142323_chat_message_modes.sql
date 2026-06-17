-- Add message_mode column to room_messages
-- message_type stays 'chat'|'system'; message_mode distinguishes the four user-facing modes
alter table public.room_messages
  add column if not exists message_mode text not null default 'chat'
    check (message_mode in ('chat', 'ask', 'hint', 'reason'));

-- Add transaction type for paid query deductions from personal points
alter type public.points_transaction_type
  add value if not exists 'seat_query';

-- Drop old function signature to avoid PostgREST overload ambiguity, then recreate
drop function if exists public.send_room_chat_message(text, text, text);

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

-- Update get_room_chat_bootstrap to include message_mode in returned messages
create or replace function public.get_room_chat_bootstrap(
  room_code   text,
  guest_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room     public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  member_seat_id  uuid;
  topic           text;
  messages        jsonb;
begin
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
    select room_seats.id into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.seat_number = 1
      and room_seats.nickname is not null;
  elsif current_user_id is not null then
    select room_seats.id into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.user_id = current_user_id
      and room_seats.nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select guest_sessions.seat_id into member_seat_id
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

  select realtime_topic into topic
  from public.room_private
  where room_id = target_room.id;

  select coalesce(jsonb_agg(to_jsonb(recent_messages)), '[]'::jsonb)
  into messages
  from (
    select id, room_id, seat_id, sender_name, sender_seat_number,
           sender_type, message_type, message_mode, content, created_at
    from (
      select rm.id, rm.room_id, rm.seat_id, rm.sender_name, rm.sender_seat_number,
             rm.sender_type, rm.message_type, rm.message_mode, rm.content, rm.created_at
      from public.room_messages rm
      where rm.room_id = target_room.id
      order by rm.created_at desc, rm.id desc
      limit 100
    ) newest_first
    order by created_at, id
  ) recent_messages;

  return jsonb_build_object(
    'realtime_topic', topic,
    'messages',       messages,
    'seat_id',        member_seat_id
  );
end;
$$;

revoke all on function public.get_room_chat_bootstrap(text, text)
  from public, anon, authenticated;
grant execute on function public.get_room_chat_bootstrap(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
