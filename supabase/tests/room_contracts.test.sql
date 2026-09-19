begin;

select plan(7);

select has_table('public', 'room_ai_requests', 'AI request ledger exists');
select has_column('public', 'room_ai_requests', 'lease_expires_at', 'AI requests have a lease');
select has_function('public', 'reconcile_stale_room_ai_requests', array['uuid'], 'Stale AI reconciler exists');
select has_function('public', 'get_room_member_state', array['text', 'text'], 'Protected room-state RPC exists');
select has_function('public', 'get_room_join_info', array['text'], 'Minimal join-info RPC exists');
select function_privs_are(
  'public', 'send_room_ai_request', array['text', 'text', 'text', 'text', 'boolean'],
  'authenticated', array['EXECUTE'], 'Authenticated users retain AI RPC access'
);
select function_privs_are(
  'public', 'send_room_ai_request', array['text', 'text', 'text', 'text', 'boolean'],
  'anon', array['EXECUTE'], 'Guests retain AI RPC access through their cookie token'
);

select * from finish();
rollback;
