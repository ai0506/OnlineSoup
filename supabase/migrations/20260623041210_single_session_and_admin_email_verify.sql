alter table public.profiles
  add column if not exists active_session_id text,
  add column if not exists active_session_updated_at timestamptz;

create or replace function public.record_login_context(
  p_ip text default null,
  p_device text default null,
  p_location text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  update public.profiles
  set
    last_login_ip = nullif(left(coalesce(p_ip, ''), 64), ''),
    last_login_device = nullif(left(coalesce(p_device, ''), 120), ''),
    last_login_location = nullif(left(coalesce(p_location, ''), 120), ''),
    last_login_at = now(),
    active_session_id = current_session_id,
    active_session_updated_at = case
      when current_session_id is null then active_session_updated_at
      else now()
    end,
    updated_at = now()
  where id = current_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.record_login_context(text, text, text) from public, anon, authenticated;
grant execute on function public.record_login_context(text, text, text) to authenticated;

create or replace function public.is_current_login_session()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  stored_session_id text;
begin
  if current_user_id is null then
    return false;
  end if;

  if current_session_id is null then
    return true;
  end if;

  select profiles.active_session_id
  into stored_session_id
  from public.profiles
  where profiles.id = current_user_id;

  if not found then
    return false;
  end if;

  if stored_session_id is null then
    update public.profiles
    set
      active_session_id = current_session_id,
      active_session_updated_at = now(),
      updated_at = now()
    where id = current_user_id;

    return true;
  end if;

  return stored_session_id = current_session_id;
end;
$$;

revoke all on function public.is_current_login_session() from public, anon, authenticated;
grant execute on function public.is_current_login_session() to authenticated;

notify pgrst, 'reload schema';
