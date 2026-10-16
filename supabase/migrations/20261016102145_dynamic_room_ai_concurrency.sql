-- Keep the public website/CLI wrappers, payment transactions and lease settlement intact.
-- Limits depend on occupied seats; Realtime presence is not authoritative membership.
create or replace function soup_cli.send_room_ai_request(
  room_code text, message_content text, guest_token text default null,
  message_mode text default 'ask', use_personal_points boolean default false
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
  mode_cost integer;
  max_length integer;
  current_personal_pts integer;
  paid_from_value text;
  room_busy_count integer;
  player_busy_count integer;
  ask_busy_count integer;
  reason_busy_count integer;
  hint_busy_count integer;
  member_count integer;
  total_limit integer;
  ask_limit integer;
  reason_limit integer;
  recent_ai_count integer;
begin
  perform soup_cli.lock_transaction();
  if message_mode not in ('ask', 'hint', 'reason') then raise exception 'invalid_message_mode'; end if;
  mode_cost := case when message_mode = 'reason' then 2 else 1 end;
  max_length := case when message_mode = 'ask' then 100 when message_mode = 'reason' then 300 else 50 end;
  if char_length(trim(message_content)) not between 1 and max_length then raise exception 'invalid_message'; end if;
  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;
  if target_room.current_puzzle_id is null then raise exception 'no_active_puzzle'; end if;
  select * into sender_seat from public.room_seats where id = public.require_active_room_member_seat(target_room.id, guest_token);

  perform pg_advisory_xact_lock(hashtext('room_ai_request:' || target_room.id::text));
  perform public.reconcile_stale_room_ai_requests(target_room.id);
  -- Reconciliation can refund this seat; do not charge using its pre-refund snapshot.
  select * into sender_seat from public.room_seats where id = sender_seat.id;
  if message_mode = 'hint' and sender_seat.hint_tokens < 1 then raise exception 'insufficient_hint_tokens'; end if;

  select count(*) into member_count from public.room_seats
  where room_id = target_room.id and nickname is not null;
  total_limit := case when member_count <= 3 then 2 when member_count <= 6 then 4 else 6 end;
  ask_limit := case when member_count <= 3 then 2 when member_count <= 6 then 3 else 4 end;
  reason_limit := case when member_count <= 3 then 1 when member_count <= 6 then 2 else 3 end;

  select count(*),
    count(*) filter (where q.seat_id = sender_seat.id
      or (current_user_id is not null and q.user_id = current_user_id)),
    count(*) filter (where q.message_mode = 'ask'),
    count(*) filter (where q.message_mode = 'reason'),
    count(*) filter (where q.message_mode = 'hint')
  into room_busy_count, player_busy_count, ask_busy_count, reason_busy_count, hint_busy_count
  from public.room_ai_requests q
  where q.room_id = target_room.id and q.status = 'pending' and q.lease_expires_at > now();
  if room_busy_count >= total_limit or player_busy_count >= 1
    or (message_mode = 'ask' and ask_busy_count >= ask_limit)
    or (message_mode = 'reason' and reason_busy_count >= reason_limit)
    or (message_mode = 'hint' and hint_busy_count >= 1)
  then raise exception 'room_ai_busy'; end if;

  if not soup_cli.is_cli() then
    select count(*) into recent_ai_count from public.room_messages
    where room_messages.seat_id = sender_seat.id and room_messages.message_mode in ('ask', 'hint', 'reason') and created_at > now() - interval '3 seconds';
    if recent_ai_count >= 1 then raise exception 'rate_limited'; end if;
  end if;

  if use_personal_points then
    if current_user_id is null then raise exception 'authentication_required'; end if;
    select points into current_personal_pts from public.profiles where id = current_user_id for update;
    if current_personal_pts < mode_cost then raise exception 'insufficient_points'; end if;
    update public.profiles set points = points - mode_cost, updated_at = now() where id = current_user_id;
    insert into public.points_transactions (user_id, room_id, type, amount, balance_after)
      values (current_user_id, target_room.id, 'seat_query', -mode_cost, current_personal_pts - mode_cost);
    paid_from_value := 'personal';
  else
    if sender_seat.remaining_points < mode_cost then raise exception 'insufficient_seat_points'; end if;
    update public.room_seats set remaining_points = remaining_points - mode_cost where id = sender_seat.id;
    paid_from_value := 'seat';
  end if;

  update public.room_seats
  set ask_count = case when message_mode = 'ask' then ask_count + 1 else ask_count end,
      hint_tokens = case when message_mode = 'hint' then hint_tokens - 1 when message_mode = 'reason' then hint_tokens + 1
        when message_mode = 'ask' and (ask_count + 1) % 3 = 0 then hint_tokens + 1 else hint_tokens end
  where id = sender_seat.id;

  insert into public.room_messages (room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content, puzzle_id)
  values (target_room.id, sender_seat.id, sender_seat.nickname, sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end, 'chat', message_mode, trim(message_content), target_room.current_puzzle_id)
  returning * into inserted_message;
  insert into public.room_ai_requests (request_message_id, room_id, seat_id, user_id, puzzle_id, message_mode, cost, paid_from, lease_expires_at)
  values (inserted_message.id, target_room.id, sender_seat.id, current_user_id, target_room.current_puzzle_id, message_mode, mode_cost, paid_from_value, now() + interval '2 minutes');
  return jsonb_build_object('message', to_jsonb(inserted_message), 'request_id', inserted_message.id, 'room_id', target_room.id, 'puzzle_id', target_room.current_puzzle_id);
end;
$$;

revoke all on function soup_cli.send_room_ai_request(text, text, text, text, boolean)
  from public, anon, authenticated;
notify pgrst, 'reload schema';
