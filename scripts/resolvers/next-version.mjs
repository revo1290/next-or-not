import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

const MAX_LOCKFILE_BYTES = 20_000_000;

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

function inside(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function portable(root, target) {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

export function exactSemver(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? null;
}

function versionFromReference(value) {
  const raw = typeof value === 'string' ? value : value?.version;
  if (typeof raw !== 'string') return null;
  if (exactSemver(raw)) return exactSemver(raw);
  const withoutPeerSuffix = raw.replace(/\(.+\)$/, '');
  const match = withoutPeerSuffix.match(/(?:^|@|npm:)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? null;
}

async function boundedRead(target, encoding = 'utf8') {
  const stat = await fs.stat(target);
  if (stat.size > MAX_LOCKFILE_BYTES) throw new Error(`lockfile exceeds ${MAX_LOCKFILE_BYTES} bytes`);
  return fs.readFile(target, encoding);
}

async function readJson(target) {
  return JSON.parse(await boundedRead(target));
}

function resultCandidate(version, details) {
  return version ? { version, ...details } : null;
}

function npmResolver(data, file) {
  const lockfileVersion = data.lockfileVersion ?? 1;
  return {
    packageManager: 'npm', file, lockfileVersion,
    resolve(workspacePath) {
      const key = workspacePath === '.' ? 'node_modules/next' : `${workspacePath}/node_modules/next`;
      const workspace = resultCandidate(exactSemver(data.packages?.[key]?.version), { scope: 'workspace' });
      const root = resultCandidate(
        exactSemver(data.packages?.['node_modules/next']?.version) ?? exactSemver(data.dependencies?.next?.version),
        { scope: 'root' },
      );
      return { workspace, root };
    },
  };
}

function pnpmEntry(importer, dependencyName) {
  if (!importer) return null;
  return importer.dependencies?.[dependencyName]
    ?? importer.devDependencies?.[dependencyName]
    ?? importer.optionalDependencies?.[dependencyName]
    ?? null;
}

function packageKeyVersion(collection, packageName) {
  for (const [key, value] of Object.entries(collection ?? {})) {
    const normalized = key.replace(/^\//, '');
    if (!normalized.startsWith(`${packageName}@`)) continue;
    const version = exactSemver(value?.version) ?? versionFromReference(normalized);
    if (version) return version;
  }
  return null;
}

function pnpmResolver(data, file) {
  return {
    packageManager: 'pnpm', file, lockfileVersion: data.lockfileVersion ?? null,
    resolve(workspacePath) {
      const importerKey = workspacePath === '.' ? '.' : workspacePath;
      const workspace = resultCandidate(versionFromReference(pnpmEntry(data.importers?.[importerKey], 'next')), { scope: 'workspace' });
      const rootImporter = resultCandidate(versionFromReference(pnpmEntry(data.importers?.['.'], 'next')), { scope: 'root' });
      const packages = resultCandidate(
        packageKeyVersion(data.snapshots, 'next') ?? packageKeyVersion(data.packages, 'next'),
        { scope: 'root' },
      );
      return { workspace, root: rootImporter ?? packages };
    },
  };
}

function yarnDescriptors(header) {
  const values = [];
  const pattern = /(?:^|,\s*)(?:"([^"]+)"|'([^']+)'|([^,]+))/g;
  for (const match of header.matchAll(pattern)) values.push((match[1] ?? match[2] ?? match[3]).trim());
  return values;
}

function parseYarnClassic(text) {
  const entries = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line && !/^\s/.test(line) && line.endsWith(':')) {
      current = { descriptors: yarnDescriptors(line.slice(0, -1)), version: null };
      entries.push(current);
      continue;
    }
    const version = line.match(/^\s{2}version\s+["']([^"']+)["']/)?.[1];
    if (current && version) current.version = exactSemver(version);
  }
  return entries;
}

function descriptorMatches(descriptor, declaredVersion) {
  if (!descriptor.startsWith('next@')) return false;
  const selector = descriptor.slice('next@'.length);
  const normalizedDeclared = declaredVersion?.replace(/^npm:next@/, '') ?? '';
  return selector === declaredVersion || selector === `npm:${declaredVersion}` || selector === `npm:${normalizedDeclared}`
    || (!declaredVersion && Boolean(versionFromReference(selector)));
}

function yarnClassicResolver(text, file) {
  const entries = parseYarnClassic(text);
  return {
    packageManager: 'yarn', file, lockfileVersion: 1,
    resolve(_workspacePath, declaredVersion) {
      const entry = entries.find((item) => item.descriptors.some((descriptor) => descriptorMatches(descriptor, declaredVersion)))
        ?? entries.find((item) => item.descriptors.some((descriptor) => descriptor.startsWith('next@')));
      return { workspace: resultCandidate(entry?.version, { scope: 'workspace' }), root: null };
    },
  };
}

function yarnBerryResolver(data, file) {
  const entries = Object.entries(data).filter(([key]) => key !== '__metadata');
  const version = data.__metadata?.version ?? 2;
  return {
    packageManager: 'yarn', file, lockfileVersion: version,
    resolve(_workspacePath, declaredVersion) {
      const matched = entries.find(([header, value]) =>
        yarnDescriptors(header).some((descriptor) => descriptorMatches(descriptor, declaredVersion))
        && (exactSemver(value?.version) || versionFromReference(value?.resolution)));
      const anyNext = matched ?? entries.find(([header]) => yarnDescriptors(header).some((descriptor) => descriptor.startsWith('next@')));
      const resolved = exactSemver(anyNext?.[1]?.version) ?? versionFromReference(anyNext?.[1]?.resolution);
      return { workspace: resultCandidate(resolved, { scope: 'workspace' }), root: null };
    },
  };
}

function stripJsonComments(text) {
  let output = '';
  let string = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (string) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) string = false;
      continue;
    }
    if (char === '"' || char === "'") { string = true; quote = char; output += char; continue; }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, '$1');
}

