create or replace function public.close_room(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.rooms%rowtype;
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

  update public.rooms
  set status = 'closed',
      updated_at = now()
  where id = target_room.id;
end;
$$;

create or replace function public.leave_room_as_guest(
  room_code text,
  guest_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.guest_sessions%rowtype;
  target_points integer;
begin
  select guest_sessions.*
  into target_session
  from public.guest_sessions
  join public.rooms on rooms.id = guest_sessions.room_id
  where rooms.code = upper(trim(room_code))
    and guest_sessions.token_hash =
      encode(extensions.digest(guest_token, 'sha256'), 'hex')
  for update of guest_sessions;

  if not found then
    raise exception 'guest_membership_not_found';
  end if;

  select points_per_seat
  into target_points
  from public.rooms
  where id = target_session.room_id;

  delete from public.guest_sessions
  where id = target_session.id;

  update public.room_seats
  set nickname = null,
      remaining_points = target_points,
      occupied_at = null
  where id = target_session.seat_id;
end;
$$;

revoke all on function public.close_room(text) from public;
revoke all on function public.leave_room_as_guest(text, text) from public;

grant execute on function public.close_room(text) to authenticated;
grant execute on function public.leave_room_as_guest(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
