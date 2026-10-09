-- P1 uses top-level xid8 plus a snapshot-xmin visibility fence. A low-ID
-- transaction cannot be skipped when it commits after a higher-ID transaction.
-- Existing rows are already committed: constant 0 avoids a volatile backfill.
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.room_messages add column cli_ingest_xid xid8 not null default '0';
alter table public.room_messages alter column cli_ingest_xid set default pg_current_xact_id();
create index room_messages_cli_feed on public.room_messages(room_id,cli_ingest_xid,id);
alter table public.rooms add column cli_history_epoch uuid not null default gen_random_uuid();

create function soup_cli.stamp_message() returns trigger language plpgsql security definer set search_path='' as $$
begin new.cli_ingest_xid:=pg_current_xact_id(); return new; end $$;
revoke all on function soup_cli.stamp_message() from public,anon,authenticated;
create trigger cli_stamp_message before insert on public.room_messages for each row execute function soup_cli.stamp_message();

-- Invalidate once per affected room/statement, including archive cleanup and
-- edits. Never silently continue a cursor over removed or replaced history.
create function soup_cli.invalidate_deleted_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.rooms set cli_history_epoch=gen_random_uuid() where id in (select room_id from deleted_messages);
  return null;
end $$;
create function soup_cli.invalidate_updated_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.rooms set cli_history_epoch=gen_random_uuid() where id in (
    select o.room_id from old_messages o join new_messages n using(id) where to_jsonb(o) is distinct from to_jsonb(n)
    union select n.room_id from old_messages o join new_messages n using(id) where to_jsonb(o) is distinct from to_jsonb(n));
  return null;
end $$;
create function soup_cli.invalidate_truncated_history() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.rooms set cli_history_epoch=gen_random_uuid(); return null; end $$;
revoke all on function soup_cli.invalidate_deleted_history(),soup_cli.invalidate_updated_history(),soup_cli.invalidate_truncated_history() from public,anon,authenticated;
create trigger cli_deleted_history after delete on public.room_messages referencing old table as deleted_messages for each statement execute function soup_cli.invalidate_deleted_history();
create trigger cli_updated_history after update on public.room_messages referencing old table as old_messages new table as new_messages for each statement execute function soup_cli.invalidate_updated_history();
create trigger cli_truncated_history after truncate on public.room_messages for each statement execute function soup_cli.invalidate_truncated_history();

-- Pure reads use the calling statement snapshot, without the P0 write gate or
-- seat FOR UPDATE. They do not refresh idle time or reconcile payment leases.
create function soup_cli.read_member(p_code text) returns uuid language plpgsql stable security definer set search_path='' as $$
declare r public.rooms%rowtype; s public.room_seats%rowtype;
begin
  perform public.player_session();
  select * into r from public.rooms where code=p_code;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.owner_id=auth.uid() then raise exception 'OWNER_NOT_SUPPORTED'; end if;
  if r.status='closed' then raise exception 'ROOM_CLOSED'; end if;
  if exists(select 1 from public.guest_removals where room_id=r.id and member_key='user:'||auth.uid()::text and reason='kicked') then raise exception 'KICKED'; end if;
  select * into s from public.room_seats where room_id=r.id and user_id=auth.uid();
  if not found then
    if exists(select 1 from public.guest_removals where room_id=r.id and member_key='user:'||auth.uid()::text and reason='idle_timeout') then raise exception 'IDLE_TIMEOUT'; end if;
    raise exception 'ROOM_MEMBERSHIP_REQUIRED';
  end if;
  if s.active_session_id is distinct from (auth.jwt()->>'session_id') then raise exception 'ROOM_DEVICE_IN_USE'; end if;
  return s.id;
end $$;
revoke all on function soup_cli.read_member(text) from public,anon,authenticated;

