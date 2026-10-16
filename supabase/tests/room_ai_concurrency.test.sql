-- Run as postgres after the migration. Fixtures and all payment changes roll back.
begin;
create function pg_temp.ai_request(p_code text, p_token text, p_mode text, p_busy boolean default false)
returns bigint language plpgsql as $$
declare result jsonb;
begin
  perform set_config('role', 'anon', true);
  begin
    result := public.send_room_ai_request(p_code, 'Concurrency regression', p_token, p_mode, false);
  exception when others then
    perform set_config('role', 'postgres', true);
    if p_busy and sqlerrm = 'room_ai_busy' then return null; end if;
    raise;
  end;
  perform set_config('role', 'postgres', true);
  if p_busy then raise exception 'expected room_ai_busy for %', p_mode; end if;
  return (result->>'request_id')::bigint;
end $$;

create function pg_temp.clear_ai(p_room uuid) returns void language plpgsql as $$
declare q record;
begin
  for q in select request_message_id from public.room_ai_requests where room_id=p_room and status='pending' loop
    perform public.finish_room_ai_request(q.request_message_id, '', false);
    perform public.finish_room_ai_request(q.request_message_id, '', false);
  end loop;
  update public.room_messages set created_at=now()-interval '1 minute' where room_id=p_room;
end $$;

do $$
declare
  u uuid := gen_random_uuid();
  rid uuid := gen_random_uuid();
  code text := upper(substr(replace(rid::text,'-',''),1,6));
  seats uuid[] := array[]::uuid[];
  tokens text[] := array[]::text[];
  seat uuid;
  puzzle integer;
  i integer;
  mid bigint;
  reply jsonb;
  points_before integer;
  msg_before bigint;
  sid uuid := gen_random_uuid();
