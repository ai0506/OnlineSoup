-- 聊天记录按日备份：记录每个自然日（Asia/Shanghai，00:00:00–23:59:59）是否已被管理员下载。

create table if not exists public.chat_backup_downloads (
  backup_date date primary key,
  downloaded_at timestamptz not null default now(),
  download_count integer not null default 1
);

-- 仅管理端服务角色经 SECURITY DEFINER 函数访问，前端不可直接读写。
alter table public.chat_backup_downloads enable row level security;

-- 列出有聊天记录的每一天及其消息数、最后消息时间和下载状态。
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
  select
    (m.created_at at time zone 'Asia/Shanghai')::date as backup_date,
    count(*) as message_count,
    max(m.created_at) as last_message_at,
    max(d.downloaded_at) as downloaded_at
  from public.room_messages as m
  left join public.chat_backup_downloads as d
    on d.backup_date = (m.created_at at time zone 'Asia/Shanghai')::date
  group by (m.created_at at time zone 'Asia/Shanghai')::date
  order by (m.created_at at time zone 'Asia/Shanghai')::date desc;
$$;

-- 标记某一天的聊天记录已被下载（重复下载会刷新时间并累加次数）。
create or replace function public.admin_mark_chat_backup_downloaded(p_backup_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_backup_downloads (backup_date, downloaded_at, download_count)
  values (p_backup_date, now(), 1)
  on conflict (backup_date)
  do update set
    downloaded_at = now(),
    download_count = public.chat_backup_downloads.download_count + 1;
end;
$$;

revoke all on function public.admin_list_chat_backup_days() from public;
revoke all on function public.admin_mark_chat_backup_downloaded(date) from public;
grant execute on function public.admin_list_chat_backup_days() to service_role;
grant execute on function public.admin_mark_chat_backup_downloaded(date) to service_role;

notify pgrst, 'reload schema';
