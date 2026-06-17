alter table public.room_messages
  drop constraint if exists room_messages_message_type_check,
  add constraint room_messages_message_type_check
    check (message_type in ('chat', 'system', 'ai'));

create table if not exists public.room_ai_requests (
  request_message_id bigint primary key references public.room_messages(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat_id uuid not null references public.room_seats(id),
  user_id uuid references public.profiles(id),
  puzzle_id integer not null references public.puzzles(id),
  message_mode text not null check (message_mode in ('ask', 'hint', 'reason')),
  cost integer not null check (cost in (1, 2)),
  paid_from text not null check (paid_from in ('seat', 'personal')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'refunded')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  refunded_at timestamptz
);

alter table public.room_ai_requests enable row level security;
revoke all on public.room_ai_requests from anon, authenticated;

drop function if exists public.send_room_ai_request(text, text, text, text, boolean);

create or replace function public.send_room_ai_request(
  room_code           text,
  message_content     text,
  guest_token         text    default null,
  message_mode        text    default 'ask',
  use_personal_points boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room            public.rooms%rowtype;
  current_user_id        uuid := (select auth.uid());
  sender_seat            public.room_seats%rowtype;
  inserted_message       public.room_messages%rowtype;
  mode_cost              integer;
  max_length             integer;
  current_personal_pts   integer;
  guest_seat_id          uuid;
  paid_from_value        text;
  recent_ai_count        integer;
begin
  if message_mode not in ('ask', 'hint', 'reason') then
    raise exception 'invalid_message_mode';
  end if;

  mode_cost := case message_mode
    when 'reason' then 2
    else 1
  end;

  max_length := case message_mode
    when 'reason' then 200
    else 50
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

  if target_room.current_puzzle_id is null then
    raise exception 'no_active_puzzle';
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

  select count(*) into recent_ai_count
  from public.room_messages rm
  where rm.seat_id = sender_seat.id
    and rm.message_mode in ('ask', 'hint', 'reason')
    and rm.created_at > now() - interval '3 seconds';

  if recent_ai_count >= 1 then
    raise exception 'rate_limited';
  end if;

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
    set points = points - mode_cost,
        updated_at = now()
    where id = current_user_id;

    insert into public.points_transactions (user_id, room_id, type, amount, balance_after)
    values (current_user_id, target_room.id, 'seat_query', -mode_cost, current_personal_pts - mode_cost);

    paid_from_value := 'personal';
  else
    if sender_seat.remaining_points < mode_cost then
      raise exception 'insufficient_seat_points';
    end if;

    update public.room_seats
    set remaining_points = remaining_points - mode_cost
    where id = sender_seat.id;

    paid_from_value := 'seat';
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

  insert into public.room_ai_requests (
    request_message_id, room_id, seat_id, user_id, puzzle_id,
    message_mode, cost, paid_from
  )
  values (
    inserted_message.id, target_room.id, sender_seat.id, current_user_id,
    target_room.current_puzzle_id, message_mode, mode_cost, paid_from_value
  );

  return jsonb_build_object(
    'message', to_jsonb(inserted_message),
    'request_id', inserted_message.id,
    'room_id', target_room.id,
    'puzzle_id', target_room.current_puzzle_id
  );
end;
$$;

drop function if exists public.finish_room_ai_request(bigint, text, boolean);

create or replace function public.finish_room_ai_request(
  request_message_id bigint,
  ai_content text,
  is_success boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.room_ai_requests%rowtype;
  source_message public.room_messages%rowtype;
  inserted_message public.room_messages%rowtype;
  current_personal_pts integer;
begin
  select * into request_row
  from public.room_ai_requests
  where room_ai_requests.request_message_id = finish_room_ai_request.request_message_id
  for update;

  if not found then
    raise exception 'ai_request_not_found';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'ai_request_already_finished';
  end if;

  select * into source_message
  from public.room_messages
  where id = request_row.request_message_id;

  if is_success then
    if char_length(trim(ai_content)) not between 1 and 500 then
      raise exception 'invalid_message';
    end if;

    insert into public.room_messages (
      room_id, seat_id, sender_name, sender_seat_number,
      sender_type, message_type, message_mode, content
    )
    values (
      request_row.room_id,
      request_row.seat_id,
      'AI主持',
      source_message.sender_seat_number,
      source_message.sender_type,
      'ai',
      request_row.message_mode,
      trim(ai_content)
    )
    returning * into inserted_message;

    update public.room_ai_requests
    set status = 'completed',
        completed_at = now()
    where room_ai_requests.request_message_id = request_row.request_message_id;

    return to_jsonb(inserted_message);
  end if;

  if request_row.paid_from = 'personal' then
    if request_row.user_id is null then
      raise exception 'ai_refund_user_missing';
    end if;

    select points into current_personal_pts
    from public.profiles
    where id = request_row.user_id
    for update;

    update public.profiles
    set points = points + request_row.cost,
        updated_at = now()
    where id = request_row.user_id;

    insert into public.points_transactions (user_id, room_id, type, amount, balance_after)
    values (
      request_row.user_id,
      request_row.room_id,
      'seat_query',
      request_row.cost,
      current_personal_pts + request_row.cost
    );
  else
    update public.room_seats
    set remaining_points = remaining_points + request_row.cost
    where id = request_row.seat_id;
  end if;

  update public.room_ai_requests
  set status = 'refunded',
      refunded_at = now()
  where room_ai_requests.request_message_id = request_row.request_message_id;

  return null;
end;
$$;

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

revoke all on function public.send_room_ai_request(text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.send_room_ai_request(text, text, text, text, boolean)
  to anon, authenticated;

revoke all on function public.finish_room_ai_request(bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_room_ai_request(bigint, text, boolean)
  to service_role;

revoke all on function public.get_room_chat_bootstrap(text, text)
  from public, anon, authenticated;
grant execute on function public.get_room_chat_bootstrap(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
