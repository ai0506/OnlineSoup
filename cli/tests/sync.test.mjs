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
    assert.equal(result.error.code, 'NETWORK_ERROR'); assert.ok(Date.now() - started < 1400);
    await assert.rejects(() => waitForChanges(s, 'ABCDEF', 61), /INVALID_INPUT/);
    await assert.rejects(() => messagePage(s, 'ABCDEF', { limit: '101' }), /INVALID_INPUT/);
    await assert.rejects(() => messagePage(s, 'ABCDEF', { cached: true, reset: true }), /INVALID_INPUT/);
  });
});
