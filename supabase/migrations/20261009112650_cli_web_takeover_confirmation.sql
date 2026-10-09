-- Web confirmation is a compare-and-swap over the current seat session.
set local lock_timeout='3s';
set local statement_timeout='30s';
create function soup_cli.require_web_session() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid()) then raise exception 'AUTH_EXPIRED'; end if;
  if soup_cli.is_cli() then raise exception 'USE_PLAYER_API'; end if;
end $$;
create function soup_cli.seat_session_version(s public.room_seats) returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.hmac(convert_to(jsonb_build_array(s.id,s.room_id,s.user_id,s.membership_id,s.active_session_id,s.active_session_updated_at)::text,'UTF8'),secret,'sha256'),'hex') from soup_cli.hash_secret
$$;
revoke all on function soup_cli.require_web_session(),soup_cli.seat_session_version(public.room_seats) from public,anon,authenticated;

create function public.get_room_takeover_status(p_room_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.room_seats%rowtype;
begin
  perform soup_cli.require_web_session();
  select a.* into s from public.room_seats a join public.rooms r on r.id=a.room_id
    where r.code=upper(btrim(p_room_code)) and r.status<>'closed' and a.user_id=auth.uid();
  if not found then raise exception 'ROOM_MEMBERSHIP_REQUIRED'; end if;
  return jsonb_build_object('cli_in_use',exists(select 1 from public.cli_sessions where session_id::text=s.active_session_id),
    'session_version',soup_cli.seat_session_version(s));
end $$;
revoke all on function public.get_room_takeover_status(text) from public,anon,authenticated;
grant execute on function public.get_room_takeover_status(text) to authenticated;

create function public.confirm_cli_room_takeover(p_room_code text,p_session_version text) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.rooms%rowtype; s public.room_seats%rowtype;
begin
  perform soup_cli.lock_transaction();
  perform soup_cli.require_web_session();
  select * into r from public.rooms where code=upper(btrim(p_room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.status='closed' then raise exception 'ROOM_CLOSED'; end if;
  select * into s from public.room_seats where room_id=r.id and user_id=auth.uid() for update;
  if not found then raise exception 'ROOM_MEMBERSHIP_REQUIRED'; end if;
  if p_session_version is distinct from soup_cli.seat_session_version(s)
     or not exists(select 1 from public.cli_sessions where session_id::text=s.active_session_id) then
    raise exception 'SEAT_SESSION_CHANGED';
  end if;
  update public.room_seats set active_session_id=auth.jwt()->>'session_id',active_session_updated_at=clock_timestamp() where id=s.id;
  return true;
end $$;
revoke all on function public.confirm_cli_room_takeover(text,text) from public,anon,authenticated;
grant execute on function public.confirm_cli_room_takeover(text,text) to authenticated;

-- Both historical entry paths could otherwise bypass the dialog. The global
-- gate serializes this check with CLI join/takeover, kick and room closure.
create function soup_cli.reject_unconfirmed_cli_takeover(p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.room_seats s join public.rooms r on r.id=s.room_id
    join public.cli_sessions c on c.session_id::text=s.active_session_id
    where r.code=upper(btrim(p_code)) and r.status<>'closed' and s.user_id=auth.uid()
      and s.active_session_id is distinct from (auth.jwt()->>'session_id')) then
    raise exception 'CLI_TAKEOVER_CONFIRMATION_REQUIRED';
  end if;
end $$;
revoke all on function soup_cli.reject_unconfirmed_cli_takeover(text) from public,anon,authenticated;
do $migration$
declare name text; d text;
begin
  foreach name in array array['take_over_room_session','join_room_as_member'] loop
    select pg_get_functiondef(p.oid) into strict d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
    if position('CLI_TAKEOVER_CONFIRMATION_REQUIRED' in d)=0 and position('reject_unconfirmed_cli_takeover' in d)=0 then
      if position('perform soup_cli.lock_transaction();' in d)=0 then raise exception 'Missing existing transaction gate: %',name; end if;
      d:=replace(d,'if soup_cli.is_cli() then raise exception ''USE_PLAYER_API''; end if;','if soup_cli.is_cli() then raise exception ''USE_PLAYER_API''; end if;'||E'\n  perform soup_cli.reject_unconfirmed_cli_takeover('||case when name='take_over_room_session' then 'p_room_code' else 'room_code' end||');');
      execute d;
    end if;
  end loop;
end $migration$;
notify pgrst, 'reload schema';
