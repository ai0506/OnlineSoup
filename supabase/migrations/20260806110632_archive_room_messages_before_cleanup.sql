-- 管理端「强制清理房间」原先直接 delete room_messages，聊天记录不可恢复，
-- 且未下载的当日备份会随之消失。改为先整体归档到 room_messages_archive 再删除，
-- 聊天备份统计与导出同时读取现表和归档表。

create table if not exists public.room_messages_archive (
  id bigint primary key,
  room_id uuid not null,
  room_code text not null,
  room_name text not null,
  room_status text not null,
  seat_id uuid,
  sender_name text not null,
  sender_seat_number integer not null,
  sender_type text not null,
  message_type text not null,
  message_mode text not null,
  content text not null,
  puzzle_id integer,
  reply_to_id bigint,
  created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  archived_reason text not null default 'admin_room_cleanup'
);

-- 归档表刻意不建外键：房间、座位、题目后续被删除时，归档记录仍须完整保留。
create index if not exists room_messages_archive_created_idx
  on public.room_messages_archive (created_at);

create index if not exists room_messages_archive_room_idx
  on public.room_messages_archive (room_id, created_at);

alter table public.room_messages_archive enable row level security;
revoke all on table public.room_messages_archive from public, anon, authenticated;
grant select, insert on table public.room_messages_archive to service_role;

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
    'archived_messages', archived_message_count,
    'deleted_messages', deleted_message_count
  );
end;
$$;

-- 备份按天统计改为现表 + 归档表合并，避免清理后当天记录凭空消失。
create or replace function public.admin_list_chat_backup_days()
returns table (
  backup_date date,
  message_count bigint,
  last_message_at timestamptz,
  downloaded_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with all_messages as (
    select created_at from public.room_messages
    union all
    select created_at from public.room_messages_archive
  ),
  days as (
    select
      (created_at at time zone 'Asia/Shanghai')::date as backup_date,
      count(*) as message_count,
      max(created_at) as last_message_at
    from all_messages
    group by (created_at at time zone 'Asia/Shanghai')::date
  )
  select
    days.backup_date,
    days.message_count,
    days.last_message_at,
    d.downloaded_at
  from days
  left join public.chat_backup_downloads as d
    on d.backup_date = days.backup_date
  order by days.backup_date desc;
$$;

revoke all on function public.admin_list_chat_backup_days() from public, anon, authenticated;
grant execute on function public.admin_list_chat_backup_days() to service_role;

revoke all on function public.admin_force_close_and_clear_room(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_force_close_and_clear_room(uuid)
  to service_role;

notify pgrst, 'reload schema';
