#!/usr/bin/env node

/**
 * Check what `npm publish` would actually ship, before it ships it.
 *
 * `files` in package.json is easy to break silently: a refactor moves a
 * directory, the tarball loses it, and the CLI fails only after release. This
 * packs the real tarball and asserts the contract.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { isMainModule } from './entrypoint.mjs';
import { SUPPORTED_LOCALES } from './i18n/index.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.join(import.meta.dirname, '..'));

/** Files the published package cannot work without. */
function requiredEntries(pkg) {
  return [
    'package.json',
    'LICENSE',
    'README.md',
    'README.ja.md',
    'SKILL.md',
    pkg.bin['next-or-not'],
    'scripts/entrypoint.mjs',
    'scripts/human-evidence.mjs',
    'scripts/i18n/index.mjs',
    'scripts/analyzers/ast.mjs',
    'scripts/resolvers/next-version.mjs',
    ...SUPPORTED_LOCALES.map((locale) => `scripts/i18n/${locale}.mjs`),
  ];
}

/** Patterns that should never reach a consumer's node_modules. */
const FORBIDDEN = [
  { label: 'tests', match: (file) => file.startsWith('test/') },
  { label: 'lint configuration', match: (file) => file.startsWith('eslint.config.') },
  { label: 'CI configuration', match: (file) => file.startsWith('.github/') },
  { label: 'dependencies', match: (file) => file.includes('node_modules/') },
  { label: 'generated calibration results', match: (file) => /^dataset\/results-/.test(file) },
  { label: 'lockfiles', match: (file) => /^(package-lock\.json|npm-shrinkwrap\.json)$/.test(file) },
  { label: 'a packed tarball', match: (file) => file.endsWith('.tgz') },
];

export async function validatePackage() {
  const problems = [];
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

  if (pkg.publishConfig?.access !== 'public') problems.push('package.json must set publishConfig.access to "public".');
  if (!pkg.license) problems.push('package.json must declare a license.');
  if (!pkg.repository?.url) problems.push('package.json must declare a repository.');
  if (!pkg.bin?.['next-or-not']) problems.push('package.json must declare the next-or-not bin.');

  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, maxBuffer: 10_000_000 });
  const [tarball] = JSON.parse(stdout);
  const shipped = new Set(tarball.files.map((entry) => entry.path));

  for (const required of requiredEntries(pkg)) {
    if (!shipped.has(required)) problems.push(`The tarball is missing ${required}.`);
  }
  for (const file of shipped) {
    for (const { label, match } of FORBIDDEN) {
      if (match(file)) problems.push(`The tarball ships ${label}: ${file}`);
    }
  }

  // The bin must be executable and carry a shebang, or `npx` cannot run it.
  const binPath = path.join(ROOT, pkg.bin['next-or-not']);
  const source = await fs.readFile(binPath, 'utf8');
  if (!source.startsWith('#!')) problems.push(`${pkg.bin['next-or-not']} has no shebang.`);
  try {
    await fs.access(binPath, fs.constants.X_OK);
  } catch {
    problems.push(`${pkg.bin['next-or-not']} is not executable; run chmod +x on it.`);
  }

  return { problems, fileCount: tarball.files.length, unpackedSize: tarball.unpackedSize };
}

if (isMainModule(import.meta.url)) {
  const { problems, fileCount, unpackedSize } = await validatePackage();
  if (problems.length) {
    process.stderr.write(`The published package would be wrong:\n${problems.map((item) => `  - ${item}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Package contents are valid: ${fileCount} files, ${Math.round(unpackedSize / 1024)} kB unpacked.\n`);
  }
}
