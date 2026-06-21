alter table public.puzzle_qa_cache enable row level security;

notify pgrst, 'reload schema';
