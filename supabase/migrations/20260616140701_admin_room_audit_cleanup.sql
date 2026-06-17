grant select on table public.rooms to service_role;
grant select on table public.room_messages to service_role;

create or replace function public.admin_list_room_cleanup_candidates()
returns table (
  room_id uuid,
  room_code text,
  room_name text,
  room_status public.room_status,
  owner_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_at timestamptz,
  message_count bigint,
  cleanup_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    rooms.id as room_id,
    rooms.code as room_code,
    rooms.name as room_name,
    rooms.status as room_status,
    rooms.owner_id,
    rooms.created_at,
    rooms.updated_at,
    max(room_messages.created_at) as last_message_at,
    count(room_messages.id) as message_count,
    case
      when rooms.status = 'closed'
        and rooms.updated_at < now() - interval '3 days'
        then 'closed_over_3_days'
      else 'inactive_over_1_day'
    end as cleanup_reason
  from public.rooms
  left join public.room_messages
    on room_messages.room_id = rooms.id
  group by rooms.id
  having (
    rooms.status = 'closed'
    and rooms.updated_at < now() - interval '3 days'
  ) or (
    coalesce(max(room_messages.created_at), rooms.created_at)
      < now() - interval '1 day'
  )
  order by
    case
      when rooms.status = 'closed'
        and rooms.updated_at < now() - interval '3 days'
        then 0
      else 1
    end,
    coalesce(max(room_messages.created_at), rooms.created_at) asc,
    rooms.created_at asc;
$$;

create or replace function public.admin_force_close_and_clear_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms%rowtype;
  refund_total integer := 0;
  current_points integer;
  deleted_message_count bigint := 0;
begin
  select *
  into target_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'room_not_found';
  end if;

  if target_room.status <> 'closed' then
    select coalesce(sum(remaining_points), 0)
    into refund_total
    from public.room_seats
    where room_id = target_room.id;

    if refund_total > 0 then
      select points
      into current_points
      from public.profiles
      where id = target_room.owner_id
      for update;

      update public.profiles
      set points = points + refund_total,
          updated_at = now()
      where id = target_room.owner_id;

      insert into public.points_transactions (
        user_id,
        room_id,
        type,
        amount,
        balance_after
      )
      values (
        target_room.owner_id,
        target_room.id,
        'room_refund',
        refund_total,
        current_points + refund_total
      );
    end if;

    update public.rooms
    set status = 'closed',
        updated_at = now()
    where id = target_room.id;
  end if;

  with deleted as (
    delete from public.room_messages
    where room_id = target_room.id
    returning id
  )
  select count(*) into deleted_message_count
  from deleted;

  return jsonb_build_object(
    'room_id', target_room.id,
    'room_code', target_room.code,
    'closed', target_room.status <> 'closed',
    'refunded_points', refund_total,
    'deleted_messages', deleted_message_count
  );
end;
$$;

revoke all on function public.admin_list_room_cleanup_candidates()
  from public, anon, authenticated;
revoke all on function public.admin_force_close_and_clear_room(uuid)
  from public, anon, authenticated;

grant execute on function public.admin_list_room_cleanup_candidates()
  to service_role;
grant execute on function public.admin_force_close_and_clear_room(uuid)
  to service_role;

notify pgrst, 'reload schema';
