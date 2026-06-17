create table public.guest_removals (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  token_hash text not null,
  reason text not null check (reason in ('kicked')),
  created_at timestamptz not null default now(),
  unique (room_id, token_hash)
);

alter table public.guest_removals enable row level security;
revoke all on public.guest_removals from anon, authenticated;

create or replace function public.kick_guest(
  room_code text,
  target_seat_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.rooms%rowtype;
  target_session public.guest_sessions%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.owner_id <> current_user_id then
    raise exception 'not_room_owner';
  end if;

  select *
  into target_session
  from public.guest_sessions
  where room_id = target_room.id
    and seat_id = target_seat_id
  for update;

  if not found then
    raise exception 'guest_membership_not_found';
  end if;

  insert into public.guest_removals (room_id, token_hash, reason)
  values (target_room.id, target_session.token_hash, 'kicked')
  on conflict (room_id, token_hash)
  do update set reason = excluded.reason,
                created_at = now();

  delete from public.guest_sessions
  where id = target_session.id;

  update public.room_seats
  set nickname = null,
      remaining_points = target_room.points_per_seat,
      occupied_at = null
  where id = target_session.seat_id;
end;
$$;

create or replace function public.get_room_exit_reason(
  room_code text,
  guest_token text default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  hashed_token text;
begin
  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found then
    return 'not_found';
  end if;

  if target_room.status = 'closed' then
    return 'closed';
  end if;

  if guest_token is not null and guest_token <> '' then
    hashed_token :=
      encode(extensions.digest(guest_token, 'sha256'), 'hex');

    if exists (
      select 1
      from public.guest_removals
      where room_id = target_room.id
        and token_hash = hashed_token
        and reason = 'kicked'
    ) then
      return 'kicked';
    end if;
  end if;

  return 'active';
end;
$$;

revoke all on function public.kick_guest(text, uuid) from public;
revoke all on function public.get_room_exit_reason(text, text) from public;

grant execute on function public.kick_guest(text, uuid) to authenticated;
grant execute on function public.get_room_exit_reason(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