begin
  insert into auth.users(id,raw_user_meta_data) values(u,jsonb_build_object('username','t'||substr(replace(u::text,'-',''),1,7)));
  select id into puzzle from public.puzzles order by id limit 1;
  if puzzle is null then raise exception 'needs an existing puzzle'; end if;
  insert into public.rooms(id,code,name,owner_id,max_members,points_per_seat,reserved_points,current_puzzle_id)
    values(rid,code,'AI concurrency regression',u,8,0,0,puzzle);
  for i in 1..8 loop
    seat := gen_random_uuid();
    seats := array_append(seats,seat);
    tokens := array_append(tokens,rid::text||'-'||i);
    insert into public.room_seats(id,room_id,seat_number,nickname,remaining_points,hint_tokens,occupied_at)
      values(seat,rid,i,'Guest'||i,20,10,now());
    insert into public.guest_sessions(room_id,seat_id,token_hash,member_key)
      values(rid,seat,encode(extensions.digest(tokens[i],'sha256'),'hex'),'guest:'||seat::text);
  end loop;
  perform set_config('request.jwt.claims','{}',true);

  -- 3 members: total 2, ask 2, reason 1, even though configured capacity is 8.
  update public.room_seats set nickname=null where room_id=rid and seat_number>3;
  perform pg_temp.ai_request(code,tokens[1],'reason');
  perform pg_temp.ai_request(code,tokens[2],'reason',true);
  perform pg_temp.ai_request(code,tokens[2],'ask');
  perform pg_temp.ai_request(code,tokens[3],'hint',true);
  perform pg_temp.clear_ai(rid);
  perform pg_temp.ai_request(code,tokens[1],'ask');
  perform pg_temp.ai_request(code,tokens[2],'ask');
  perform pg_temp.ai_request(code,tokens[3],'ask',true);
  perform pg_temp.clear_ai(rid);

  -- 4 members: three asks and one reason coexist; fourth ask is rejected first.
  update public.room_seats set nickname='Guest4' where id=seats[4];
  perform pg_temp.ai_request(code,tokens[1],'ask');
  perform pg_temp.ai_request(code,tokens[2],'ask');
  perform pg_temp.ai_request(code,tokens[3],'ask');
  select remaining_points into points_before from public.room_seats where id=seats[4];
  select count(*) into msg_before from public.room_messages where room_id=rid;
  perform pg_temp.ai_request(code,tokens[4],'ask',true);
  if points_before<>(select remaining_points from public.room_seats where id=seats[4])
    or msg_before<>(select count(*) from public.room_messages where room_id=rid) then
    raise exception 'rejected request changed payment or messages';
  end if;
  perform pg_temp.ai_request(code,tokens[4],'reason');
  perform pg_temp.clear_ai(rid);

  -- 6 members: reason 2, hint 1, total 4 and one request per player all apply.
  update public.room_seats set nickname='Guest'||seat_number where room_id=rid and seat_number<=6;
  perform pg_temp.ai_request(code,tokens[1],'reason');
  perform pg_temp.ai_request(code,tokens[2],'reason');
  perform pg_temp.ai_request(code,tokens[3],'reason',true);
  perform pg_temp.ai_request(code,tokens[3],'hint');
  perform pg_temp.ai_request(code,tokens[4],'hint',true);
  perform pg_temp.ai_request(code,tokens[1],'ask',true);
  perform pg_temp.ai_request(code,tokens[4],'ask');
  perform pg_temp.ai_request(code,tokens[5],'ask',true);
  perform pg_temp.clear_ai(rid);

  -- 7 members: four asks and two reasons fill total 6; third reason alone is allowed.
  update public.room_seats set nickname='Guest7' where id=seats[7];
  for i in 1..4 loop perform pg_temp.ai_request(code,tokens[i],'ask'); end loop;
  perform pg_temp.ai_request(code,tokens[5],'ask',true);
  perform pg_temp.ai_request(code,tokens[5],'reason');
  perform pg_temp.ai_request(code,tokens[6],'reason');
  perform pg_temp.ai_request(code,tokens[7],'hint',true);
  perform pg_temp.clear_ai(rid);
  for i in 1..3 loop perform pg_temp.ai_request(code,tokens[i],'reason'); end loop;
  perform pg_temp.ai_request(code,tokens[4],'reason',true);
  -- Shrinking capacity does not cancel accepted requests, but blocks new admission.
  update public.room_seats set nickname=null where room_id=rid and seat_number>3;
  perform pg_temp.ai_request(code,tokens[1],'ask',true);
  perform pg_temp.clear_ai(rid);

  -- Expired leases refund before checking the next request's seat balance.
  update public.room_seats set remaining_points=1 where id=seats[1];
  mid := pg_temp.ai_request(code,tokens[1],'ask');
  update public.room_ai_requests set lease_expires_at=now()-interval '1 second' where request_message_id=mid;
  update public.room_messages set created_at=now()-interval '1 minute' where id=mid;
  perform pg_temp.ai_request(code,tokens[1],'ask');
  if (select remaining_points from public.room_seats where id=seats[1])<>0 then raise exception 'stale refund balance lost'; end if;
  perform pg_temp.clear_ai(rid);
  if (select remaining_points from public.room_seats where id=seats[1])<>1 then raise exception 'duplicate refund'; end if;

  -- Registered role and personal payment: same-player protection covers all modes.
  update public.room_seats set user_id=u,active_session_id=sid::text where id=seats[1];
  update public.profiles set points=20 where id=u;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',sid)::text,true);
  perform set_config('role','authenticated',true);
  reply := public.send_room_ai_request(code,'Registered test',null,'ask',true);
  perform set_config('role','postgres',true);
  mid := (reply->>'request_id')::bigint;
  if (select points from public.profiles where id=u)<>19 then raise exception 'personal charge'; end if;
  begin
    perform set_config('role','authenticated',true);
    perform public.send_room_ai_request(code,'Registered duplicate',null,'reason',true);
    raise exception 'duplicate allowed';
  exception when others then
    perform set_config('role','postgres',true);
    if sqlerrm<>'room_ai_busy' then raise; end if;
  end;
  perform public.finish_room_ai_request(mid,'',false);
  perform public.finish_room_ai_request(mid,'',false);
  if (select points from public.profiles where id=u)<>20 then raise exception 'personal refund'; end if;
  perform set_config('request.jwt.claims','{}',true);
  perform pg_temp.clear_ai(rid);

  -- Out-of-order completion retains reply_to_id; late results after a switch refund.
  update public.room_seats set user_id=null,remaining_points=20 where id=seats[1];
  mid := pg_temp.ai_request(code,tokens[1],'ask');
  i := pg_temp.ai_request(code,tokens[2],'ask');
  reply := public.finish_room_ai_request(i,'{"kind":"answer","text":"否"}',true);
  if (reply->>'reply_to_id')::bigint<>i then raise exception 'reply correlation'; end if;
  update public.rooms set current_puzzle_id=null where id=rid;
  reply := public.finish_room_ai_request(mid,'{"kind":"answer","text":"是"}',true);
  if reply is not null or (select status from public.room_ai_requests where request_message_id=mid)<>'refunded' then
    raise exception 'late result not refunded';
  end if;
end $$;
select 'passed: anon/authenticated admission, 3/4/6/7-member tiers, total/mode/player limits, charges, refunds, expiry, shrink, out-of-order and late completion' as result;
rollback;
