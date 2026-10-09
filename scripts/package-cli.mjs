import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'cli');
const output = join(root, 'public/downloads');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) => execFileSync(npm, args, { cwd: cli, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
const manifest = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));
const guide = readFileSync(join(cli, 'PLAYER_GUIDE.md'), 'utf8');
const filename = `onlinesoup-cli-${manifest.version}.tgz`;
if (!guide.includes(`/downloads/${filename}`)) throw new Error('Update the player guide installation URL for this version first.');

// Reinstall the locked dependency tree, including every platform's shipped native prebuilds.
run(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
rmSync(join(cli, 'dist'), { recursive: true, force: true });
process.stdout.write(run(['run', 'build']));
const staging = mkdtempSync(join(tmpdir(), 'onlinesoup-pack-'));
try {
  const [packed] = JSON.parse(run(['pack', '--json', '--ignore-scripts', '--pack-destination', staging]));
  const allowed = /^(?:(?:package\.json|README\.md|PLAYER_GUIDE\.md|AGENT_USAGE\.md|PROTOCOL\.md|dist\/cli\/src\/[^/]+\.js|dist\/src\/lib\/player-api\/protocol\.js)$|node_modules\/)/;
  for (const { path } of packed.files) {
    if (!allowed.test(path) || /(^|\/)\.env(?:\.|$)|(^|\/)session\.json$/.test(path)) throw new Error(`Unexpected package file: ${path}`);
  }
  if (!packed.files.some(({ path }) => path === 'dist/src/lib/player-api/protocol.js')) throw new Error('Missing shared protocol module');
  mkdirSync(output, { recursive: true });
  const bytes = readFileSync(join(staging, packed.filename));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (existsSync(join(output, filename)) && !readFileSync(join(output, filename)).equals(bytes)) {
    throw new Error('This version already has a different package. Bump the CLI version before releasing new contents.');
  }
  copyFileSync(join(staging, packed.filename), join(output, filename));
  copyFileSync(join(cli, 'PLAYER_GUIDE.md'), join(output, 'OnlineSoup-CLI-Guide.md'));
  writeFileSync(join(output, `${filename}.sha256`), `${sha256}  ${filename}\n`);
  writeFileSync(join(output, 'cli-release.json'), JSON.stringify({
    version: manifest.version, node: manifest.engines.node, filename,
    packageUrl: `/downloads/${filename}`, guideUrl: '/downloads/OnlineSoup-CLI-Guide.md',
    sha256, size: bytes.length,
  }, null, 2) + '\n');
  process.stdout.write(`Packaged ${filename}: ${bytes.length} bytes, SHA-256 ${sha256}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
