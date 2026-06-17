alter table public.puzzles
  add column if not exists key_points jsonb not null default '[]'::jsonb,
  add column if not exists examples jsonb not null default '[]'::jsonb;

drop function if exists public.admin_create_puzzle(text, text, text, text);
drop function if exists public.admin_update_puzzle(integer, text, text, text, text, boolean);

create or replace function public.admin_create_puzzle(
  p_title text,
  p_surface text,
  p_bottom text,
  p_difficulty text,
  p_key_points jsonb,
  p_examples jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_title is null or length(trim(p_title)) < 1 or length(trim(p_title)) > 60 then
    raise exception 'invalid_title';
  end if;

  if p_surface is null or length(trim(p_surface)) < 5 or length(trim(p_surface)) > 1000 then
    raise exception 'invalid_surface';
  end if;

  if p_bottom is null or length(trim(p_bottom)) < 5 or length(trim(p_bottom)) > 2000 then
    raise exception 'invalid_bottom';
  end if;

  if p_difficulty not in ('简单', '中等', '困难', '抽象') then
    raise exception 'invalid_difficulty';
  end if;

  if jsonb_typeof(coalesce(p_key_points, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_key_points';
  end if;

  if jsonb_typeof(coalesce(p_examples, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_examples';
  end if;

  insert into public.puzzles (
    title, surface, bottom, difficulty, is_active, key_points, examples
  )
  values (
    trim(p_title),
    trim(p_surface),
    trim(p_bottom),
    p_difficulty,
    true,
    coalesce(p_key_points, '[]'::jsonb),
    coalesce(p_examples, '[]'::jsonb)
  );
exception
  when unique_violation then
    raise exception 'puzzle_title_taken';
end;
$$;

create or replace function public.admin_update_puzzle(
  p_puzzle_id integer,
  p_title text,
  p_surface text,
  p_bottom text,
  p_difficulty text,
  p_is_active boolean,
  p_key_points jsonb,
  p_examples jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_puzzle_id is null or p_puzzle_id <= 0 then
    raise exception 'invalid_puzzle';
  end if;

  if p_title is null or length(trim(p_title)) < 1 or length(trim(p_title)) > 60 then
    raise exception 'invalid_title';
  end if;

  if p_surface is null or length(trim(p_surface)) < 5 or length(trim(p_surface)) > 1000 then
    raise exception 'invalid_surface';
  end if;

  if p_bottom is null or length(trim(p_bottom)) < 5 or length(trim(p_bottom)) > 2000 then
    raise exception 'invalid_bottom';
  end if;

  if p_difficulty not in ('简单', '中等', '困难', '抽象') then
    raise exception 'invalid_difficulty';
  end if;

  if jsonb_typeof(coalesce(p_key_points, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_key_points';
  end if;

  if jsonb_typeof(coalesce(p_examples, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_examples';
  end if;

  update public.puzzles
  set
    title = trim(p_title),
    surface = trim(p_surface),
    bottom = trim(p_bottom),
    difficulty = p_difficulty,
    is_active = coalesce(p_is_active, false),
    key_points = coalesce(p_key_points, '[]'::jsonb),
    examples = coalesce(p_examples, '[]'::jsonb)
  where id = p_puzzle_id;

  if not found then
    raise exception 'puzzle_not_found';
  end if;
exception
  when unique_violation then
    raise exception 'puzzle_title_taken';
end;
$$;

revoke all on function public.admin_create_puzzle(text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.admin_update_puzzle(integer, text, text, text, text, boolean, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.admin_create_puzzle(text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.admin_update_puzzle(integer, text, text, text, text, boolean, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
