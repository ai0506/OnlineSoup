-- Mark whether a cached question has context-dependent referents (pronouns,
-- demonstratives, temporal words). These entries must be scoped by known_facts_hash
-- even when answer_type is yes/no, because new facts can make the referent ambiguous.
alter table puzzle_qa_cache
  add column if not exists is_context_dependent boolean not null default false;

-- Optimised lookup index for the two fetch paths:
--   path 1 (global):  puzzle_id + NOT is_context_dependent + answer_type IN (yes,no)
--   path 2 (hashed):  puzzle_id + known_facts_hash + (is_context_dependent OR answer_type NOT IN (yes,no))
create index if not exists puzzle_qa_cache_stable_idx
  on puzzle_qa_cache(puzzle_id, answer_type)
  where is_context_dependent = false;

create index if not exists puzzle_qa_cache_hashed_idx
  on puzzle_qa_cache(puzzle_id, known_facts_hash)
  where is_context_dependent = true;

notify pgrst, 'reload schema';