create function public.player_snapshot(p_room_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s uuid; r public.rooms%rowtype; puzzle jsonb;
begin
  s:=soup_cli.read_member(p_room_code);
  select * into r from public.rooms where code=p_room_code;
  select jsonb_build_object('id',p.id,'title',p.title,'surface',p.surface,'difficulty',p.difficulty,
    'solved',coalesce((select solved from public.puzzle_progress where room_id=r.id and puzzle_id=p.id),false))
    into puzzle from public.puzzles p where p.id=r.current_puzzle_id;
  return jsonb_build_object('room',jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'status',r.status,
    'max_members',r.max_members,'points_per_seat',r.points_per_seat,'is_owner',false),
    'seat_id',s,'current_puzzle_id',r.current_puzzle_id,'puzzle',puzzle,
    'seats',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'seat_number',seat_number,'nickname',nickname,
      'remaining_points',remaining_points,'hint_tokens',hint_tokens,'is_current_user',id=s) order by seat_number),'[]'::jsonb) from public.room_seats where room_id=r.id),
    'personal_points',(select points from public.profiles where id=auth.uid()));
end $$;
revoke all on function public.player_snapshot(text) from public,anon,authenticated;
grant execute on function public.player_snapshot(text) to authenticated;

create function soup_cli.sign_cursor(p_value jsonb) returns text language sql stable security definer set search_path='' as $$
  select encode(convert_to(p_value::text,'UTF8'),'hex')||'.'||encode(extensions.hmac(convert_to(p_value::text,'UTF8'),secret,'sha256'),'hex') from soup_cli.hash_secret
