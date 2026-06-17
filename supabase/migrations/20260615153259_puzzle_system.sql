-- ── 题库表 ──────────────────────────────────────────────────────────────────

create table if not exists public.puzzles (
  id         integer primary key generated always as identity,
  title      text    not null,
  surface    text    not null,
  bottom     text    not null,
  difficulty text    not null check (difficulty in ('简单', '中等', '困难', '抽象')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- 唯一标题保证种子数据可重复执行
alter table public.puzzles
  drop constraint if exists puzzles_title_unique;
alter table public.puzzles
  add constraint puzzles_title_unique unique (title);

-- ── 每房间每题目进度 ──────────────────────────────────────────────────────────

create table if not exists public.puzzle_progress (
  room_id    uuid    not null references public.rooms(id)    on delete cascade,
  puzzle_id  integer not null references public.puzzles(id)  on delete cascade,
  solved     boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, puzzle_id)
);

-- ── 房间当前题目 ──────────────────────────────────────────────────────────────

alter table public.rooms
  add column if not exists current_puzzle_id integer references public.puzzles(id);

-- ── RLS：不允许客户端直接读写 ────────────────────────────────────────────────

alter table public.puzzles         enable row level security;
alter table public.puzzle_progress enable row level security;

-- ── 种子数据（9 道题） ───────────────────────────────────────────────────────

insert into public.puzzles (title, surface, bottom, difficulty) values
(
  '餐厅自杀',
  '一个男人走进一家餐厅，点了一碗海龟汤，喝完之后大哭起来，然后自杀了。为什么？',
  '男人曾是一名海难幸存者，被困在荒岛上。为了生存，他和同伴们不得不吃掉死去同伴的肉。当时有人告诉他那是海龟汤。多年后，他在餐厅喝到真正的海龟汤，发现味道完全不同，这才意识到当年他吃的其实是人肉。巨大的罪恶感和崩溃导致他选择了自杀。',
  '中等'
),
(
  '足球',
  '一个小男孩看着足球哭泣。为什么？',
  '小男孩的爸爸是一名足球运动员，在一次比赛中意外去世。小男孩的妈妈为了纪念爸爸，把爸爸的头做成了一个足球。当小男孩知道真相后，看着那个足球哭泣。',
  '抽象'
),
(
  '电梯',
  '一个男人住在10楼，每天早上他坐电梯到1楼出门。晚上回来时，如果下雨或者电梯里有其他人，他就直接坐到10楼。否则，他坐到7楼，然后走楼梯上楼。为什么？',
  '这个男人是一个侏儒（身材矮小的人）。他太矮了，够不到10楼的按钮。下雨天他可以用雨伞按按钮，有其他人的时候可以请别人帮忙按，否则只能走到7楼，因为7楼的按钮是他能按到的最高的按钮。',
  '简单'
),
(
  '迷路的三兄弟',
  E'我们三兄弟从另一个世界穿越到这里，我却和他们走散迷路了。\n我看见一处门口的海报上写着我的名字，我想一定是兄弟们在找我，于是我走了进去。\n却发现这里全都是打扮得奇特又美丽的人类，跟我在外面街上看到的很不一样。\n我知道是走错地方了，但为什么他们的名字和我那么像？',
  E'我们三兄弟是sin，cos和tan，我们从数学世界穿越到了人类世界。\n我是cos，我看到门口的海报上写着cosplay还以为是在说我，进去后没想到误入了漫展，里面全是coser。',
  '抽象'
),
(
  'asw的奶茶店',
  'asw 开了一家奶茶店，为招揽顾客策划线下活动，特意设计电子海报，印上 "9.9 元两杯奶茶" 后兴冲冲打印张贴。可路过的行人看到海报，非但没进店，反而纷纷被吓跑了。',
  'asw打字打快了，把"两"打成了"李盎"',
  '抽象'
),
(
  '太阳之子',
  '村民阿良养着一只被他奉为 "太阳之子" 的生灵，它每至黎明便会引吭宣告，随后日光破晓、太阳升起，仿佛由它亲自迎来白昼。可这所谓的神迹，却让村民们不堪其扰、满心怨怼。直到某天，在一场公开的宴席上，它被一群人当场杀死，围观的人非但没有阻止，反而个个面露喜色，事后也无人再提起此事。',
  '"太阳之子" 其实就是一只普通的公鸡。只有主人阿良觉得它能唤来太阳，奉若珍宝；可村民们都厌恶它每天凌晨太早打鸣，吵得所有人无法安睡，早就想除掉它。恰逢村里摆宴，众人便借机把这只公鸡杀了做成菜吃掉，既解决了烦扰，又能饱餐一顿，所以大家都很开心，自然没人阻止或追究。',
  '中等'
),
(
  '不见血的现场',
  '房间里有一具尸体，周围散落着一些碎玻璃和水渍，但是没有任何血迹。',
  '死者是一条鱼，鱼缸被打破了，鱼缺水死亡，地上是碎玻璃和水。',
  '简单'
),
(
  '函数',
  '我是f(x)，x∈R，当x=0时,我等于0，我和x轴有两个交点',
  '我是x^3-x^2',
  '中等'
),
(
  '上课铃',
  E'上课铃响了！\n怎么没人了？',
  '上的体育课，人都在操场上。',
  '困难'
)
on conflict (title) do nothing;

-- ── get_puzzle_list：房主获取题库（含本房间进度） ──────────────────────────

create or replace function public.get_puzzle_list(room_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room     public.rooms%rowtype;
begin
  select * into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.owner_id <> current_user_id then
    raise exception 'not_room_owner';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.id), '[]'::jsonb)
    from (
      select
        p.id,
        p.title,
        p.surface,
        p.difficulty,
        (pp.room_id is not null)   as played,
        coalesce(pp.solved, false) as solved
      from public.puzzles p
      left join public.puzzle_progress pp
        on pp.puzzle_id = p.id and pp.room_id = target_room.id
      where p.is_active = true
    ) t
  );
