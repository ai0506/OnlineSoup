-- Fix multi-device session takeover ping-pong:
-- 1. Revert can_use_room_session to read-only check (don't auto-take-over on refresh)
-- 2. Add take_over_room_session: explicit takeover, only called when user intentionally enters
-- 3. join_room_as_member already takes over (kept from previous migration)

-- Restore can_use_room_session to check-only behavior:
-- returns true if session matches (or no session tracking)
-- returns false if a different session owns the seat (meaning this device was displaced)
create or replace function public.can_use_room_session(room_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  target_room public.rooms%rowtype;
  target_seat public.room_seats%rowtype;
begin
  if current_user_id is null then
    return false;
  end if;

  if current_session_id is null then
    return true;
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(room_code));

  if not found or target_room.status = 'closed' then
    return false;
  end if;

  select *
  into target_seat
  from public.room_seats
  where room_id = target_room.id
    and user_id = current_user_id
  for update;

  if not found then
    return false;
  end if;

  -- Claim if unclaimed; otherwise verify session matches
  if target_seat.active_session_id is null then
    update public.room_seats
    set active_session_id = current_session_id,
        active_session_updated_at = now()
    where id = target_seat.id;
    return true;
  end if;

  return target_seat.active_session_id = current_session_id;
end;
$$;

-- Explicit takeover: called only when the user intentionally enters on a new device.
-- Updates active_session_id to the current session, displacing the previous device.
create or replace function public.take_over_room_session(p_room_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_session_id text := nullif((select auth.jwt() ->> 'session_id'), '');
  target_room public.rooms%rowtype;
  target_seat public.room_seats%rowtype;
begin
  if current_user_id is null then
    return false;
  end if;

  if current_session_id is null then
    return true;
  end if;

  select *
  into target_room
  from public.rooms
  where code = upper(trim(p_room_code));

  if not found or target_room.status = 'closed' then
    return false;
  end if;

  select *
  into target_seat
  from public.room_seats
  where room_id = target_room.id
    and user_id = current_user_id
  for update;

  if not found then
    return false;
  end if;

  update public.room_seats
  set active_session_id = current_session_id,
      active_session_updated_at = now()
  where id = target_seat.id;

  return true;
end;
$$;

revoke all on function public.can_use_room_session(text) from public, anon, authenticated;
revoke all on function public.take_over_room_session(text) from public, anon, authenticated;

grant execute on function public.can_use_room_session(text) to authenticated;
grant execute on function public.take_over_room_session(text) to authenticated;

notify pgrst, 'reload schema';
