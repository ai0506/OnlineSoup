create table if not exists puzzle_qa_cache (
  id bigint generated always as identity primary key,
  puzzle_id bigint not null references puzzles(id) on delete cascade,
  known_facts_hash text not null default '',
  question_text text not null,
  normalized_question text not null,
  answer_type text not null check (answer_type in ('yes', 'no', 'irrelevant', 'ambiguous')),
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);

create index if not exists puzzle_qa_cache_lookup_idx on puzzle_qa_cache(puzzle_id, known_facts_hash);

-- Only service_role may read or write this table
revoke all on puzzle_qa_cache from public, anon, authenticated;
grant select, insert, update on puzzle_qa_cache to service_role;

-- Atomic hit counter increment called from the app server
create or replace function increment_qa_cache_hit(entry_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.puzzle_qa_cache
  set hit_count = hit_count + 1,
      last_hit_at = now()
  where id = entry_id;
$$;

revoke all on function increment_qa_cache_hit(bigint) from public, anon, authenticated;
grant execute on function increment_qa_cache_hit(bigint) to service_role;

notify pgrst, 'reload schema';