function bunResolver(data, file) {
  return {
    packageManager: 'bun', file, lockfileVersion: data.lockfileVersion ?? null,
    resolve(workspacePath) {
      const key = workspacePath === '.' ? '' : workspacePath;
      const workspaceRecord = data.workspaces?.[key];
      const workspace = resultCandidate(versionFromReference(
        workspaceRecord?.dependencies?.next
        ?? workspaceRecord?.devDependencies?.next
        ?? workspaceRecord?.optionalDependencies?.next,
      ), { scope: 'workspace' });
      const packageEntry = data.packages?.next;
      const rootVersion = versionFromReference(Array.isArray(packageEntry) ? packageEntry[0] : packageEntry?.resolution ?? packageEntry?.version);
      return { workspace, root: resultCandidate(rootVersion, { scope: 'root' }) };
    },
  };
}

async function loadLockfile(root, packageManager) {
  const candidates = {
    npm: ['npm-shrinkwrap.json', 'package-lock.json'],
    pnpm: ['pnpm-lock.yaml'],
    yarn: ['yarn.lock'],
    bun: ['bun.lock', 'bun.lockb'],
  }[packageManager] ?? [];
  for (const name of candidates) {
    const target = path.join(root, name);
    if (!await exists(target)) continue;
    try {
      if (name === 'bun.lockb') return {
        resolver: null,
        error: { file: name, code: 'unsupported-binary-lockfile', message: 'bun.lockb is binary and is not guessed; use bun.lock or an installed package.' },
      };
      const text = await boundedRead(target);
      if (packageManager === 'npm') return { resolver: npmResolver(JSON.parse(text), name), error: null };
      if (packageManager === 'pnpm') return { resolver: pnpmResolver(YAML.parse(text, { maxAliasCount: 100 }), name), error: null };
      if (packageManager === 'yarn') {
        const berry = /^__metadata:\s*$/m.test(text);
        return { resolver: berry ? yarnBerryResolver(YAML.parse(text, { maxAliasCount: 100 }), name) : yarnClassicResolver(text, name), error: null };
      }
      return { resolver: bunResolver(JSON.parse(stripJsonComments(text)), name), error: null };
    } catch (error) {
      return { resolver: null, error: { file: name, code: 'malformed-lockfile', message: error.message } };
    }
  }
  return { resolver: null, error: null };
}

