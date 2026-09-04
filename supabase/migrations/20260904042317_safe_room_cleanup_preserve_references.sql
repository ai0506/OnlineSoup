-- 房间清理安全修复：不删除仍被其它表引用的 room_messages，且候选列表只显示可删除消息。

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
  archived_message_count bigint := 0;
  deleted_message_count bigint := 0;
  preserved_message_count bigint := 0;
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
        user_id, room_id, type, amount, balance_after
      )
      values (
        target_room.owner_id,
        target_room.id,
        'room_refund',
        refund_total,
        current_points + refund_total
      );
    end if;
  end if;

  update public.rooms
  set status = 'closed',
      updated_at = now()
  where id = target_room.id;

  with archived as (
    insert into public.room_messages_archive (
      id,
      room_id,
      room_code,
      room_name,
      room_status,
      seat_id,
      sender_name,
      sender_seat_number,
      sender_type,
      message_type,
      message_mode,
      content,
      puzzle_id,
      reply_to_id,
      created_at,
      archived_reason
    )
    select
      m.id,
      m.room_id,
      target_room.code,
      target_room.name,
      'closed',
      m.seat_id,
      m.sender_name,
      m.sender_seat_number,
      m.sender_type,
      m.message_type,
      m.message_mode,
      m.content,
      m.puzzle_id,
      m.reply_to_id,
      m.created_at,
      'admin_room_cleanup'
    from public.room_messages as m
    where m.room_id = target_room.id
    on conflict (id) do nothing
    returning id
  )
  select count(*) into archived_message_count
  from archived;

  with deletable as materialized (
    select m.id
    from public.room_messages as m
    where m.room_id = target_room.id
      and not exists (
        select 1
        from public.room_ai_requests as requests
        where requests.request_message_id = m.id
      )
      and not exists (
        select 1
        from public.room_message_events as events
        where events.message_id = m.id
      )
  ),
  deleted as (
    delete from public.room_messages as m
    using deletable
    where m.id = deletable.id
    returning m.id
  )
  select count(*) into deleted_message_count
  from deleted;

  select count(*)
  into preserved_message_count
  from public.room_messages
  where room_id = target_room.id;

  return jsonb_build_object(
    'room_id', target_room.id,
    'room_code', target_room.code,
    'closed', target_room.status <> 'closed',
    'refunded_points', refund_total,
    'archived_messages', archived_message_count,
    'deleted_messages', deleted_message_count,
    'preserved_messages', preserved_message_count
  );
end;
$$;

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
  cleanup_reason text,
  backup_pending boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with deletable_messages as materialized (
    select room_messages.*
    from public.room_messages
    where not exists (
      select 1
      from public.room_ai_requests
      where room_ai_requests.request_message_id = room_messages.id
    )
      and not exists (
        select 1
        from public.room_message_events
        where room_message_events.message_id = room_messages.id
      )
  )
  select
    rooms.id as room_id,
    rooms.code as room_code,
    rooms.name as room_name,
    rooms.status as room_status,
    rooms.owner_id,
    rooms.created_at,
    rooms.updated_at,
    max(deletable_messages.created_at) as last_message_at,
    count(deletable_messages.id) as message_count,
    case
      when rooms.status = 'closed' then 'closed_over_3_days'
      else 'abandoned_over_7_days'
    end as cleanup_reason,
    bool_or(
      not exists (
        select 1
        from public.chat_backup_downloads as downloads
        where downloads.backup_date =
              (deletable_messages.created_at at time zone 'Asia/Shanghai')::date
          and downloads.downloaded_at >= deletable_messages.created_at
      )
    ) as backup_pending
  from public.rooms
  join deletable_messages on deletable_messages.room_id = rooms.id
  group by rooms.id
  having (
    rooms.status = 'closed'
    and max(deletable_messages.created_at) < now() - interval '3 days'
  ) or (
    rooms.status <> 'closed'
    and max(deletable_messages.created_at) < now() - interval '7 days'
  )
  order by
    case when rooms.status = 'closed' then 0 else 1 end,
    max(deletable_messages.created_at) asc,
    rooms.created_at asc;
$$;

revoke all on function public.admin_force_close_and_clear_room(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_force_close_and_clear_room(uuid)
  to service_role;

revoke all on function public.admin_list_room_cleanup_candidates()
  from public, anon, authenticated;
grant execute on function public.admin_list_room_cleanup_candidates()
  to service_role;

notify pgrst, 'reload schema';
