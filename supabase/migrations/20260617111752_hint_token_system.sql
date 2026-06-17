-- 每个座位追踪已提问次数（每 3 次提问奖励 1 次提示机会）和当前可用提示机会数。
-- 提示机会与座位绑定，不随题目切换重置。
alter table public.room_seats
  add column if not exists ask_count   integer not null default 0,
  add column if not exists hint_tokens integer not null default 0;

-- 重建 send_room_ai_request，加入提示机会检查与奖励逻辑：
--   'hint'   模式：消耗 1 个提示机会（hint_tokens -= 1），否则报错
--   'ask'    模式：ask_count += 1；若 ask_count % 3 = 0，则 hint_tokens += 1
--   'reason' 模式：hint_tokens += 1（每次推理均奖励一次提示机会）
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
  room_busy_count        integer;
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

  -- 'hint' 模式需要至少 1 个提示机会
  if message_mode = 'hint' and sender_seat.hint_tokens < 1 then
    raise exception 'insufficient_hint_tokens';
  end if;

  -- 每次只允许一个 AI 请求同时在处理，超过 20 秒的挂起请求视为已放弃
  perform pg_advisory_xact_lock(hashtext('room_ai_request:' || target_room.id::text));

  select count(*) into room_busy_count
  from public.room_ai_requests
  where room_id = target_room.id
    and status = 'pending'
    and created_at > now() - interval '20 seconds';

  if room_busy_count > 0 then
    raise exception 'room_ai_busy';
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

    -- 仅更新座位的计数/机会列（无积分变动）
    update public.room_seats
    set ask_count   = case when message_mode = 'ask' then ask_count + 1 else ask_count end,
        hint_tokens = case
          when message_mode = 'hint'   then hint_tokens - 1
          when message_mode = 'reason' then hint_tokens + 1
          when message_mode = 'ask' and (ask_count + 1) % 3 = 0 then hint_tokens + 1
          else hint_tokens
        end
    where id = sender_seat.id;
  else
    if sender_seat.remaining_points < mode_cost then
      raise exception 'insufficient_seat_points';
    end if;

    update public.room_seats
    set remaining_points = remaining_points - mode_cost,
        ask_count   = case when message_mode = 'ask' then ask_count + 1 else ask_count end,
        hint_tokens = case
          when message_mode = 'hint'   then hint_tokens - 1
          when message_mode = 'reason' then hint_tokens + 1
          when message_mode = 'ask' and (ask_count + 1) % 3 = 0 then hint_tokens + 1
          else hint_tokens
        end
    where id = sender_seat.id;

    paid_from_value := 'seat';
  end if;

  insert into public.room_messages (
    room_id, seat_id, sender_name, sender_seat_number,
    sender_type, message_type, message_mode, content, puzzle_id
  )
  values (
    target_room.id,
    sender_seat.id,
    sender_seat.nickname,
    sender_seat.seat_number,
    case when current_user_id is null then 'guest' else 'registered' end,
    'chat',
    message_mode,
    trim(message_content),
    target_room.current_puzzle_id
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

revoke all on function public.send_room_ai_request(text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.send_room_ai_request(text, text, text, text, boolean)
  to anon, authenticated;

notify pgrst, 'reload schema';