async function detectPackageManager(root) {
  try {
    const pkg = await readJson(path.join(root, 'package.json'));
    const declared = pkg.packageManager?.match(/^(npm|pnpm|yarn|bun)@/)?.[1];
    if (declared) return declared;
  } catch {}
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lock')) || await exists(path.join(root, 'bun.lockb'))) return 'bun';
  if (await exists(path.join(root, 'npm-shrinkwrap.json')) || await exists(path.join(root, 'package-lock.json'))) return 'npm';
  return null;
}

async function installedCandidate(root, projectRoot, candidateRoot, scope) {
  const target = path.join(candidateRoot, 'node_modules', 'next', 'package.json');
  try {
    const real = await fs.realpath(target);
    if (!inside(real, root)) return { candidate: null, warning: `${portable(root, target)} resolves outside the scanned repository and was not read.` };
    const pkg = await readJson(real);
    return {
      candidate: resultCandidate(exactSemver(pkg.version), {
        source: 'installed', scope, file: portable(root, target), packageManager: null, lockfileVersion: null,
      }),
      warning: null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { candidate: null, warning: null };
    return { candidate: null, warning: `Could not read ${portable(root, target)}: ${error.message}` };
  }
}

export async function createNextVersionResolver(projectPath) {
  const root = path.resolve(projectPath);
  const packageManager = await detectPackageManager(root);
  const loaded = packageManager ? await loadLockfile(root, packageManager) : { resolver: null, error: null };
  return {
    packageManager,
    lockfile: loaded.resolver ? {
      file: loaded.resolver.file,
      packageManager: loaded.resolver.packageManager,
      lockfileVersion: loaded.resolver.lockfileVersion,
    } : null,
    errors: loaded.error ? [loaded.error] : [],
    async resolve(projectRoot, declaredVersion) {
      const workspacePath = portable(root, projectRoot);
      const warnings = [];
      const localInstalled = await installedCandidate(root, projectRoot, projectRoot, 'workspace');
      if (localInstalled.warning) warnings.push(localInstalled.warning);
      const hoistedInstalled = workspacePath === '.' ? { candidate: null, warning: null }
        : await installedCandidate(root, projectRoot, root, 'root');
      if (hoistedInstalled.warning) warnings.push(hoistedInstalled.warning);

      const lock = loaded.resolver?.resolve(workspacePath, declaredVersion) ?? { workspace: null, root: null };
      for (const candidate of [lock.workspace, lock.root]) if (candidate) {
        Object.assign(candidate, {
          source: 'lockfile', file: loaded.resolver.file,
          packageManager: loaded.resolver.packageManager,
          lockfileVersion: loaded.resolver.lockfileVersion,
        });
      }
      const installed = localInstalled.candidate ?? hoistedInstalled.candidate;
      const locked = lock.workspace ?? lock.root;
      if (installed && locked && installed.version !== locked.version) {
        warnings.push(`Installed Next.js ${installed.version} does not match lockfile Next.js ${locked.version} for ${workspacePath}.`);
      }
      const declaredExact = exactSemver(declaredVersion) ? {
        version: exactSemver(declaredVersion), source: 'declared', scope: 'workspace',
        file: portable(root, path.join(projectRoot, 'package.json')), packageManager: null, lockfileVersion: null,
      } : null;
      const chosen = installed ?? locked ?? declaredExact;
      return {
        resolvedVersion: chosen?.version ?? null,
        resolution: chosen ?? {
          version: null, source: 'unresolved', scope: 'workspace',
          file: loaded.error?.file ?? null, packageManager, lockfileVersion: null,
          reason: loaded.error?.message ?? 'No exact installed, lockfile, or declared Next.js version was found.',
        },
        warnings,
        errors: loaded.error ? [loaded.error] : [],
        candidates: { installed: installed ?? null, lockfile: locked ?? null, declared: declaredExact },
      };
    },
  };
}
