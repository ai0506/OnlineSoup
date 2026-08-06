-- 待清理房间的判定规则重做。
--
-- 旧规则有两个毛病：
-- 1) 以 rooms.updated_at 为基准，而强制清理本身就会把 updated_at 刷成 now()，
--    于是已经清空的房间会在阈值到期后反复重新上榜，形成无意义的清理循环。
-- 2) 不看消息数量，0 条消息的房间同样上榜，但清理它们没有任何意义。
--
-- 新规则：必须有消息才是候选（用 inner join 保证），且一律以「最后一条消息时间」为基准。
--   已关闭：最后消息早于 3 天前
--   未关闭：最后消息早于 7 天前
-- 同时新增 backup_pending，标记该房间是否还有消息未被当日聊天备份覆盖。

drop function if exists public.admin_list_room_cleanup_candidates();

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
        then 'closed_over_3_days'
      else 'abandoned_over_7_days'
    end as cleanup_reason,
    -- 只要还有一条消息所在的自然日没有被下载覆盖（或下载发生在该消息之前），
    -- 就认为这个房间的聊天记录尚未完整备份。
    bool_or(
      not exists (
        select 1
        from public.chat_backup_downloads as d
        where d.backup_date
                = (room_messages.created_at at time zone 'Asia/Shanghai')::date
          and d.downloaded_at >= room_messages.created_at
      )
    ) as backup_pending
  from public.rooms
  join public.room_messages
    on room_messages.room_id = rooms.id
  group by rooms.id
  having (
    rooms.status = 'closed'
    and max(room_messages.created_at) < now() - interval '3 days'
  ) or (
    rooms.status <> 'closed'
    and max(room_messages.created_at) < now() - interval '7 days'
  )
  order by
    case when rooms.status = 'closed' then 0 else 1 end,
    max(room_messages.created_at) asc,
    rooms.created_at asc;
$$;

revoke all on function public.admin_list_room_cleanup_candidates()
  from public, anon, authenticated;
grant execute on function public.admin_list_room_cleanup_candidates()
  to service_role;

notify pgrst, 'reload schema';
