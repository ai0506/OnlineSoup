alter table public.puzzle_qa_cache
  add column if not exists status text not null default 'pending';

alter table public.puzzle_qa_cache
  drop constraint if exists puzzle_qa_cache_status_check;

alter table public.puzzle_qa_cache
  add constraint puzzle_qa_cache_status_check
  check (status in ('pending', 'approved'));

-- Existing cache rows were generated before manual review was required.
-- Keep them visible in the admin panel, but stop them from being used as hits
-- until an admin explicitly approves them.
update public.puzzle_qa_cache
set status = 'pending'
where status is distinct from 'pending';

create index if not exists puzzle_qa_cache_approved_lookup_idx
  on public.puzzle_qa_cache(puzzle_id, normalized_question)
  where status = 'approved';

create index if not exists puzzle_qa_cache_pending_cleanup_idx
  on public.puzzle_qa_cache(created_at)
  where status = 'pending';

create or replace function public.cleanup_expired_qa_cache_pending()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from public.puzzle_qa_cache
  where status = 'pending'
    and created_at < now() - interval '3 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_qa_cache_pending() from public, anon, authenticated;
grant execute on function public.cleanup_expired_qa_cache_pending() to service_role;

notify pgrst, 'reload schema';
