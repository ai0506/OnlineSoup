-- Keep AI refund behavior symmetric with send_room_ai_request:
-- refund both points and the seat-scoped counters/tokens changed at request time.
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
  solver_identity text;
  should_revoke_ask_reward boolean := false;
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
      sender_type, message_type, message_mode, content, puzzle_id, reply_to_id
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
      request_row.puzzle_id,
      request_row.request_message_id
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

        if found then
          solver_identity := case
            when source_message.sender_type = 'registered' then '已注册'
            else '访客'
          end;

          insert into public.room_messages (
            room_id, seat_id, sender_name, sender_seat_number,
            sender_type, message_type, content, puzzle_id
          )
          values (
            request_row.room_id,
            request_row.seat_id,
            source_message.sender_name,
            source_message.sender_seat_number,
            source_message.sender_type,
            'system',
            format(
              '【推理成功】%s [%s] [%s] 成功推理出《%s》',
              source_message.sender_name,
              source_message.sender_seat_number,
              solver_identity,
              solved_puzzle.title
            ),
            request_row.puzzle_id
          );

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
            jsonb_build_object(
              'kind', 'reveal',
              'text', solved_puzzle.bottom,
              'fact_summary', null
            )::text,
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

  select ((ask_count % 3) = 0) into should_revoke_ask_reward
  from public.room_seats
  where id = request_row.seat_id
  for update;

  update public.room_seats
  set ask_count = case
        when request_row.message_mode = 'ask' then greatest(ask_count - 1, 0)
        else ask_count
      end,
      hint_tokens = case
        when request_row.message_mode = 'hint' then hint_tokens + 1
        when request_row.message_mode = 'reason' then greatest(hint_tokens - 1, 0)
        when request_row.message_mode = 'ask' and coalesce(should_revoke_ask_reward, false)
          then greatest(hint_tokens - 1, 0)
        else hint_tokens
      end
  where id = request_row.seat_id;

  update public.room_ai_requests
  set status = 'refunded',
      refunded_at = now()
  where room_ai_requests.request_message_id = request_row.request_message_id;

  return null;
end;
$$;

revoke all on function public.finish_room_ai_request(bigint, text, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_room_ai_request(bigint, text, boolean)
  to service_role;

-- Database-side cleanup for admin user deletion. The auth user deletion still
-- happens through Supabase Admin API after this function succeeds.
create or replace function public.admin_cleanup_user_before_delete(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  update public.room_ai_requests
  set user_id = null
  where user_id = p_user_id;

  delete from public.points_transactions
  where user_id = p_user_id
     or room_id in (
       select id
       from public.rooms
       where owner_id = p_user_id
     );

  update public.room_seats rs
  set nickname = null,
      user_id = null,
      remaining_points = r.points_per_seat,
      ask_count = 0,
      hint_tokens = 0,
      occupied_at = null
  from public.rooms r
  where rs.room_id = r.id
    and rs.user_id = p_user_id
    and r.owner_id <> p_user_id;

  delete from public.rooms
  where owner_id = p_user_id;
end;
$$;

revoke all on function public.admin_cleanup_user_before_delete(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_cleanup_user_before_delete(uuid)
  to service_role;

notify pgrst, 'reload schema';
