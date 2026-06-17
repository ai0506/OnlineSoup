-- admin_delete_puzzle 之前只是把 is_active 置为 false（软删除），题目记录仍留在
-- puzzles 表里，管理后台列表还能看到它、只是打了"已移除"标签，不是真正删除。
-- 改为真正物理删除：先解除 rooms.current_puzzle_id 和 room_messages.puzzle_id 对该
-- 题目的引用（避免外键冲突；历史聊天内容本身不受影响，只是不再标注属于哪道题），
-- puzzle_progress 通过 on delete cascade 引用 puzzles，会随之自动清空。
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

  delete from public.puzzles where id = p_puzzle_id;
end;
$$;

notify pgrst, 'reload schema';
