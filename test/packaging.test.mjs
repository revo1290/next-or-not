import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { isMainModule } from '../scripts/entrypoint.mjs';

const execFileAsync = promisify(execFile);
const CLI = path.resolve('scripts/assess.mjs');

async function nextAppFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-pkg-'));
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', private: true, dependencies: { next: '16.3.5', react: '19.1.0' },
  }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { '': { dependencies: { next: '16.3.5' } }, 'node_modules/next': { version: '16.3.5' } },
  }));
  await fs.writeFile(path.join(root, 'app/page.tsx'), 'export default function Page() { return null }');
  return root;
}

// Regression: `process.argv[1]` is the symlink an installed `bin` is invoked
// through, and `path.resolve` does not follow symlinks. Comparing resolved
// paths made the published CLI exit 0 printing nothing.
test('the CLI runs when invoked through a bin symlink, as an install does', async (t) => {
  const project = await nextAppFixture();
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-bin-'));
  t.after(() => Promise.all([
    fs.rm(project, { recursive: true, force: true }),
    fs.rm(binDir, { recursive: true, force: true }),
  ]));

  const link = path.join(binDir, 'next-or-not');
  await fs.symlink(CLI, link);

  const { stdout } = await execFileAsync(process.execPath, [link, project, '--lang', 'en'], { timeout: 10_000 });
  assert.match(stdout, /^Recommendation: /m, 'the symlinked entry point produced no report');
  assert.match(stdout, /^Confidence: /m);
});

test('isMainModule matches a direct path, a symlink, and nothing else', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-entry-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const target = path.join(dir, 'real.mjs');
  await fs.writeFile(target, 'export default 1;\n');
  const link = path.join(dir, 'linked');
  await fs.symlink(target, link);
  const url = `file://${target}`;

  const original = process.argv[1];
  t.after(() => { process.argv[1] = original; });

  process.argv[1] = target;
  assert.equal(isMainModule(url), true, 'direct invocation should match');

  process.argv[1] = link;
  assert.equal(isMainModule(url), true, 'symlinked invocation should match');

  process.argv[1] = path.join(dir, 'other.mjs');
  assert.equal(isMainModule(url), false, 'an unrelated script should not match');

  process.argv[1] = undefined;
  assert.equal(isMainModule(url), false, 'no argv[1] should not match');
});

test('importing the CLI as a module does not run the audit', async (t) => {
  const project = await nextAppFixture();
  t.after(() => fs.rm(project, { recursive: true, force: true }));

  const importer = path.join(project, 'importer.mjs');
  await fs.writeFile(importer, `import '${CLI}';\nprocess.stdout.write('IMPORTED_ONLY\\n');\n`);

  const { stdout } = await execFileAsync(process.execPath, [importer], { timeout: 10_000 });
  assert.equal(stdout.trim(), 'IMPORTED_ONLY', 'importing the CLI should not produce a report');
});
