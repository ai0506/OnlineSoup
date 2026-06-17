alter table public.room_private
  add column if not exists realtime_topic text;

update public.room_private
set realtime_topic = encode(extensions.gen_random_bytes(24), 'hex')
where realtime_topic is null;

alter table public.room_private
  alter column realtime_topic set default encode(extensions.gen_random_bytes(24), 'hex'),
  alter column realtime_topic set not null;

create table public.room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat_id uuid not null references public.room_seats(id),
  sender_name text not null check (char_length(sender_name) between 1 and 20),
  message_type text not null default 'chat' check (message_type = 'chat'),
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index room_messages_room_created_idx
  on public.room_messages (room_id, created_at desc, id desc);

alter table public.room_messages enable row level security;
revoke all on public.room_messages from anon, authenticated;

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
  is_member boolean := false;
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
    is_member := true;
  elsif guest_token is not null and guest_token <> '' then
    is_member := exists (
      select 1
      from public.guest_sessions
      where room_id = target_room.id
        and token_hash =
          encode(extensions.digest(guest_token, 'sha256'), 'hex')
    );
  end if;

  if not is_member then
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
      message_type,
      content,
      created_at
    from (
      select
        room_messages.id,
        room_messages.room_id,
        room_messages.seat_id,
        room_messages.sender_name,
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
    'messages', messages
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
    content
  )
  values (
    target_room.id,
    sender_seat.id,
    sender_seat.nickname,
    trim(message_content)
  )
  returning * into inserted_message;

  return to_jsonb(inserted_message);
end;
$$;

revoke all on function public.get_room_chat_bootstrap(text, text) from public;
revoke all on function public.send_room_chat_message(text, text, text) from public;

grant execute on function public.get_room_chat_bootstrap(text, text)
  to anon, authenticated;
grant execute on function public.send_room_chat_message(text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
