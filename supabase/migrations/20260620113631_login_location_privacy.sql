alter table public.profiles
  add column if not exists last_login_location text;

alter table public.points_transactions
  add column if not exists login_location text;

drop function if exists public.record_login_context(text, text);

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
    updated_at = now()
  where id = current_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;
end;
$$;

revoke all on function public.record_login_context(text, text, text) from public, anon, authenticated;
grant execute on function public.record_login_context(text, text, text) to authenticated;

create or replace function public.fill_points_transaction_login_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_ip text;
  profile_device text;
  profile_location text;
begin
  if new.login_ip is null or new.login_device is null or new.login_location is null then
    select last_login_ip, last_login_device, last_login_location
    into profile_ip, profile_device, profile_location
    from public.profiles
    where id = new.user_id;

    new.login_ip := coalesce(new.login_ip, profile_ip);
    new.login_device := coalesce(new.login_device, profile_device);
    new.login_location := coalesce(new.login_location, profile_location);
  end if;

  return new;
end;
$$;

revoke all on function public.fill_points_transaction_login_context() from public, anon, authenticated;

create or replace function public.get_my_profile_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  profile_row     public.profiles%rowtype;
  stats_row       record;
  solved_puzzles  jsonb;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select * into profile_row
  from public.profiles
  where id = current_user_id;

  if not found then
    raise exception 'profile_not_found';
  end if;

  select
    count(*) filter (where rm.message_mode = 'ask')    as ask_count,
    count(*) filter (where rm.message_mode = 'hint')   as hint_count,
    count(*) filter (where rm.message_mode = 'reason') as reason_count
  into stats_row
  from public.room_messages rm
  join public.room_seats rs on rs.id = rm.seat_id
  where rs.user_id = current_user_id
    and rm.message_type = 'ai'
    and rm.message_mode in ('ask', 'hint', 'reason');

  select coalesce(jsonb_agg(t order by t.solved_at), '[]'::jsonb)
  into solved_puzzles
  from (
    select distinct on (pp.puzzle_id)
      p.id,
      p.title,
      p.difficulty,
      pp.updated_at as solved_at
    from public.puzzle_progress pp
    join public.puzzles p on p.id = pp.puzzle_id
    where pp.solved = true
      and pp.room_id in (
        select id from public.rooms where owner_id = current_user_id
        union
        select room_id from public.room_seats where user_id = current_user_id
      )
    order by pp.puzzle_id, pp.updated_at
  ) t;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'username',            profile_row.username,
      'display_name',        profile_row.display_name,
      'points',              profile_row.points,
      'created_at',          profile_row.created_at,
      'last_login_location', profile_row.last_login_location,
      'last_login_device',   profile_row.last_login_device,
      'last_login_at',       profile_row.last_login_at
    ),
    'stats', jsonb_build_object(
      'ask_count',    coalesce(stats_row.ask_count, 0),
      'hint_count',   coalesce(stats_row.hint_count, 0),
      'reason_count', coalesce(stats_row.reason_count, 0)
    ),
    'solved_puzzles', solved_puzzles
  );
end;
$$;

revoke all on function public.get_my_profile_page() from public, anon, authenticated;
grant execute on function public.get_my_profile_page() to authenticated;

create or replace function public.get_my_points_history(
  p_page      integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  total_count     bigint;
  transactions    jsonb;
  v_offset        integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_page < 1 then
    p_page := 1;
  end if;

  if p_page_size < 1 or p_page_size > 100 then
    p_page_size := 20;
  end if;

  v_offset := (p_page - 1) * p_page_size;

  select count(*) into total_count
  from public.points_transactions
  where user_id = current_user_id;

  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into transactions
  from (
    select
      pt.id,
      pt.type,
      pt.amount,
      pt.balance_after,
      pt.created_at,
      pt.login_location,
      pt.login_device,
      r.name as room_name
    from public.points_transactions pt
    left join public.rooms r on r.id = pt.room_id
    where pt.user_id = current_user_id
    order by pt.created_at desc, pt.id desc
    limit p_page_size
    offset v_offset
  ) t;

  return jsonb_build_object(
    'total',        total_count,
    'page',         p_page,
    'page_size',    p_page_size,
    'transactions', transactions
  );
end;
$$;

revoke all on function public.get_my_points_history(integer, integer) from public, anon, authenticated;
grant execute on function public.get_my_points_history(integer, integer) to authenticated;

notify pgrst, 'reload schema';