$$;
create function soup_cli.parse_cursor(p_token text,p_room uuid,p_epoch uuid,p_direction text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare value jsonb; raw bytea;
begin
  if length(p_token)>4096 or p_token !~ '^[0-9a-f]+\.[0-9a-f]{64}$' then raise exception 'INVALID_CURSOR'; end if;
  raw:=decode(split_part(p_token,'.',1),'hex');
  if split_part(p_token,'.',2)<>(select encode(extensions.hmac(raw,secret,'sha256'),'hex') from soup_cli.hash_secret) then raise exception 'INVALID_CURSOR'; end if;
  value:=convert_from(raw,'UTF8')::jsonb;
  if value->>'v'<>'1' or value->>'r'<>p_room::text or value->>'u'<>auth.uid()::text or value->>'d'<>p_direction then raise exception 'INVALID_CURSOR'; end if;
  if value->>'e'<>p_epoch::text then raise exception 'CURSOR_EXPIRED'; end if;
  return value;
exception when invalid_text_representation or character_not_in_repertoire or invalid_parameter_value then raise exception 'INVALID_CURSOR';
end $$;
revoke all on function soup_cli.sign_cursor(jsonb),soup_cli.parse_cursor(text,uuid,uuid,text) from public,anon,authenticated;

create function public.player_messages(p_room_code text,p_after text default null,p_before text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s uuid; r public.rooms%rowtype; c jsonb; base jsonb; fence xid8:=pg_snapshot_xmin(pg_current_snapshot());
  pos_x xid8:='0'; pos_id bigint:=0; first_x xid8; first_id bigint; last_x xid8; last_id bigint;
  batch jsonb:='[]'; item record; more boolean:=false; previous text; next_token text; n integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>100 or (p_after is not null and p_before is not null) then raise exception 'INVALID_INPUT'; end if;
  s:=soup_cli.read_member(p_room_code);
  select * into r from public.rooms where code=p_room_code;
  base:=jsonb_build_object('v',1,'r',r.id,'u',auth.uid(),'e',r.cli_history_epoch);
  if p_after is not null or p_before is not null then
    c:=soup_cli.parse_cursor(coalesce(p_after,p_before),r.id,r.cli_history_epoch,case when p_after is not null then 'after' else 'before' end);
    pos_x:=(c->>'x')::xid8;pos_id:=(c->>'i')::bigint;
    if c->>'h' is not null then fence:=least(fence,(c->>'h')::xid8); end if;
  end if;
  for item in
    select m.id,m.cli_ingest_xid,
      jsonb_build_object('id',m.id::text,'room_id',m.room_id,'seat_id',m.seat_id,'sender_name',m.sender_name,
        'sender_seat_number',m.sender_seat_number,'sender_type',m.sender_type,'message_type',m.message_type,
        'message_mode',m.message_mode,'content',public.player_safe_room_message_content(m.content,m.message_type::text),
        'puzzle_id',m.puzzle_id,'reply_to_id',m.reply_to_id::text,'created_at',m.created_at) as safe_message
    from public.room_messages m where m.room_id=r.id and m.cli_ingest_xid<fence
      and (p_after is null or (m.cli_ingest_xid,m.id)>(pos_x,pos_id))
      and (p_before is null or (m.cli_ingest_xid,m.id)<(pos_x,pos_id))
    order by
      case when p_after is not null then m.cli_ingest_xid end asc,
      case when p_after is not null then m.id end asc,
      m.cli_ingest_xid desc,m.id desc
    limit p_limit+1
  loop
    n:=n+1;if n>p_limit then more:=true;exit;end if;
    if p_after is not null then
      batch:=batch||jsonb_build_array(item.safe_message);
      if first_x is null then first_x:=item.cli_ingest_xid;first_id:=item.id;end if;
      last_x:=item.cli_ingest_xid;last_id:=item.id;
    else
      batch:=jsonb_build_array(item.safe_message)||batch;
      if last_x is null then last_x:=item.cli_ingest_xid;last_id:=item.id;end if;
      first_x:=item.cli_ingest_xid;first_id:=item.id;
    end if;
  end loop;
  if first_x is not null and exists(select 1 from public.room_messages where room_id=r.id and cli_ingest_xid<fence and (cli_ingest_xid,id)<(first_x,first_id)) then
    previous:=soup_cli.sign_cursor(base||jsonb_build_object('d','before','x',first_x::text,'i',first_id::text,'h',fence::text));
  end if;
  if (p_after is not null and more) or p_before is not null then
    next_token:=soup_cli.sign_cursor(base||jsonb_build_object('d','after','x',coalesce(last_x,pos_x)::text,'i',coalesce(last_id,pos_id)::text,'h',fence::text));
  else
    next_token:=soup_cli.sign_cursor(base||jsonb_build_object('d','after','x',fence::text,'i','0','h',null));
  end if;
  return jsonb_build_object('messages',batch,'next_cursor',next_token,'previous_cursor',previous,
    'has_more',case when p_after is null and p_before is null then false else more end,
    'history_scope','retained_history','visibility_delayed',exists(select 1 from public.room_messages where room_id=r.id and cli_ingest_xid>=fence));
end $$;
revoke all on function public.player_messages(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.player_messages(text,text,text,integer) to authenticated;

create function public.player_facts(p_room_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.rooms%rowtype; facts jsonb;
begin
  perform soup_cli.read_member(p_room_code);
  select * into r from public.rooms where code=p_room_code;
  select coalesce(jsonb_agg(jsonb_build_object('text',f.fact,'source',f.source,'message_id',f.id::text) order by f.id),'[]'::jsonb)
    into facts from (
      select distinct on (btrim(body->>'fact_summary')) btrim(body->>'fact_summary') fact,
        case when body->>'kind'='hint' then 'hint' else 'ask' end source,id
      from (
        select id,soup_cli.fact_body(content) body from public.room_messages
        where room_id=r.id and puzzle_id=r.current_puzzle_id and message_type='ai'
      ) parsed where body->>'kind' in ('answer','hint') and jsonb_typeof(body->'fact_summary')='string' and btrim(body->>'fact_summary')<>''
      order by btrim(body->>'fact_summary'),id
    ) f;
  return jsonb_build_object('current_puzzle_id',r.current_puzzle_id,'facts',facts);
end $$;
create function soup_cli.fact_body(p_content text) returns jsonb language plpgsql immutable set search_path='' as $$
begin return p_content::jsonb; exception when invalid_text_representation then return null; end $$;
revoke all on function soup_cli.fact_body(text) from public,anon,authenticated;
revoke all on function public.player_facts(text) from public,anon,authenticated;
grant execute on function public.player_facts(text) to authenticated;
notify pgrst, 'reload schema';
