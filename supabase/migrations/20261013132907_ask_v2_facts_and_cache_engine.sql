-- Ask v2: private per-puzzle Facts, a content version that isolates cached answers,
-- and engine-scoped QA cache entries. Table grants are unchanged: puzzles stays
-- service_role SELECT only, and Facts are written through a service_role RPC.

alter table public.puzzles
  add column if not exists facts jsonb not null default '[]'::jsonb,
  add column if not exists content_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'puzzles_facts_is_array' and conrelid = 'public.puzzles'::regclass
  ) then
    alter table public.puzzles
      add constraint puzzles_facts_is_array check (jsonb_typeof(facts) = 'array');
  end if;
end $$;

-- Any change to what the AI host reads bumps content_version, so engine v2 cache
-- entries from an older version stop matching. A rewritten story also sends every
-- reviewed Fact back to review unless the same update replaces the Facts.
create or replace function public.bump_puzzle_content_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.surface is distinct from old.surface or new.bottom is distinct from old.bottom)
    and new.facts is not distinct from old.facts then
    new.facts := coalesce((
      select jsonb_agg(
        case when jsonb_typeof(fact) = 'object' then fact || '{"status":"needs_review"}'::jsonb else fact end
        order by position
      )
      from jsonb_array_elements(new.facts) with ordinality as item(fact, position)
    ), '[]'::jsonb);
  end if;

  if new.surface is distinct from old.surface
    or new.bottom is distinct from old.bottom
    or new.examples is distinct from old.examples
    or new.facts is distinct from old.facts then
    new.content_version := old.content_version + 1;
  end if;

  return new;
end;
$$;

revoke all on function public.bump_puzzle_content_version() from public, anon, authenticated;

drop trigger if exists puzzles_bump_content_version on public.puzzles;
create trigger puzzles_bump_content_version
  before update on public.puzzles
  for each row execute function public.bump_puzzle_content_version();

alter table public.puzzle_qa_cache
  add column if not exists engine text not null default 'v1',
  add column if not exists content_version integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'puzzle_qa_cache_engine_check' and conrelid = 'public.puzzle_qa_cache'::regclass
  ) then
    alter table public.puzzle_qa_cache
      add constraint puzzle_qa_cache_engine_check
      check (engine in ('v1', 'v2') and (engine = 'v1' or content_version is not null));
  end if;
end $$;

create index if not exists puzzle_qa_cache_engine_lookup_idx
  on public.puzzle_qa_cache (puzzle_id, engine, content_version)
  where status = 'approved';

-- Facts structure is validated by the server before calling; the database only
-- guarantees an array of bounded size on an existing puzzle.
create or replace function public.admin_set_puzzle_facts(p_puzzle_id integer, p_facts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'facts must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_facts) > 60 then
    raise exception 'too many facts' using errcode = '22023';
  end if;

  update public.puzzles
  set facts = p_facts
  where id = p_puzzle_id
  returning content_version into v_version;

  if not found then
    raise exception 'puzzle not found' using errcode = 'P0002';
  end if;

  return v_version;
end;
$$;

revoke all on function public.admin_set_puzzle_facts(integer, jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_puzzle_facts(integer, jsonb) to service_role;

notify pgrst, 'reload schema';
