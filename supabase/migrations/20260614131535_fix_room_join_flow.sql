alter table public.rooms
  alter column status set default 'waiting';

-- The application has no "start game" transition yet. Repair rooms that were
-- created with an incorrect non-joinable status by an out-of-sync schema.
update public.rooms
set status = 'waiting',
    updated_at = now()
where status = 'playing';

create or replace function public.room_requires_password(room_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requires_password boolean;
begin
  select room_private.password_hash is not null
  into requires_password
  from public.rooms
  join public.room_private on room_private.room_id = rooms.id
  where rooms.code = upper(trim(room_code))
    and rooms.status <> 'closed';

  return coalesce(requires_password, false);
end;
$$;

create or replace function public.verify_room_password(
  room_code text,
  room_password text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_status public.room_status;
  stored_password_hash text;
begin
  select rooms.status, room_private.password_hash
  into target_status, stored_password_hash
  from public.rooms
  join public.room_private on room_private.room_id = rooms.id
  where rooms.code = upper(trim(room_code));

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_status <> 'waiting' then
    raise exception 'room_not_joinable';
  end if;

  if stored_password_hash is null
    or room_password is null
    or extensions.crypt(room_password, stored_password_hash) <> stored_password_hash
  then
    raise exception 'wrong_password';
  end if;

  return true;
end;
$$;

revoke all on function public.room_requires_password(text) from public;
revoke all on function public.verify_room_password(text, text) from public;

grant execute on function public.room_requires_password(text)
  to anon, authenticated;
grant execute on function public.verify_room_password(text, text)
  to anon, authenticated;

notify pgrst, 'reload schema';
