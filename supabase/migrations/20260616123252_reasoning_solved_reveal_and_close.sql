-- 推理判定为"推理正确"时，原先只把 puzzle_progress.solved 置为 true，
-- 没有告知玩家汤底，也没有结束本局，房主必须手动停止题目才能看到
-- "已完成"状态。这里在判定正确的同一事务里：插入一条包含汤底的系统消息，
-- 并把 rooms.current_puzzle_id 置空（等价于自动停止本局），从而让前端
-- 已有的 Realtime 订阅按"题目已停止"的现有逻辑自动更新面板状态。

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
  reasoning_verdict text;
  solved_puzzle public.puzzles%rowtype;
  owner_seat public.room_seats%rowtype;
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
      sender_type, message_type, message_mode, content, puzzle_id
    )
    values (
      request_row.room_id,
      request_row.seat_id,
      'AI主持',
      source_message.sender_seat_number,
      source_message.sender_type,
      'ai',
      request_row.message_mode,
      trim(ai_content),
      request_row.puzzle_id
    )
    returning * into inserted_message;

    update public.room_ai_requests
    set status = 'completed',
        completed_at = now()
    where room_ai_requests.request_message_id = request_row.request_message_id;

    if request_row.message_mode = 'reason' then
      begin
        reasoning_verdict := trim(ai_content)::jsonb ->> 'text';
      exception when others then
        reasoning_verdict := null;
      end;

      if reasoning_verdict = '推理正确' then
        insert into public.puzzle_progress (room_id, puzzle_id, solved, updated_at)
        values (request_row.room_id, request_row.puzzle_id, true, now())
        on conflict (room_id, puzzle_id)
        do update set solved = true, updated_at = now();

        select * into solved_puzzle
        from public.puzzles
        where id = request_row.puzzle_id;

        select * into owner_seat
        from public.room_seats
        where room_id = request_row.room_id and seat_number = 1;

        if found and solved_puzzle.id is not null then
          insert into public.room_messages (
            room_id, seat_id, sender_name, sender_seat_number,
            sender_type, message_type, content, puzzle_id
          )
          values (
            request_row.room_id,
            owner_seat.id,
            owner_seat.nickname,
            1,
            'registered',
            'system',
            format('【推理成功】《%s》汤底：%s', solved_puzzle.title, solved_puzzle.bottom),
            request_row.puzzle_id
          );
        end if;

        update public.rooms
        set current_puzzle_id = null
        where id = request_row.room_id
          and current_puzzle_id = request_row.puzzle_id;
      end if;
    end if;

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

notify pgrst, 'reload schema';
