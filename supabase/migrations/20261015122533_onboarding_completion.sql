-- Onboarding tutorial completion is tracked per account so login can send
-- first-time users straight to /onboarding. Users already read their own
-- profiles row via the existing select grant + policy; writes go only through
-- complete_onboarding(), which can touch nothing but the caller's own flag.

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

create or replace function public.complete_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.profiles
     set onboarding_completed_at = now()
   where id = caller_id
     and onboarding_completed_at is null;
end;
$$;

revoke all on function public.complete_onboarding() from public, anon, authenticated;
grant execute on function public.complete_onboarding() to authenticated;

notify pgrst, 'reload schema';
