-- Renaming a registered player does not replace their membership or payment lease.
create or replace function soup_cli.seat_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is distinct from new.user_id
     or (new.user_id is null and old.nickname is distinct from new.nickname) then
    new.membership_id := gen_random_uuid();
    new.last_cli_action_at := null;
    if new.user_id is not null then
      delete from public.guest_removals where room_id=new.room_id
        and member_key='user:'||new.user_id::text and reason='idle_timeout';
    end if;
  end if;
  return new;
end $$;
revoke all on function soup_cli.seat_generation() from public,anon,authenticated;

create or replace function soup_cli.settle_seat_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  if old.user_id is distinct from new.user_id
     or (new.user_id is null and old.nickname is distinct from new.nickname) then
    for q in select request_message_id from public.room_ai_requests where seat_id=old.id and status='pending' loop
      perform public.finish_room_ai_request(q.request_message_id,'',false);
    end loop;
  end if;
  return new;
end $$;
revoke all on function soup_cli.settle_seat_change() from public,anon,authenticated;

-- Profile locks must follow the same gate as room/seat/payment locks.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.admin_set_username(uuid,text)'::regprocedure) into definition;
  if position('perform soup_cli.lock_transaction();' in definition)=0 then
    definition := regexp_replace(definition, E'\\mbegin\\M', E'begin\n  perform soup_cli.lock_transaction();', 'i');
    execute definition;
  end if;
end $$;
revoke all on function public.admin_set_username(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_set_username(uuid,text) to service_role;
notify pgrst, 'reload schema';
