-- Simplify the Q&A cache to stable yes/no answers only.
--
-- Only yes/no questions with no context-dependent referents are cached now.
-- Such answers are fixed by the puzzle itself and never change as players
-- discover more facts, so all fact-scoping (relevant_facts) is dropped and
-- lookups become a plain per-puzzle query.
--
-- The table is a pure cache, so existing rows are simply discarded.

truncate table puzzle_qa_cache;

alter table puzzle_qa_cache
  drop column if exists relevant_facts;

drop index if exists puzzle_qa_cache_facts_gin_idx;

-- Tighten the answer_type constraint to the only values we now store.
alter table puzzle_qa_cache
  drop constraint if exists puzzle_qa_cache_answer_type_check;

alter table puzzle_qa_cache
  add constraint puzzle_qa_cache_answer_type_check
  check (answer_type in ('yes', 'no'));

notify pgrst, 'reload schema';
