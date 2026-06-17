create or replace function public.get_room_exit_reason(
  room_code text,
  guest_token text default null,
  guest_identity text default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  current_user_id uuid := (select auth.uid());
  current_member_key text;
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

    if exists (
      select 1
      from public.guest_sessions
      where room_id = target_room.id
        and token_hash = hashed_token
    ) then
      return 'active';
    end if;
  end if;

  if current_user_id is not null then
    current_member_key := 'user:' || current_user_id::text;
  elsif guest_identity is not null
    and guest_identity ~ '^[a-f0-9]{64}$'
  then
    current_member_key :=
      'guest:' || encode(extensions.digest(guest_identity, 'sha256'), 'hex');
  end if;

  if current_member_key is not null and exists (
    select 1
    from public.guest_removals
    where room_id = target_room.id
      and member_key = current_member_key
      and reason = 'kicked'
  ) then
    return 'kicked';
  end if;

  return 'active';
end;
$$;

revoke all on function public.get_room_exit_reason(text, text, text)
  from public;
grant execute on function public.get_room_exit_reason(text, text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
