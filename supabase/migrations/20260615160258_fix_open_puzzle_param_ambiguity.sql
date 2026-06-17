-- Fix open_puzzle: rename parameter puzzle_id -> p_puzzle_id to avoid
-- column reference ambiguity with puzzle_progress.puzzle_id (error 42702).

create or replace function public.open_puzzle(
  room_code  text,
  puzzle_id  integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p_puzzle_id     integer := puzzle_id;
  current_user_id uuid    := (select auth.uid());
  target_room     public.rooms%rowtype;
  target_puzzle   public.puzzles%rowtype;
  prev_puzzle     public.puzzles%rowtype;
  owner_seat      public.room_seats%rowtype;
  system_content  text;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select * into target_room
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  if target_room.owner_id <> current_user_id then
    raise exception 'not_room_owner';
  end if;

  select * into target_puzzle
  from public.puzzles
  where id = p_puzzle_id and is_active = true;

  if not found then
    raise exception 'puzzle_not_found';
  end if;

  select * into owner_seat
  from public.room_seats
  where room_id = target_room.id and seat_number = 1 and nickname is not null;

  if not found then
    raise exception 'owner_seat_not_found';
  end if;

  if target_room.current_puzzle_id is not null and target_room.current_puzzle_id <> p_puzzle_id then
    select * into prev_puzzle from public.puzzles where id = target_room.current_puzzle_id;
    system_content := format('【题目切换】%s → %s（%s）', prev_puzzle.title, target_puzzle.title, target_puzzle.difficulty);
  else
    system_content := format('【开始题目】%s（%s）', target_puzzle.title, target_puzzle.difficulty);
  end if;

  update public.rooms
  set current_puzzle_id = p_puzzle_id
  where id = target_room.id;

  insert into public.puzzle_progress (room_id, puzzle_id, solved)
  values (target_room.id, p_puzzle_id, false)
  on conflict (room_id, puzzle_id) do nothing;

  insert into public.room_messages (
    room_id, seat_id, sender_name, sender_seat_number,
    sender_type, message_type, content
  ) values (
    target_room.id,
    owner_seat.id,
    owner_seat.nickname,
    1,
    'registered',
    'system',
    system_content
  );
end;
$$;

revoke all on function public.open_puzzle(text, integer) from public, anon, authenticated;
grant  execute on function public.open_puzzle(text, integer) to authenticated;

notify pgrst, 'reload schema';
