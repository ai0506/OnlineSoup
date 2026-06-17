-- get_room_chat_bootstrap 之前没有返回 room_messages.puzzle_id，
-- 导致前端无法按当前题目筛选事实总结（AI 回复里的 fact_summary）。
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
           sender_type, message_type, message_mode, content, puzzle_id, created_at
    from (
      select rm.id, rm.room_id, rm.seat_id, rm.sender_name, rm.sender_seat_number,
             rm.sender_type, rm.message_type, rm.message_mode, rm.content,
             rm.puzzle_id, rm.created_at
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

notify pgrst, 'reload schema';