end;
$$;

revoke all on function public.get_puzzle_list(text) from public, anon, authenticated;
grant  execute on function public.get_puzzle_list(text) to authenticated;

-- ── get_room_current_puzzle：成员获取当前题面（不含汤底） ──────────────────

create or replace function public.get_room_current_puzzle(
  room_code   text,
  guest_token text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room     public.rooms%rowtype;
  member_seat_id  uuid;
  puzzle          public.puzzles%rowtype;
  is_solved       boolean;
begin
  select * into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found or target_room.status = 'closed' then
    raise exception 'room_not_found';
  end if;

  if current_user_id = target_room.owner_id then
    select id into member_seat_id
    from public.room_seats
    where room_id = target_room.id and seat_number = 1 and nickname is not null;
  elsif current_user_id is not null then
    select id into member_seat_id
    from public.room_seats
    where room_id = target_room.id and user_id = current_user_id and nickname is not null;
  elsif guest_token is not null and guest_token <> '' then
    select gs.seat_id into member_seat_id
    from public.guest_sessions gs
    where gs.room_id = target_room.id
      and gs.token_hash = encode(extensions.digest(guest_token, 'sha256'), 'hex');
  end if;

  if member_seat_id is null then
    raise exception 'room_membership_required';
  end if;

  if target_room.current_puzzle_id is null then
    return null;
  end if;

  select * into puzzle from public.puzzles where id = target_room.current_puzzle_id;

  if not found then
    return null;
  end if;

  select coalesce(pp.solved, false) into is_solved
  from public.puzzle_progress pp
  where pp.room_id = target_room.id and pp.puzzle_id = puzzle.id;

  return jsonb_build_object(
    'id',         puzzle.id,
    'title',      puzzle.title,
    'surface',    puzzle.surface,
    'difficulty', puzzle.difficulty,
    'solved',     coalesce(is_solved, false)
  );
end;
$$;

revoke all on function public.get_room_current_puzzle(text, text) from public, anon, authenticated;
grant  execute on function public.get_room_current_puzzle(text, text) to anon, authenticated;

-- ── open_puzzle：房主开题 / 切题 ─────────────────────────────────────────────

create or replace function public.open_puzzle(
  room_code text,
  puzzle_id integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
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
  where id = puzzle_id and is_active = true;

  if not found then
    raise exception 'puzzle_not_found';
  end if;

  select * into owner_seat
  from public.room_seats
  where room_id = target_room.id and seat_number = 1;

  if target_room.current_puzzle_id is not null and target_room.current_puzzle_id <> puzzle_id then
    select * into prev_puzzle from public.puzzles where id = target_room.current_puzzle_id;
    system_content := format('【题目切换】%s → %s（%s）', prev_puzzle.title, target_puzzle.title, target_puzzle.difficulty);
  else
    system_content := format('【开始题目】%s（%s）', target_puzzle.title, target_puzzle.difficulty);
  end if;

  update public.rooms
  set current_puzzle_id = puzzle_id
  where id = target_room.id;

  insert into public.puzzle_progress (room_id, puzzle_id, solved)
  values (target_room.id, puzzle_id, false)
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

-- ── close_puzzle：房主停题 ────────────────────────────────────────────────────

create or replace function public.close_puzzle(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room     public.rooms%rowtype;
  owner_seat      public.room_seats%rowtype;
  puzzle          public.puzzles%rowtype;
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

  if target_room.owner_id <> current_user_id then
    raise exception 'not_room_owner';
  end if;

  if target_room.current_puzzle_id is null then
    raise exception 'no_active_puzzle';
  end if;

  select * into puzzle from public.puzzles where id = target_room.current_puzzle_id;

  select * into owner_seat
  from public.room_seats
  where room_id = target_room.id and seat_number = 1;

  update public.rooms
  set current_puzzle_id = null
  where id = target_room.id;

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
    format('【停止题目】%s', coalesce(puzzle.title, ''))
  );
end;
$$;

revoke all on function public.close_puzzle(text) from public, anon, authenticated;
grant  execute on function public.close_puzzle(text) to authenticated;

notify pgrst, 'reload schema';
