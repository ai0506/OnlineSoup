-- Add room_refund and gift_sent transaction types
alter type public.points_transaction_type
  add value if not exists 'room_refund';

alter type public.points_transaction_type
  add value if not exists 'gift_sent';

-- Rewrite close_room to refund remaining seat points to owner
create or replace function public.close_room(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.rooms%rowtype;
  refund_total integer;
  current_points integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required';
  end if;

  select *
  into target_room
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
    raise exception 'room_already_closed';
  end if;

  -- Sum all remaining seat points
  select coalesce(sum(remaining_points), 0)
  into refund_total
  from public.room_seats
  where room_id = target_room.id;

  if refund_total > 0 then
    select points
    into current_points
    from public.profiles
    where id = current_user_id
    for update;

    update public.profiles
    set points = points + refund_total,
        updated_at = now()
    where id = current_user_id;

    insert into public.points_transactions (
      user_id,
      room_id,
      type,
      amount,
      balance_after
    )
    values (
      current_user_id,
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
end;
$$;

revoke all on function public.close_room(text) from public, anon, authenticated;
grant execute on function public.close_room(text) to authenticated;

notify pgrst, 'reload schema';
