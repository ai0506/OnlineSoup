-- 上一版 admin_delete_puzzle（20260616111416）改成真正物理删除时，漏处理了
-- room_ai_requests.puzzle_id（not null 外键，引用 public.puzzles(id)，无 on delete
-- 动作），导致只要某道题曾经被问过/提示过/推理过，删除时就会报外键冲突
-- （room_ai_requests_puzzle_id_fkey）。room_ai_requests 是 AI 请求的处理状态日志，
-- 不是聊天内容本身（聊天内容在 room_messages，已经在上一版里把 puzzle_id 置空保留），
-- 所以删除题目时把这道题相关的请求日志一并删除即可。
create or replace function public.admin_delete_puzzle(p_puzzle_id integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_puzzle_id is null or p_puzzle_id <= 0 then
    raise exception 'invalid_puzzle';
  end if;

  if not exists (select 1 from public.puzzles where id = p_puzzle_id) then
    raise exception 'puzzle_not_found';
  end if;

  update public.rooms
  set current_puzzle_id = null
  where current_puzzle_id = p_puzzle_id;

  update public.room_messages
  set puzzle_id = null
  where puzzle_id = p_puzzle_id;

  delete from public.room_ai_requests where puzzle_id = p_puzzle_id;

  delete from public.puzzles where id = p_puzzle_id;
end;
$$;

notify pgrst, 'reload schema';
