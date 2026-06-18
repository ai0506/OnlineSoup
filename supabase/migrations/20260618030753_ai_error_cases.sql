create table if not exists public.ai_error_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  puzzle_id integer references public.puzzles(id) on delete set null,
  question_message_id bigint references public.room_messages(id) on delete set null,
  ai_message_id bigint references public.room_messages(id) on delete set null,
  question_content text not null check (char_length(question_content) between 1 and 500),
  ai_content text not null check (char_length(ai_content) between 1 and 2000),
  correct_answer text not null check (char_length(correct_answer) between 1 and 1000),
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'fixed', 'ignored')),
  puzzle_title text not null check (char_length(puzzle_title) between 1 and 120),
  puzzle_surface text not null check (char_length(puzzle_surface) between 1 and 2000),
  puzzle_bottom text not null check (char_length(puzzle_bottom) between 1 and 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_error_cases_ai_message_unique_idx
  on public.ai_error_cases (ai_message_id)
  where ai_message_id is not null;

create index if not exists ai_error_cases_created_idx
  on public.ai_error_cases (created_at desc);

create index if not exists ai_error_cases_status_idx
  on public.ai_error_cases (status);

create index if not exists ai_error_cases_puzzle_idx
  on public.ai_error_cases (puzzle_id);

alter table public.ai_error_cases enable row level security;

revoke all on table public.ai_error_cases from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_error_cases to service_role;

notify pgrst, 'reload schema';
