import{fileURLToPath}from'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const ok = data => ({ api_version: 1, ok: true, data, error: null });
test('real CLI ask/reason/chat and room reads append one JSON check without consuming messages or changing unknown-write exit', async () => {
  const paths = []; let unknown = false;
  const server = createServer(async (req, res) => {
    paths.push(`${req.method} ${req.url}`); res.setHeader('Content-Type', 'application/json');
    if (req.url.includes('/messages?')) {
      assert.match(req.url, /after=original/);
      if (unknown) return res.end(JSON.stringify({ api_version: 1, ok: false, data: null, error: { code: 'ROOM_DEVICE_IN_USE', message: 'taken', retryable: false } }));
      return res.end(JSON.stringify(ok({ messages: [{ id: '3', sender_name: 'peer', content: 'new' }], next_cursor: 'ignored', has_more: false })));
    }
    if (req.method === 'GET') return res.end(JSON.stringify(ok({ puzzle: { id: 1 }, seats: [] })));
    for await (const chunk of req) void chunk;
    if (unknown) { res.statusCode = 504; return res.end('gateway timeout'); }
    res.end(JSON.stringify(ok({ action: req.url.endsWith('/ask') ? 'ask' : 'say', room_code: 'ABCDEF', status: 'completed', ai_message: { id: '2', content: '是' } })));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const home = await mkdtemp(join(tmpdir(), 'soup-notice-cli-'));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await writeFile(join(home, 'session.json'), JSON.stringify({ origin, room: 'ABCDEF', user_id: 'fixture', pending: {}, sync: { 'fixture:ABCDEF': { cursor: 'original', messages: [] } } }));
    async function run(args) {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/cli/src/main.js',import.meta.url)), '--json', ...args], {
        env: { ...process.env, ONLINESOUP_HOME: home, ONLINESOUP_URL: origin }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; child.stdout.on('data', c => stdout += c);
      const [code] = await once(child, 'close');
      assert.equal(stdout.trim().split('\n').length, 1);
      return { code, result: JSON.parse(stdout) };
    }
    for (const command of [['/ask', 'question'], ['/reason', 'explanation'], ['/hint'], ['/say', 'chat'], ['/state'], ['/puzzle'], ['/facts'], ['/seats'], ['/points']]) {
      const count = paths.filter(p => p.includes('/messages?')).length;
      const { code, result } = await run(command);
      assert.equal(code, 0); assert.equal(result.message_check.has_unread, true);
      assert.equal(paths.filter(p => p.includes('/messages?')).length, count + 1);
      const saved = JSON.parse(await readFile(join(home, 'session.json'), 'utf8'));
      assert.equal(saved.sync['fixture:ABCDEF'].cursor, 'original');
      assert.deepEqual(saved.sync['fixture:ABCDEF'].messages, []);
    }
    unknown = true;
    const failed = await run(['/ask', 'unknown write']);
    assert.equal(failed.code, 5); assert.equal(failed.result.error.code, 'REQUEST_RESULT_UNKNOWN');
    assert.equal(failed.result.message_check.reason, 'ROOM_DEVICE_IN_USE');
    assert.equal(Object.keys(JSON.parse(await readFile(join(home, 'session.json'), 'utf8')).pending).length, 1);
  } finally {
    server.closeAllConnections(); server.close(); await rm(home, { recursive: true, force: true });
  }
});
