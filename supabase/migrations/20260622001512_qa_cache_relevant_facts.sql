-- Replace hash-based cache scoping with relevant_facts array.
-- Entries now store only the facts that were actually necessary to answer the
-- question; a cached answer is valid whenever current known facts is a
-- superset of relevant_facts (relevant_facts <@ current_facts).
--
-- Existing cache rows are incompatible with the new schema, so we truncate
-- first (the table is a pure cache — no user-visible data is lost).

truncate table puzzle_qa_cache;

alter table puzzle_qa_cache
  drop column if exists known_facts_hash,
  drop column if exists is_context_dependent,
  add column if not exists relevant_facts text[] not null default '{}';

drop index if exists puzzle_qa_cache_lookup_idx;
drop index if exists puzzle_qa_cache_stable_idx;
drop index if exists puzzle_qa_cache_hashed_idx;

-- GIN index enables efficient <@ (contained-by) queries
create index if not exists puzzle_qa_cache_facts_gin_idx
  on puzzle_qa_cache using gin(relevant_facts);

create index if not exists puzzle_qa_cache_puzzle_idx
  on puzzle_qa_cache(puzzle_id);

notify pgrst, 'reload schema';
