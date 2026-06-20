-- ── get_my_profile_page：返回用户信息、统计和通关题目 ─────────────────────────

create or replace function public.get_my_profile_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  profile_row     public.profiles%rowtype;
  stats_row       record;
  solved_puzzles  jsonb;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select * into profile_row
  from public.profiles
  where id = current_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  -- 统计：提问/提示/推理次数（通过 room_seats.user_id 关联）
  select
    count(*) filter (where rm.message_mode = 'ask')    as ask_count,
    count(*) filter (where rm.message_mode = 'hint')   as hint_count,
    count(*) filter (where rm.message_mode = 'reason') as reason_count
  into stats_row
  from public.room_messages rm
  join public.room_seats rs on rs.id = rm.seat_id
  where rs.user_id = current_user_id
    and rm.message_type = 'ai'
    and rm.message_mode in ('ask', 'hint', 'reason');

  -- 通关题目：用户参与（房主或成员座位）的房间中已 solved 的题目，去重取最早时间
  select coalesce(jsonb_agg(t order by t.solved_at), '[]'::jsonb)
  into solved_puzzles
  from (
    select distinct on (pp.puzzle_id)
      p.id,
      p.title,
      p.difficulty,
      pp.updated_at as solved_at
    from public.puzzle_progress pp
    join public.puzzles p on p.id = pp.puzzle_id
    where pp.solved = true
      and pp.room_id in (
        -- 用户作为房主的房间
        select id from public.rooms where owner_id = current_user_id
        union
        -- 用户作为注册成员坐在某座位的房间
        select room_id from public.room_seats where user_id = current_user_id
      )
    order by pp.puzzle_id, pp.updated_at
  ) t;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'username',     profile_row.username,
      'display_name', profile_row.display_name,
      'points',       profile_row.points,
      'created_at',   profile_row.created_at
    ),
    'stats', jsonb_build_object(
      'ask_count',    coalesce(stats_row.ask_count, 0),
      'hint_count',   coalesce(stats_row.hint_count, 0),
      'reason_count', coalesce(stats_row.reason_count, 0)
    ),
    'solved_puzzles', solved_puzzles
  );
end;
$$;

revoke all on function public.get_my_profile_page() from public, anon, authenticated;
grant execute on function public.get_my_profile_page() to authenticated;

-- ── get_my_points_history：分页积分流水（含房间名） ────────────────────────────

create or replace function public.get_my_points_history(
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  total_count     bigint;
  transactions    jsonb;
  v_offset        integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_page < 1 then
    p_page := 1;
  end if;

  if p_page_size < 1 or p_page_size > 100 then
    p_page_size := 20;
  end if;

  v_offset := (p_page - 1) * p_page_size;

  select count(*) into total_count
  from public.points_transactions
  where user_id = current_user_id;

  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into transactions
  from (
    select
      pt.id,
      pt.type,
      pt.amount,
      pt.balance_after,
      pt.created_at,
      r.name as room_name
    from public.points_transactions pt
    left join public.rooms r on r.id = pt.room_id
    where pt.user_id = current_user_id
    order by pt.created_at desc, pt.id desc
    limit p_page_size
    offset v_offset
  ) t;

  return jsonb_build_object(
    'total',        total_count,
    'page',         p_page,
    'page_size',    p_page_size,
    'transactions', transactions
  );
end;
$$;

revoke all on function public.get_my_points_history(integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_points_history(integer, integer) to authenticated;

notify pgrst, 'reload schema';
