-- The September room-contract rewrite restored unqualified column names in the
-- chat rate-limit queries. `message_mode` also names an RPC parameter, so every
-- chat send raises 42702 before the message can be inserted.
create or replace function public.send_room_chat_message(
  room_code text,
  message_content text,
  guest_token text default null,
  message_mode text default 'chat',
  use_personal_points boolean default false
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
  recent_second_count integer;
  recent_minute_count integer;
begin
  if message_mode <> 'chat' then raise exception 'invalid_message_mode'; end if;
  if char_length(trim(message_content)) not between 1 and 300 then raise exception 'invalid_message'; end if;

  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;

  select * into sender_seat
  from public.room_seats
  where id = public.require_active_room_member_seat(target_room.id, guest_token);

  select count(*) into recent_second_count from public.room_messages as rm
  where rm.seat_id = sender_seat.id and rm.message_mode = 'chat'
    and rm.created_at > now() - interval '1 second';
  if recent_second_count >= 2 then raise exception 'rate_limited'; end if;

  select count(*) into recent_minute_count from public.room_messages as rm
  where rm.seat_id = sender_seat.id and rm.message_mode = 'chat'
    and rm.created_at > now() - interval '60 seconds';
  if recent_minute_count >= 40 then raise exception 'rate_limited'; end if;

  insert into public.room_messages (room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content)
  values (target_room.id, sender_seat.id, sender_seat.nickname, sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end, 'chat', 'chat', trim(message_content))
  returning * into inserted_message;
  return to_jsonb(inserted_message);
end;
$$;

revoke all on function public.send_room_chat_message(text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.send_room_chat_message(text, text, text, text, boolean)
  to anon, authenticated;

notify pgrst, 'reload schema';
