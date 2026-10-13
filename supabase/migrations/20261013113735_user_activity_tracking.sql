-- 注册用户最近活跃时间（进入房间或发送消息），仅供管理端读取。
-- 单独建表而不放在 profiles 上：profiles 在 Realtime 发布中，频繁写入会给在线玩家推送无意义的刷新。

create table if not exists public.user_activity (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_active_at timestamptz not null
);

alter table public.user_activity enable row level security;

revoke all on table public.user_activity from public, anon, authenticated;
grant select on table public.user_activity to service_role;

create or replace function public.touch_user_activity(p_user_id uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.user_activity (user_id, last_active_at)
  select p_user_id, p_at
  where exists (select 1 from public.profiles where id = p_user_id)
  on conflict (user_id) do update
    set last_active_at = excluded.last_active_at
    -- 5 分钟内的重复活跃不再写库，减少高频聊天时的写放大
    where public.user_activity.last_active_at < excluded.last_active_at - interval '5 minutes';
exception
  when others then
    -- 活跃记录只是辅助信息，任何异常都不能影响入座或发消息
    raise warning 'touch_user_activity failed: %', sqlerrm;
end;
$$;

revoke all on function public.touch_user_activity(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.track_seat_user_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.touch_user_activity(new.user_id, now());
  return new;
end;
$$;

revoke all on function public.track_seat_user_activity() from public, anon, authenticated;

create or replace function public.track_message_user_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sender_type = 'registered' and new.message_type <> 'system' then
    perform public.touch_user_activity(
      (select user_id from public.room_seats where id = new.seat_id),
      new.created_at
    );
  end if;
  return new;
end;
$$;

revoke all on function public.track_message_user_activity() from public, anon, authenticated;

drop trigger if exists room_seats_track_user_activity on public.room_seats;
create trigger room_seats_track_user_activity
  after insert or update of user_id on public.room_seats
  for each row
  when (new.user_id is not null)
  execute function public.track_seat_user_activity();

drop trigger if exists room_messages_track_user_activity on public.room_messages;
create trigger room_messages_track_user_activity
  after insert on public.room_messages
  for each row
  execute function public.track_message_user_activity();

-- 回填：当前入座、历史消息（按全局唯一的用户名匹配，座位可能已被他人复用）和玩家主动产生的积分流水
insert into public.user_activity (user_id, last_active_at)
select user_id, max(at)
from (
  select user_id, occupied_at as at
  from public.room_seats
  where user_id is not null and occupied_at is not null

  union all
  select p.id, m.created_at
  from public.room_messages m
  join public.profiles p on lower(p.username) = lower(m.sender_name)
  where m.sender_type = 'registered' and m.message_type <> 'system'

  union all
  select p.id, a.created_at
  from public.room_messages_archive a
  join public.profiles p on lower(p.username) = lower(a.sender_name)
  where a.sender_type = 'registered' and a.message_type <> 'system'

  union all
  select user_id, created_at
  from public.points_transactions
  where type in ('room_reservation', 'seat_query', 'gift_sent')
) activity
where user_id is not null
group by user_id
on conflict (user_id) do update
  set last_active_at = greatest(public.user_activity.last_active_at, excluded.last_active_at);

notify pgrst, 'reload schema';
