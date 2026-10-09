import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(readFileSync(join(root, 'public/downloads/cli-release.json'), 'utf8'));
let packageFile = join(root, 'public', release.packageUrl);
assert.equal(createHash('sha256').update(readFileSync(packageFile)).digest('hex'), release.sha256);
assert.equal(readFileSync(join(root, 'cli/PLAYER_GUIDE.md'), 'utf8'), readFileSync(join(root, 'public', release.guideUrl), 'utf8'));
const staging = mkdtempSync(join(tmpdir(), 'onlinesoup-install-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  if (process.argv.includes('--production')) {
    const origin = 'https://onlinesoup.ai0506.com';
    const get = async (path) => {
      const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `Download ${path}`);
      return Buffer.from(await response.arrayBuffer());
    };
    const remote = JSON.parse((await get('/downloads/cli-release.json')).toString('utf8'));
    assert.deepEqual(remote, release);
    const bytes = await get(release.packageUrl);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
    assert.equal((await get(release.guideUrl)).toString('utf8'), readFileSync(join(root, 'cli/PLAYER_GUIDE.md'), 'utf8'));
    assert.equal((await get(`${release.packageUrl}.sha256`)).toString('utf8'), `${release.sha256}  ${release.filename}\n`);
    packageFile = join(staging, release.filename);
    writeFileSync(packageFile, bytes);
    process.stdout.write('PASS: production package, manifest, guide and checksum match local release\n');
  }
  // Empty installation prefix and cache; offline installation proves runtime dependencies are bundled.
  execFileSync(npm, ['install', '--global', '--prefix', staging, '--cache', join(staging, 'cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packageFile], {
    cwd: staging, stdio: 'pipe', shell: process.platform === 'win32',
  });
  const installed = join(staging, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', '@onlinesoup/cli');
  assert.equal(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version, release.version);
  const env = { ...process.env, ONLINESOUP_HOME: join(staging, 'identity') };
  const bin = process.platform === 'win32' ? join(staging, 'soup.cmd') : join(staging, 'bin/soup');
  const invoke = (args) => execFileSync(bin, args, { cwd: staging, env, encoding: 'utf8', shell: process.platform === 'win32' });
  const help = JSON.parse(invoke(['--json', '/help']));
  assert.equal(help.ok, true);
  assert.match(help.data.help, /\/login/);
  const exit = JSON.parse(invoke(['--json', '/exit']));
  assert.equal(exit.data.session_preserved, true);
  process.stdout.write(`PASS: clean offline install, bundled native lock, shared protocol, JSON help/exit (${process.platform}/${process.arch}, ${process.version})\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
