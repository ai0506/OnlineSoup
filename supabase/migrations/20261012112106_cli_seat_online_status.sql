-- Preserve membership/device checks; expose only a derived CLI activity flag.
create or replace function public.get_room_member_state(p_room_code text, p_guest_token text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  member_seat_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  perform soup_cli.lock_transaction();
  select * into target_room from public.rooms where code = upper(trim(p_room_code));
  if not found then raise exception 'room_not_found'; end if;
  if target_room.status = 'closed' then raise exception 'room_closed'; end if;
  member_seat_id := public.require_active_room_member_seat(target_room.id, p_guest_token);

  return jsonb_build_object(
    'room', jsonb_build_object('id', target_room.id, 'code', target_room.code, 'name', target_room.name, 'status', target_room.status,
      'max_members', target_room.max_members, 'points_per_seat', target_room.points_per_seat,
      'is_owner', current_user_id = target_room.owner_id),
    'seat_id', member_seat_id,
    'seats', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'seat_number', seat_number, 'nickname', nickname,
      'remaining_points', remaining_points, 'hint_tokens', hint_tokens, 'occupied_at', occupied_at,
      'is_current_user', id = member_seat_id,
      'cli_online', nickname is not null and exists (
        select 1 from public.cli_sessions c
        where c.session_id::text = room_seats.active_session_id
          and c.user_id = room_seats.user_id and c.revoked_at is null
      ) and (
        coalesce(last_cli_action_at > now() - interval '2 minutes', false)
        or exists (select 1 from public.room_ai_requests q
          where q.seat_id = room_seats.id and q.status = 'pending' and q.lease_expires_at > now())
      )) order by seat_number), '[]'::jsonb) from public.room_seats where room_id = target_room.id),
    'personal_points', case when current_user_id is null then null else (select points from public.profiles where id = current_user_id) end,
    'requires_password', exists(select 1 from public.room_private where room_id = target_room.id and password_hash is not null)
  );
end;
$$;

revoke all on function public.get_room_member_state(text, text) from public, anon, authenticated;
grant execute on function public.get_room_member_state(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
