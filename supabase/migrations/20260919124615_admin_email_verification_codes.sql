create table public.admin_email_verification_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5)
);

alter table public.admin_email_verification_challenges enable row level security;

revoke all on table public.admin_email_verification_challenges from public, anon, authenticated;

create or replace function public.issue_admin_email_verification_challenge(
  p_challenge_id uuid,
  p_user_id uuid,
  p_session_id text,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_created_at timestamptz;
begin
  delete from public.admin_email_verification_challenges
  where expires_at <= now() or consumed_at is not null;

  select created_at
  into v_last_created_at
  from public.admin_email_verification_challenges
  where user_id = p_user_id
  order by created_at desc
  limit 1
  for update;

  if v_last_created_at is not null and v_last_created_at > now() - interval '1 minute' then
    return false;
  end if;

  delete from public.admin_email_verification_challenges
  where user_id = p_user_id;

  insert into public.admin_email_verification_challenges (
    id, user_id, session_id, code_hash, expires_at
  ) values (
    p_challenge_id, p_user_id, p_session_id, p_code_hash, now() + interval '10 minutes'
  );

  return true;
end;
$$;

create or replace function public.consume_admin_email_verification_challenge(
  p_challenge_id uuid,
  p_code_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.admin_email_verification_challenges%rowtype;
  v_session_id text;
begin
  if auth.uid() is null then
    return false;
  end if;

  v_session_id := auth.jwt() ->> 'session_id';
  select * into v_challenge
  from public.admin_email_verification_challenges
  where id = p_challenge_id
  for update;

  if not found
    or v_challenge.user_id <> auth.uid()
    or v_challenge.session_id <> v_session_id
    or v_challenge.consumed_at is not null
    or v_challenge.expires_at <= now()
    or v_challenge.attempt_count >= 5 then
    return false;
  end if;

  update public.admin_email_verification_challenges
  set attempt_count = attempt_count + 1,
      consumed_at = case when code_hash = p_code_hash then now() else null end
  where id = p_challenge_id;

  return v_challenge.code_hash = p_code_hash;
end;
$$;

revoke all on function public.issue_admin_email_verification_challenge(uuid, uuid, text, text) from public;
revoke all on function public.consume_admin_email_verification_challenge(uuid, text) from public;
grant execute on function public.issue_admin_email_verification_challenge(uuid, uuid, text, text) to service_role;
grant execute on function public.consume_admin_email_verification_challenge(uuid, text) to authenticated;

notify pgrst, 'reload schema';
