// Run with: node --env-file=.env.local scripts/check-room-ai-concurrency.mjs /private/fixture.json
// Uses an isolated SQL-runner fixture and public RPCs; the runner removes fixtures.
// Exercises real admission/payment/settlement; does not call a paid model.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
assert(url && key && secret, "Missing Supabase environment configuration");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const player = createClient(url, key, options);
if (process.argv[2] === "--prepare") {
  const rid = randomUUID();
  const uid = randomUUID();
  const code = rid.replaceAll("-", "").slice(0, 6).toUpperCase();
  const guests = Array.from({ length: 6 }, (_, index) => ({ id: randomUUID(), token: randomUUID(), number: index + 1 }));
  const path = join(mkdtempSync(join(tmpdir(), "soup-concurrency-")), "fixture.json");
  writeFileSync(path, JSON.stringify({ rid, uid, code, guests }), { mode: 0o600 });
  const setupSql = `begin;
insert into auth.users(id,raw_user_meta_data) values('${uid}','{"username":"t${uid.slice(0, 7)}"}');
insert into public.rooms(id,code,name,owner_id,max_members,points_per_seat,reserved_points,current_puzzle_id)
select '${rid}','${code}','Concurrency integration test','${uid}',6,0,0,id from public.puzzles order by id limit 1;
${guests.map((g) => `insert into public.room_seats(id,room_id,seat_number,nickname,remaining_points,hint_tokens,occupied_at)
values('${g.id}','${rid}',${g.number},'Guest${g.number}',20,10,now());
insert into public.guest_sessions(room_id,seat_id,token_hash,member_key)
values('${rid}','${g.id}','${createHash("sha256").update(g.token).digest("hex")}','guest:${g.id}');`).join("\n")}
commit;`;
  const cleanupSql = `begin;
select public.admin_cleanup_user_before_delete('${uid}');
delete from auth.users where id='${uid}';
commit;
select count(*) as remaining_fixture_rooms from public.rooms where id='${rid}';`;
  // Contains only token hashes, never raw guest tokens or application keys.
  console.log(JSON.stringify({ path, setupSql, cleanupSql }));
  process.exit(0);
}
// Fixtures are inserted by a privileged SQL runner; service_role has no direct seat access.
const fixturePath = process.argv[2];
assert(fixturePath, "Pass the private fixture JSON path (prepared by the SQL test runner)");
const { code, guests } = JSON.parse(readFileSync(fixturePath, "utf8"));
const activeIds = new Set();
function checked({ data, error }) {
  if (error) throw new Error(`${error.code ?? "DB"}: ${error.message}`);
  return data;
}
async function send(guest, mode = "ask") {
  const result = await player.rpc("send_room_ai_request", {
    room_code: code, message_content: "Concurrency integration test",
    guest_token: guest.token, message_mode: mode, use_personal_points: false,
  });
  if (!result.error) activeIds.add(result.data.request_id);
  return result;
}
function checkResults(results, accepted) {
  assert.equal(results.filter((r) => !r.error).length, accepted);
  for (const r of results.filter((r) => r.error)) assert.match(r.error.message, /room_ai_busy/);
}
async function settle(checkBalance = true) {
  for (const id of activeIds) checked(await admin.rpc("finish_room_ai_request", {
    request_message_id: id, ai_content: "", is_success: false,
  }));
  activeIds.clear();
  if (checkBalance) {
    const state = checked(await player.rpc("get_room_member_state", { p_room_code: code, p_guest_token: guests[0].token }));
    for (const seat of state.seats) {
      assert.equal(seat.remaining_points, 20);
      assert.equal(seat.hint_tokens, 10);
    }
    await new Promise((resolve) => setTimeout(resolve, 3100));
  }
}

try {
  checkResults(await Promise.all(guests.map((g) => send(g))), 3);
  await settle();
  checkResults(await Promise.all(guests.map((g, i) => send(g, i < 3 ? "ask" : "reason"))), 4);
  await settle();
  checkResults(await Promise.all(["ask", "reason", "hint"].map((mode) => send(guests[0], mode))), 1);
  await settle();
  checkResults(await Promise.all(guests.map((g) => send(g, "reason"))), 2);
  await settle();
  checkResults(await Promise.all(guests.map((g) => send(g, "hint"))), 1);
  await settle();

  const first = checked(await send(guests[0]));
  const second = checked(await send(guests[1]));
  for (const request of [second, first]) {
    const reply = checked(await admin.rpc("finish_room_ai_request", { request_message_id: request.request_id,
      ai_content: '{"kind":"answer","text":"否","ask_audit":{"private":true}}', is_success: true }));
    assert.equal(reply.reply_to_id, request.request_id);
    activeIds.delete(request.request_id);
  }
  const bootstrap = checked(await player.rpc("get_room_chat_bootstrap", { room_code: code, guest_token: guests[0].token }));
  for (const request of [first, second]) {
    const reply = bootstrap.messages.find((m) => m.reply_to_id === request.request_id);
    assert(reply, "Public bootstrap must retain reply association");
    assert(!reply.content.includes("ask_audit"), "Audit leaked to player");
  }
  console.log("PASS: public-key parallel admission (ask/total/player/reason/hint), exact refunds, out-of-order settlement, protected bootstrap and redaction");
} finally {
  await settle(false);
}
