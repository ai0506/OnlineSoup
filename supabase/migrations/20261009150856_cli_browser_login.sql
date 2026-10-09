set local lock_timeout='3s';
set local statement_timeout='30s';
create table soup_cli.browser_logins (
  id uuid primary key,
  secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
  challenge text not null check(challenge ~ '^[a-f0-9]{64}$'),
  code_hash text not null check(code_hash ~ '^[a-f0-9]{64}$'),
  expected_user_id uuid,
  user_id uuid references auth.users on delete cascade,
  web_session_id uuid,
  status text not null default 'pending' check(status in ('pending','approved','issuing','ready','denied','expired','failed','consumed')),
  attempts integer not null default 0,
  claim_id uuid,
  claimed_at timestamptz,
  ciphertext text,
  expires_at timestamptz not null default now()+interval '5 minutes'
);
alter table soup_cli.browser_logins enable row level security;
revoke all on soup_cli.browser_logins from public,anon,authenticated,service_role;
create index browser_logins_expiry on soup_cli.browser_logins(expires_at);

-- Only the server can create/poll/redeem a grant. No credential-bearing table is exposed.
create function public.player_browser_auth(p_action text,p_id uuid,p_secret_hash text default null,p_challenge text default null,p_code_hash text default null,p_expected_user_id uuid default null,p_claim_id uuid default null,p_ciphertext text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r soup_cli.browser_logins%rowtype;
begin
  if p_action='start' then
    delete from soup_cli.browser_logins where expires_at<now();
    insert into soup_cli.browser_logins(id,secret_hash,challenge,code_hash,expected_user_id) values(p_id,p_secret_hash,p_challenge,p_code_hash,p_expected_user_id);
    return jsonb_build_object('id',p_id,'expires_in',300,'interval',3);
  end if;
  select * into r from soup_cli.browser_logins where id=p_id for update;
  if not found then return jsonb_build_object('status','expired'); end if;
  if p_action='view' then
    return jsonb_build_object('status',case when r.expires_at<=now() then 'expired' else r.status end);
  end if;
  if r.secret_hash is distinct from p_secret_hash or r.challenge is distinct from p_challenge then raise exception 'INVALID_BROWSER_GRANT'; end if;
  if r.expires_at<=now() then
    update soup_cli.browser_logins set status='expired',ciphertext=null where id=p_id;
    return jsonb_build_object('status','expired');
  end if;
  if p_action='ack' then
    if r.status='ready' then update soup_cli.browser_logins set status='consumed',ciphertext=null where id=p_id; end if;
    return jsonb_build_object('status',case when r.status='ready' then 'consumed' else r.status end);
  end if;
  if p_action='complete' then
    if r.status<>'issuing' or r.claim_id is distinct from p_claim_id or p_ciphertext is null or length(p_ciphertext)>24000
       or not exists(select 1 from auth.sessions where id=r.web_session_id and user_id=r.user_id) then raise exception 'INVALID_BROWSER_GRANT'; end if;
    update soup_cli.browser_logins set status='ready',ciphertext=p_ciphertext where id=p_id;
    return jsonb_build_object('status','ready');
  end if;
  if p_action<>'poll' then raise exception 'INVALID_INPUT'; end if;
  if r.status='approved' then
    if not exists(select 1 from auth.sessions where id=r.web_session_id and user_id=r.user_id) then
      update soup_cli.browser_logins set status='expired' where id=p_id; return jsonb_build_object('status','expired');
    end if;
    update soup_cli.browser_logins set status='issuing',claim_id=p_claim_id,claimed_at=now() where id=p_id;
    return jsonb_build_object('status','issue','user_id',r.user_id);
  end if;
  if r.status='issuing' and r.claimed_at<now()-interval '60 seconds' then
    update soup_cli.browser_logins set status='failed' where id=p_id; return jsonb_build_object('status','failed');
  end if;
  return jsonb_build_object('status',r.status,'ciphertext',case when r.status='ready' then r.ciphertext else null end);
end $$;
revoke all on function public.player_browser_auth(text,uuid,text,text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.player_browser_auth(text,uuid,text,text,text,uuid,uuid,text) to service_role;

create function public.approve_cli_browser_login(p_id uuid,p_code text,p_approve boolean,p_expected_web_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r soup_cli.browser_logins%rowtype;
begin
  perform soup_cli.require_web_session();
  if auth.uid() is distinct from p_expected_web_user then return jsonb_build_object('status','account_changed'); end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and username is not null) then raise exception 'USERNAME_REQUIRED'; end if;
  select * into r from soup_cli.browser_logins where id=p_id for update;
  if not found or r.expires_at<=now() then return jsonb_build_object('status','expired'); end if;
  if r.status<>'pending' then return jsonb_build_object('status',r.status); end if;
  if not p_approve then update soup_cli.browser_logins set status='denied' where id=p_id; return jsonb_build_object('status','denied'); end if;
  if r.expected_user_id is not null and r.expected_user_id<>auth.uid() then return jsonb_build_object('status','wrong_account'); end if;
  if p_code is null or r.code_hash<>encode(extensions.digest(upper(replace(btrim(p_code),'-','')),'sha256'),'hex') then
    update soup_cli.browser_logins set attempts=attempts+1,status=case when attempts>=4 then 'denied' else status end where id=p_id;
    return jsonb_build_object('status',case when r.attempts>=4 then 'denied' else 'wrong_code' end);
  end if;
  update soup_cli.browser_logins set status='approved',user_id=auth.uid(),web_session_id=(auth.jwt()->>'session_id')::uuid where id=p_id;
  return jsonb_build_object('status','approved');
end $$;
revoke all on function public.approve_cli_browser_login(uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.approve_cli_browser_login(uuid,text,boolean,uuid) to authenticated;
notify pgrst, 'reload schema';
