-- 房主修改或取消房间密码：只存 bcrypt 哈希；传 null 或空字符串表示取消密码。
create or replace function public.update_room_password(room_code text, new_password text default null)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.rooms%rowtype;
  normalized_password text := nullif(new_password, '');
begin
  perform soup_cli.lock_transaction();
  if soup_cli.is_cli() then raise exception 'USE_PLAYER_API'; end if;
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  if normalized_password is not null and normalized_password !~ '^[0-9]{6}$' then
    raise exception 'invalid_room_password';
  end if;

  select * into target_room
  from public.rooms
  where code = upper(trim(room_code))
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.owner_id <> current_user_id then
    raise exception 'not_room_owner';
  end if;

  if target_room.status = 'closed' then
    raise exception 'room_closed';
  end if;

  insert into public.room_private (room_id, password_hash)
  values (
    target_room.id,
    case
      when normalized_password is null then null
      else extensions.crypt(normalized_password, extensions.gen_salt('bf'))
    end
  )
  on conflict (room_id) do update
  set password_hash = excluded.password_hash;

  return normalized_password is not null;
end;
$function$;

revoke all on function public.update_room_password(text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_room_password(text, text) to authenticated;

notify pgrst, 'reload schema';
