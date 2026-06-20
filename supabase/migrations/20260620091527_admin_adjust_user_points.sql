-- 新增 admin_adjustment 积分流水类型
alter type public.points_transaction_type add value if not exists 'admin_adjustment';

-- 为 points_transactions 补充 note 字段，用于记录管理员备注
alter table public.points_transactions
  add column if not exists note text;

-- 管理员调整用户积分 RPC（只允许 service_role 调用）
create or replace function public.admin_adjust_user_points(
  p_user_id uuid,
  p_amount  integer,   -- 正数为赠送，负数为扣除
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current  integer;
  v_new      integer;
begin
  if p_amount = 0 then
    raise exception 'amount must not be zero';
  end if;

  select points into v_current
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'user not found';
  end if;

  v_new := v_current + p_amount;

  if v_new < 0 then
    raise exception 'insufficient points: current %, adjustment %', v_current, p_amount;
  end if;

  update public.profiles
  set points = v_new, updated_at = now()
  where id = p_user_id;

  insert into public.points_transactions (user_id, room_id, type, amount, balance_after, note)
  values (p_user_id, null, 'admin_adjustment', p_amount, v_new, p_note);
end;
$$;

revoke all on function public.admin_adjust_user_points(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.admin_adjust_user_points(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';
