-- 整体替换题库：清空现有题目，导入一批新题目（用于管理端 JSON 导入功能）。
-- 与 admin_create_puzzle/admin_update_puzzle 共用同一套校验规则。
create or replace function public.admin_replace_all_puzzles(p_puzzles jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_count integer;
begin
  if p_puzzles is null or jsonb_typeof(p_puzzles) <> 'array' then
    raise exception 'invalid_puzzles';
  end if;

  if jsonb_array_length(p_puzzles) < 1 then
    raise exception 'invalid_puzzles';
  end if;

  for v_item in select * from jsonb_array_elements(p_puzzles)
  loop
    if v_item->>'title' is null
      or length(trim(v_item->>'title')) < 1
      or length(trim(v_item->>'title')) > 60 then
      raise exception 'invalid_title';
    end if;

    if v_item->>'surface' is null
      or length(trim(v_item->>'surface')) < 5
      or length(trim(v_item->>'surface')) > 1000 then
      raise exception 'invalid_surface';
    end if;

    if v_item->>'bottom' is null
      or length(trim(v_item->>'bottom')) < 5
      or length(trim(v_item->>'bottom')) > 2000 then
      raise exception 'invalid_bottom';
    end if;

    if coalesce(v_item->>'difficulty', '') not in ('简单', '中等', '困难', '抽象') then
      raise exception 'invalid_difficulty';
    end if;

    if jsonb_typeof(coalesce(v_item->'key_points', '[]'::jsonb)) <> 'array' then
      raise exception 'invalid_key_points';
    end if;

    if jsonb_typeof(coalesce(v_item->'examples', '[]'::jsonb)) <> 'array' then
      raise exception 'invalid_examples';
    end if;
  end loop;

  -- 题目即将被清空重建，先解除房间对旧题目的引用，避免外键冲突。
  update public.rooms set current_puzzle_id = null where current_puzzle_id is not null;

  -- puzzle_progress 通过 on delete cascade 引用 puzzles，会随之自动清空。
  delete from public.puzzles;

  insert into public.puzzles (title, surface, bottom, difficulty, is_active, key_points, examples)
  select
    trim(item->>'title'),
    trim(item->>'surface'),
    trim(item->>'bottom'),
    item->>'difficulty',
    coalesce((item->>'is_active')::boolean, true),
    coalesce(item->'key_points', '[]'::jsonb),
    coalesce(item->'examples', '[]'::jsonb)
  from jsonb_array_elements(p_puzzles) as item;

  select count(*) into v_count from public.puzzles;
  return v_count;
exception
  when unique_violation then
    raise exception 'puzzle_title_taken';
end;
$$;

revoke all on function public.admin_replace_all_puzzles(jsonb) from public, anon, authenticated;
grant execute on function public.admin_replace_all_puzzles(jsonb) to service_role;

notify pgrst, 'reload schema';
