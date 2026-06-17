create or replace function public.get_my_active_room()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rooms.code
  from public.rooms
  left join public.room_seats
    on room_seats.room_id = rooms.id
    and room_seats.user_id = (select auth.uid())
  where (select auth.uid()) is not null
    and rooms.status <> 'closed'
    and (
      rooms.owner_id = (select auth.uid())
      or room_seats.id is not null
    )
  order by
    case when rooms.owner_id = (select auth.uid()) then 0 else 1 end,
    rooms.created_at desc
  limit 1;
$$;

create or replace function public.verify_guest_membership(
  room_code text,
  guest_token text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guest_sessions
    join public.rooms on rooms.id = guest_sessions.room_id
    where rooms.code = upper(trim(room_code))
      and rooms.status <> 'closed'
      and guest_sessions.token_hash =
        encode(extensions.digest(guest_token, 'sha256'), 'hex')
  );
$$;

revoke all on function public.get_my_active_room()
  from public, anon, authenticated;
revoke all on function public.verify_guest_membership(text, text)
  from public, anon, authenticated;

grant execute on function public.get_my_active_room()
  to authenticated;
grant execute on function public.verify_guest_membership(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
