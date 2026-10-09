import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession } from '../dist/cli/src/session.js';
import { closeConnections } from '../dist/cli/src/api-client.js';
import { checkpoint, messagePage, stateFingerprint, waitForChanges } from '../dist/cli/src/sync.js';
import { withMessageCheck } from '../dist/cli/src/message-notice.js';
import { textOutput } from '../dist/cli/src/output.js';

after(closeConnections);
const ok = data => ({ api_version: 1, ok: true, data, error: null });
const page = (id, cursor, more = false) => ({ messages: id ? [{ id, sender_name: '网页玩家', content: '中文 ✓' }] : [], next_cursor: cursor, previous_cursor: 'older', has_more: more });
async function fixture(handler, run) {
  const server = createServer(async (req, res) => {
    const result = await handler(req);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const home = await mkdtemp(join(tmpdir(), 'soup-sync-'));
  const prior = process.env.ONLINESOUP_HOME; process.env.ONLINESOUP_HOME = home;
  let session = await openSession(`http://127.0.0.1:${server.address().port}`);
  session.state.user_id = 'fixture-user';
  try { await run(session, home, async () => { await session.close(); session = await openSession(session.state.origin); return session; }); }
  finally {
    await session.close(); server.closeAllConnections(); server.close();
    if (prior === undefined) delete process.env.ONLINESOUP_HOME; else process.env.ONLINESOUP_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
}

test('cursor and Unicode bodies persist together across restart; history and failures preserve checkpoint', async () => {
  const paths = []; let fail = false;
  await fixture(req => {
    paths.push(req.url);
    if (fail) return { api_version: 1, ok: false, data: null, error: { code: 'CURSOR_EXPIRED', message: 'reset required', retryable: false } };
    return ok(req.url.includes('before=') ? page('0', 'historical') : page('1', 'signed-next'));
  }, async (s, home, reopen) => {
    await messagePage(s, 'ABCDEF');
    const stored = JSON.parse(await readFile(join(home, 'session.json'), 'utf8')).sync['fixture-user:ABCDEF'];
    assert.equal(stored.cursor, 'signed-next'); assert.equal(stored.messages[0].content, '中文 ✓');
    s = await reopen(); await messagePage(s, 'ABCDEF'); assert.match(paths.at(-1), /after=signed-next/);
    assert.equal(checkpoint(s, 'ABCDEF').messages.length, 1);
    await messagePage(s, 'ABCDEF', { before: 'older' }); assert.equal(checkpoint(s, 'ABCDEF').cursor, 'signed-next');
    fail = true; const failed = await messagePage(s, 'ABCDEF'); assert.equal(failed.error.code, 'CURSOR_EXPIRED');
    assert.equal(checkpoint(s, 'ABCDEF').cursor, 'signed-next');
    const count = paths.length; assert.equal((await messagePage(s, 'ABCDEF', { cached: true })).data.messages.length, 1); assert.equal(paths.length, count);
    fail = false; assert.equal((await messagePage(s, 'ABCDEF', { reset: true })).data.history_gap_possible, true);
    assert.equal(paths.at(-1).includes('after='), false);
  });
});

test('wait drains every queued page before returning and persists the last cursor', async () => {
  let reads = 0;
  await fixture(req => ok(req.url.endsWith('/state') ? { room: { status: 'playing' }, seats: [] } : page(String(++reads), `cursor-${reads}`, reads < 3)), async s => {
    const result = await waitForChanges(s, 'ABCDEF', 2);
    assert.deepEqual(result.data.messages.map(m => m.id), ['1', '2', '3']);
    assert.equal(result.data.has_more, false); assert.equal(checkpoint(s, 'ABCDEF').cursor, 'cursor-3');
  });
});

test('wait detects business-state changes, times out empty and stops on takeover', async () => {
  let takeover = false;
  const state = { room: { status: 'playing' }, seats: [{ remaining_points: 7 }] };
  await fixture(req => takeover ? { api_version: 1, ok: false, data: null, error: { code: 'ROOM_DEVICE_IN_USE', message: 'takeover', retryable: false } } : ok(req.url.endsWith('/state') ? state : page(null, 'current')), async s => {
    checkpoint(s, 'ABCDEF').fingerprint = stateFingerprint({ ...state, room: { status: 'waiting' } });
    assert.equal((await waitForChanges(s, 'ABCDEF', 1)).data.state_changed, true);
    assert.equal((await waitForChanges(s, 'ABCDEF', 1)).data.timed_out, true);
    takeover = true; assert.equal((await waitForChanges(s, 'ABCDEF', 1)).error.code, 'ROOM_DEVICE_IN_USE');
  });
});

test('wait request deadline includes slow network time; invalid options are rejected', async () => {
  await fixture(async () => { await new Promise(r => setTimeout(r, 1500)); return ok({}); }, async s => {
    const started = Date.now(); const result = await waitForChanges(s, 'ABCDEF', 1);
    assert.equal(result.ok, true); assert.equal(result.data.timed_out, true); assert.equal(result.data.poll_incomplete, true); assert.ok(Date.now() - started < 1400);
    await assert.rejects(() => waitForChanges(s, 'ABCDEF', 61), /INVALID_INPUT/);
    await assert.rejects(() => messagePage(s, 'ABCDEF', { limit: '101' }), /INVALID_INPUT/);
    await assert.rejects(() => messagePage(s, 'ABCDEF', { cached: true, reset: true }), /INVALID_INPUT/);
  });
});

test('an actual network failure before the wait deadline remains an error', async () => {
  await fixture(req => { req.destroy(); return ok({}); }, async s => {
    assert.equal((await waitForChanges(s, 'ABCDEF', 5)).error.code, 'NETWORK_ERROR');
  });
});

test('post-command notice preserves feed cursor/bodies and excludes displayed write replies across restart', async () => {
  let checked = 0, peers = true;
  const own = [{ id: '2', sender_name: 'me', content: 'question' }, { id: '3', sender_name: 'AI', content: '是' }];
  await fixture(req => {
    checked++; assert.match(req.url, /after=baseline/);
    return ok({ ...page(null, 'advanced'), messages: [...own, ...(peers ? [{ id: '4', sender_name: 'peer', content: 'new' }] : [])] });
  }, async (s, home, reopen) => {
    checkpoint(s, 'ABCDEF').cursor = 'baseline'; s.state.room = 'ABCDEF';
    const result = ok({ action: 'ask', room_code: 'ABCDEF', status: 'completed', request_message_id: 2, ai_message: own[1] });
    const notice = await withMessageCheck(s, { name: 'ask', options: {} }, result);
    assert.equal(notice.message_check.has_unread, true);
    assert.match(textOutput(notice), /AI 主持：是\n房间有新消息/);
    assert.equal(checkpoint(s, 'ABCDEF').cursor, 'baseline');
    assert.deepEqual(checkpoint(s, 'ABCDEF').messages, []);
    peers = false; s = await reopen();
    const caught = await withMessageCheck(s, { name: 'state', options: {} }, ok({}));
    assert.equal(caught.message_check.has_unread, false);
    assert.deepEqual(checkpoint(s, 'ABCDEF').displayed_message_ids, ['2', '3']);
    peers = true;
    const pulled = await messagePage(s, 'ABCDEF');
    assert.deepEqual(pulled.data.messages.map(m => m.id), ['2', '3', '4']);
    assert.equal(checkpoint(s, 'ABCDEF').cursor, 'advanced'); assert.equal(checked, 3);
  });
});

test('notice failures never replace payment result; expired cursor and delayed visibility remain explicit', async () => {
  let response = { api_version: 1, ok: false, data: null, error: { code: 'ROOM_DEVICE_IN_USE', message: 'taken', retryable: false } };
  await fixture(() => response, async s => {
    s.state.room = 'ABCDEF'; checkpoint(s, 'ABCDEF').cursor = 'original';
    const original = { api_version: 1, ok: false, data: null, error: { code: 'REQUEST_RESULT_UNKNOWN', message: 'keep original key', retryable: true } };
    const command = { name: 'reason', options: {} };
    const failed = await withMessageCheck(s, command, original);
    assert.deepEqual(failed.error, original.error); assert.equal(failed.ok, false);
    assert.equal(failed.message_check.reason, 'ROOM_DEVICE_IN_USE');
    assert.match(textOutput(failed), /^REQUEST_RESULT_UNKNOWN: keep original key/);
    response = { ...response, error: { ...response.error, code: 'CURSOR_EXPIRED' } };
    assert.equal((await withMessageCheck(s, command, ok({}))).message_check.next_command, '/messages --reset');
    response = ok({ ...page(null, 'ignored'), visibility_delayed: true });
    assert.equal((await withMessageCheck(s, command, ok({}))).message_check.reason, 'VISIBILITY_DELAYED');
    response = ok({ ...page(null, 'ignored'), has_more: true });
    assert.equal((await withMessageCheck(s, command, ok({}))).message_check.has_unread, null);
    assert.equal(checkpoint(s, 'ABCDEF').cursor, 'original');
  });
});

test('local commands, sync commands, departed rooms and displaced identities do not trigger another fetch', async () => {
  let requests = 0;
  await fixture(() => { requests++; return ok(page(null, 'ignored')); }, async s => {
    s.state.room = 'ABCDEF';
    for (const command of [{ name: 'help', options: {} }, { name: 'exit', options: {} }, { name: 'messages', options: {} }, { name: 'messages', options: { cached: true } }, { name: 'wait', options: {} }, { name: 'login', options: {} }]) {
      assert.equal((await withMessageCheck(s, command, ok({}))).message_check, undefined);
    }
    const displaced = { api_version: 1, ok: false, data: null, error: { code: 'ROOM_DEVICE_IN_USE' } };
    assert.equal((await withMessageCheck(s, { name: 'state', options: {} }, displaced)).message_check, undefined);
    delete s.state.room;
    assert.equal((await withMessageCheck(s, { name: 'leave', options: {} }, ok({}))).message_check, undefined);
    assert.equal(requests, 0);
  });
});

test('slow attached check is bounded and never retries or turns a completed action into failure', async () => {
  let requests = 0;
  await fixture(async () => { requests++; await new Promise(r => setTimeout(r, 2500)); return ok(page(null, 'ignored')); }, async s => {
    s.state.room = 'ABCDEF';
    const original = ok({ action: 'say', room_code: 'ABCDEF', status: 'completed', message: { id: '2' } });
    const started = Date.now();
    const result = await withMessageCheck(s, { name: 'say', options: {} }, original);
    assert.equal(result.ok, true); assert.equal(result.data.status, 'completed');
    assert.equal(result.message_check.has_unread, null); assert.equal(requests, 1);
    assert.ok(Date.now() - started < 2400);
  });
});
