-- 用户反馈：仅注册用户可提交，每账号每天（Asia/Shanghai 自然日）最多 3 条。

create table if not exists public.user_feedback (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null
    check (category in ('bug', 'ai', 'suggestion', 'puzzle', 'other')),
  content text not null check (char_length(content) between 1 and 2000),
  status text not null default 'open'
    check (status in ('open', 'handled', 'ignored')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  display_name text not null default '' check (char_length(display_name) <= 40),
  page_path text not null default '' check (char_length(page_path) <= 200),
  device_label text not null default '' check (char_length(device_label) <= 60),
  location_label text not null default '' check (char_length(location_label) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_feedback_created_idx
  on public.user_feedback (created_at desc);

create index if not exists user_feedback_status_idx
  on public.user_feedback (status);

-- 每日限流按 (user_id, created_at) 统计
create index if not exists user_feedback_user_created_idx
  on public.user_feedback (user_id, created_at desc);

alter table public.user_feedback enable row level security;

revoke all on table public.user_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.user_feedback to service_role;

-- 提交反馈：校验、限流和写入在同一事务内完成
create or replace function public.submit_user_feedback(
  p_category text,
  p_content text,
  p_page_path text default '',
  p_device_label text default '',
  p_location_label text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text;
  v_day_start timestamptz;
  v_today_count integer;
  v_content text := btrim(coalesce(p_content, ''));
  v_feedback_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_category is null
    or p_category not in ('bug', 'ai', 'suggestion', 'puzzle', 'other')
  then
    raise exception 'invalid_category';
  end if;

  if char_length(v_content) < 1 or char_length(v_content) > 2000 then
    raise exception 'invalid_content';
  end if;

  -- 同一账号串行处理，避免连点两次绕过每日额度
  perform pg_advisory_xact_lock(hashtext('user_feedback:' || v_user_id::text));

  v_day_start :=
    date_trunc('day', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';

  select count(*)
  into v_today_count
  from public.user_feedback
  where user_id = v_user_id
    and created_at >= v_day_start;

  if v_today_count >= 3 then
    raise exception 'feedback_rate_limited';
  end if;

  select username into v_username
  from public.profiles
  where id = v_user_id;

  insert into public.user_feedback (
    user_id,
    category,
    content,
    display_name,
    page_path,
    device_label,
    location_label
  )
  values (
    v_user_id,
    p_category,
    v_content,
    left(coalesce(v_username, ''), 40),
    left(coalesce(btrim(p_page_path), ''), 200),
    left(coalesce(btrim(p_device_label), ''), 60),
    left(coalesce(btrim(p_location_label), ''), 60)
  )
  returning id into v_feedback_id;

  return v_feedback_id;
end;
$$;

revoke all on function public.submit_user_feedback(text, text, text, text, text)
  from public, anon;
grant execute on function public.submit_user_feedback(text, text, text, text, text)
  to authenticated, service_role;

-- 管理端状态流转与内部备注
create or replace function public.admin_update_feedback(
  p_feedback_id uuid,
  p_status text,
  p_admin_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := left(coalesce(btrim(p_admin_note), ''), 1000);
begin
  if p_status is null or p_status not in ('open', 'handled', 'ignored') then
    raise exception 'invalid_status';
  end if;

  update public.user_feedback
  set status = p_status,
      admin_note = v_note,
      updated_at = now()
  where id = p_feedback_id;

  if not found then
    raise exception 'feedback_not_found';
  end if;
end;
$$;

revoke all on function public.admin_update_feedback(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_feedback(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
