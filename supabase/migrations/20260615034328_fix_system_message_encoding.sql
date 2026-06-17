create or replace function public.record_room_seat_system_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_reason text;
  player_name text;
  player_seat_number integer;
  player_type text;
  system_content text;
begin
  if tg_op = 'INSERT' then
    if new.nickname is null then
      return new;
    end if;

    player_name := new.nickname;
    player_seat_number := new.seat_number;
    player_type := case when new.user_id is null then 'guest' else 'registered' end;
    system_content := 'member_joined';
  elsif old.nickname is null and new.nickname is not null then
    player_name := new.nickname;
    player_seat_number := new.seat_number;
    player_type := case when new.user_id is null then 'guest' else 'registered' end;
    system_content := 'member_joined';
  elsif old.nickname is not null and new.nickname is null then
    event_reason := current_setting('app.room_exit_reason', true);
    player_name := old.nickname;
    player_seat_number := old.seat_number;
    player_type := case when old.user_id is null then 'guest' else 'registered' end;
    system_content := case
      when event_reason = 'kicked' then 'member_kicked'
      else 'member_left'
    end;
  else
    return new;
  end if;

  insert into public.room_messages (
    room_id,
    seat_id,
    sender_name,
    sender_seat_number,
    sender_type,
    message_type,
    content
  )
  values (
    new.room_id,
    new.id,
    player_name,
    player_seat_number,
    player_type,
    'system',
    system_content
  );

  return new;
end;
$$;

revoke all on function public.record_room_seat_system_message()
  from public, anon, authenticated;

with broken_messages as (
  select
    room_messages.id,
    room_messages.room_id,
    room_messages.seat_id,
    room_messages.sender_name,
    room_messages.content,
    exists (
      select 1
      from public.room_messages later_message
      where later_message.room_id = room_messages.room_id
        and later_message.sender_name = room_messages.sender_name
        and later_message.message_type = 'system'
        and later_message.id > room_messages.id
    ) as has_later_system_message,
    exists (
      select 1
      from public.room_seats
      where room_seats.id = room_messages.seat_id
        and room_seats.nickname = room_messages.sender_name
    ) as is_still_seated
  from public.room_messages
  where room_messages.message_type = 'system'
    and room_messages.content ~ '^[^?]*[?]+$'
)
update public.room_messages
set content = case
  when length(regexp_replace(broken_messages.content, '[^?]', '', 'g')) >= 8
    then 'member_kicked'
  when broken_messages.has_later_system_message
    or broken_messages.is_still_seated
    then 'member_joined'
  else 'member_left'
end
from broken_messages
where room_messages.id = broken_messages.id;

notify pgrst, 'reload schema';
