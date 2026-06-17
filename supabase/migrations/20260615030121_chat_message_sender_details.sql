alter table public.room_messages
  add column if not exists sender_seat_number integer,
  add column if not exists sender_type text;

update public.room_messages
set
  sender_seat_number = room_seats.seat_number,
  sender_type = case
    when room_seats.user_id is null then 'guest'
    else 'registered'
  end
from public.room_seats
where room_seats.id = room_messages.seat_id
  and (
    room_messages.sender_seat_number is null
    or room_messages.sender_type is null
  );

alter table public.room_messages
  alter column sender_seat_number set not null,
  alter column sender_type set not null;

alter table public.room_messages
  drop constraint if exists room_messages_sender_seat_number_check,
  add constraint room_messages_sender_seat_number_check
    check (sender_seat_number > 0),
  drop constraint if exists room_messages_sender_type_check,
  add constraint room_messages_sender_type_check
    check (sender_type in ('registered', 'guest'));

create or replace function public.get_room_chat_bootstrap(
  room_code text,
  guest_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  member_seat_id uuid;
  topic text;
  messages jsonb;
begin
  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select room_seats.id
    into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.seat_number = 1
      and room_seats.nickname is not null;
  elsif current_user_id is not null then
    select room_seats.id
    into member_seat_id
    from public.room_seats
    where room_seats.room_id = target_room.id
      and room_seats.user_id = current_user_id
      and room_seats.nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select guest_sessions.seat_id
    into member_seat_id
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

  select realtime_topic
  into topic
  from public.room_private
  where room_id = target_room.id;

  select coalesce(jsonb_agg(to_jsonb(recent_messages)), '[]'::jsonb)
  into messages
  from (
    select
      id,
      room_id,
      seat_id,
      sender_name,
      sender_seat_number,
      sender_type,
      message_type,
      content,
      created_at
    from (
      select
        room_messages.id,
        room_messages.room_id,
        room_messages.seat_id,
        room_messages.sender_name,
        room_messages.sender_seat_number,
        room_messages.sender_type,
        room_messages.message_type,
        room_messages.content,
        room_messages.created_at
      from public.room_messages
      where room_messages.room_id = target_room.id
      order by room_messages.created_at desc, room_messages.id desc
      limit 100
    ) newest_first
    order by created_at, id
  ) recent_messages;

  return jsonb_build_object(
    'realtime_topic', topic,
    'messages', messages,
    'seat_id', member_seat_id
  );
end;
$$;

create or replace function public.send_room_chat_message(
  room_code text,
  message_content text,
  guest_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  sender_seat public.room_seats%rowtype;
  inserted_message public.room_messages%rowtype;
begin
  if char_length(trim(message_content)) not between 1 and 500 then
    raise exception 'invalid_message';
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if current_user_id = target_room.owner_id then
    select *
    into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and seat_number = 1
      and nickname is not null;
  elsif current_user_id is not null then
    select *
    into sender_seat
    from public.room_seats
    where room_id = target_room.id
      and user_id = current_user_id
      and nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select room_seats.*
    into sender_seat
    from public.guest_sessions
    join public.room_seats on room_seats.id = guest_sessions.seat_id
    where guest_sessions.room_id = target_room.id
      and guest_sessions.token_hash =
        encode(extensions.digest(guest_token, 'sha256'), 'hex')
      and room_seats.nickname is not null;
  end if;

  if sender_seat.id is null then
    raise exception 'room_membership_required';
  end if;

  insert into public.room_messages (
    room_id,
    seat_id,
    sender_name,
    sender_seat_number,
    sender_type,
    content
  )
  values (
    target_room.id,
    sender_seat.id,
    sender_seat.nickname,
    sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end,
    trim(message_content)
  )
  returning * into inserted_message;

  return to_jsonb(inserted_message);
end;
$$;

revoke all on function public.get_room_chat_bootstrap(text, text)
  from public, anon, authenticated;
revoke all on function public.send_room_chat_message(text, text, text)
  from public, anon, authenticated;

grant execute on function public.get_room_chat_bootstrap(text, text)
  to anon, authenticated;
grant execute on function public.send_room_chat_message(text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
