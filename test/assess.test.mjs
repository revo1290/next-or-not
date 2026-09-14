import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { auditContinuation, scanProject } from '../scripts/assess.mjs';
import { HUMAN_QUESTIONS, integrateHumanEvidence, normalizeHumanContext } from '../scripts/human-evidence.mjs';

const execFileAsync = promisify(execFile);

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-'));
  await Promise.all(Object.entries(files).map(async ([name, content]) => {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2));
  }));
  return root;
}

function nextPackage(version = '16.3.5', extra = {}) {
  return { name: 'fixture', private: true, dependencies: { next: version, react: '19.1.0' }, ...extra };
}

function npmLock(version = '16.3.5') {
  return { lockfileVersion: 3, packages: { '': { dependencies: { next: version } }, 'node_modules/next': { version } } };
}

async function scan(files) {
  const root = await fixture(files);
  const { signals } = await scanProject(root);
  return { root, signals, audit: auditContinuation(signals, new Date('2026-09-14T00:00:00Z')) };
}

test('does not mistake generic cookies or metadata identifiers for Next.js APIs', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': 'const metadata = {}; function cookies() { return [] }\nexport default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.features.requestBoundApis.files, 0);
  assert.equal(result.signals.features.metadataApis.files, 0);
});

test('keeps a server-integrated App Router project', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': "import { cookies } from 'next/headers'\nexport default async function Page() { return String((await cookies()).size) }",
    'app/api/items/route.ts': 'export async function POST(request) { return Response.json(await request.json()) }',
    'app/actions.ts': "'use server'\nexport async function save() {}",
    'app/data.ts': "import { revalidateTag } from 'next/cache'\nexport function refresh() { revalidateTag('items') }",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.router, 'app');
  assert.equal(result.audit.summary.keepValue, 'high');
  assert.equal(result.audit.recommendation, 'keep');
  assert.equal(result.audit.confidence.level, 'high');
});

test('marks a small clean static export as a migration candidate, not a rewrite command', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'next.config.mjs': "export default { output: 'export' }",
    'app/layout.tsx': "'use client'\nexport default function Layout({ children }) { return children }",
    'app/page.tsx': "'use client'\nexport default function Page() { return <button>Hi</button> }",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.audit.summary.portabilityOpportunity, 'high');
  assert.equal(result.audit.summary.migrationCoupling, 'low');
  assert.equal(result.audit.recommendation, 'migration-candidate');
  assert.match(result.audit.nextSteps.join(' '), /representative route/);
});

test('detects official static-export incompatibilities', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'next.config.ts': "export default { output: 'export' }",
    'app/page.tsx': "import Image from 'next/image'\nimport { cookies } from 'next/headers'\nexport default async function Page() { await cookies(); return <Image src='/x.png' /> }",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.audit.recommendation, 'modernize-first');
  assert.match(result.audit.findings.join(' '), /Static-export conflicts/);
  assert.match(result.audit.findings.join(' '), /next\/image/);
});

test('detects request-dependent handlers and uncovered dynamic routes in static export', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'next.config.ts': "export default { output: 'export', images: { unoptimized: true } }",
    'app/posts/[slug]/page.tsx': 'export default function Page() { return null }',
    'app/feed/route.ts': 'export async function GET(request) { return Response.json({ url: request.url }) }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.features.dynamicAppRoutes.files, 1);
  assert.equal(result.signals.features.requestDependentRouteHandlers.files, 1);
  assert.equal(result.audit.recommendation, 'modernize-first');
  assert.match(result.audit.findings.join(' '), /incoming Request/);
  assert.match(result.audit.findings.join(' '), /without detected generateStaticParams/);
});

test('detects Next 16 migration cleanup such as middleware and next lint', async (t) => {
  const result = await scan({
    'package.json': nextPackage('16.3.5', { scripts: { lint: 'next lint' } }),
    'package-lock.json': npmLock(),
    'middleware.ts': "import { NextResponse } from 'next/server'\nexport function middleware() { return NextResponse.next() }",
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.audit.summary.maintenanceRisk, 'high');
  assert.equal(result.audit.recommendation, 'modernize-first');
  assert.match(result.audit.findings.join(' '), /deprecated/);
  assert.match(result.audit.findings.join(' '), /next lint/);
});

test('uses the exact npm lockfile version for support and patch review', async (t) => {
  const result = await scan({
    'package.json': nextPackage('^16.0.0'),
    'package-lock.json': npmLock('16.3.2'),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.nextProjects[0].resolvedVersion, '16.3.2');
  assert.equal(result.audit.summary.maintenanceRisk, 'high');
  assert.match(result.audit.findings.join(' '), /16\.3\.3 patched release/);
});

test('does not treat a canary lockfile version as stable LTS', async (t) => {
  const result = await scan({
    'package.json': nextPackage('^16.0.0'),
    'package-lock.json': npmLock('16.4.0-canary.12'),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.audit.summary.maintenanceRisk, 'high');
  assert.equal(result.audit.recommendation, 'modernize-first');
  assert.match(result.audit.findings.join(' '), /pre-release/);
});

test('finds a Next.js workspace below a monorepo root', async (t) => {
  const result = await scan({
    'package.json': { name: 'root', private: true, workspaces: ['apps/*'] },
    'apps/web/package.json': nextPackage(),
    'apps/web/app/page.tsx': 'export default function Page() { return null }',
    'apps/api/package.json': { name: 'api', dependencies: { express: '5.1.0' } },
    'apps/api/index.ts': "import express from 'express'",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.nextProjects.length, 1);
  assert.equal(result.signals.nextProjects[0].path, 'apps/web');
  assert.equal(result.signals.sourceFiles, 1);
  assert.equal(result.signals.routes.appPages.examples[0], 'apps/web/app/page.tsx');
});

test('returns not-applicable when no Next.js package exists', async (t) => {
  const result = await scan({
    'package.json': { name: 'vite-app', dependencies: { vite: '7.0.0', react: '19.1.0' } },
    'src/main.tsx': 'function cookies() {}',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.audit.applicable, false);
  assert.equal(result.audit.recommendation, 'not-applicable');
});

test('treats a stale evidence snapshot as a confidence limit', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const stale = auditContinuation(result.signals, new Date('2026-11-01T00:00:00Z'));
  assert.equal(stale.confidence.level, 'medium');
  assert.match(stale.confidence.basis.join(' '), /stale/);
});

test('tracks alias bindings and ignores unused, type-only, comment, string, and shadowed names', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': [
      "import { cookies as readCookies, type UnsafeUnwrappedCookies } from 'next/headers'",
      "import { revalidateTag } from 'next/cache'",
      "import type { Metadata } from 'next'",
      "// cookies() and revalidateTag('comment') are not evidence",
      "const prose = \"cookies() from next/headers\"",
      'function cookies() { return prose }',
      'export default async function Page() { return String((await readCookies()).size) }',
    ].join('\n'),
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.features.requestBoundApis.files, 1);
  assert.equal(result.signals.features.requestBoundApis.evidence[0].line, 1);
  assert.equal(result.signals.features.cacheApis.files, 0);
  assert.equal(result.signals.analysis.unusedNextImports.length, 3);
  assert.deepEqual(new Set(result.signals.analysis.unusedNextImports.map((item) => item.reason)), new Set(['type-only', 'unreferenced']));
});

test('detects multiline imports, dynamic imports, require, and re-exports through the AST', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'pages/index.tsx': [
      'import {',
      '  useRouter as navigate',
      "} from 'next/router'",
      "export { Image as OptimizedImage } from 'next/image'",
      "const loadServer = () => import('next/server')",
      "const Link = require('next/link')",
      'export default function Page() { navigate(); return Link && loadServer }',
    ].join('\n'),
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.features.navigationApis.files, 1);
  assert.equal(result.signals.features.imageComponent.files, 1);
  assert.equal(result.signals.features.nextServerApis.files, 1);
  assert.equal(result.signals.features.linkComponent.files, 1);
  assert.equal(result.signals.features.nextImports.count, 4);
  assert.ok(result.signals.features.nextImports.evidence.every((item) => item.detectionMethod === 'ast'));
});

test('uses exported bindings for route handlers and distinguishes used request parameters', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/used/route.ts': [
      'const handler = async (incoming: Request) => Response.json({ url: incoming.url })',
      'export { handler as GET }',
    ].join('\n'),
    'app/unused/route.ts': 'export const POST = async (request: Request) => Response.json({ ok: true })',
    'app/reexport/route.ts': "export { GET } from '../shared-handler'",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.routes.appRouteHandlers.files, 3);
  assert.equal(result.signals.features.requestDependentRouteHandlers.files, 1);
  assert.equal(result.signals.features.requestDependentRouteHandlers.examples[0], 'app/used/route.ts');
});

test('detects Pages Router data exports and App Router segment config without regex naming collisions', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'pages/index.tsx': [
      'const load = async () => ({ props: {} })',
      'export { load as getServerSideProps }',
      'const getStaticPropsLabel = true',
      'export default function Page() { return getStaticPropsLabel }',
    ].join('\n'),
    'app/[slug]/page.tsx': [
      "export const runtime = 'edge'",
      'export const revalidate = 60',
      'export const dynamicParams = true',
      'const build = async () => [{ slug: "a" }]',
      'export { build as generateStaticParams }',
      'export default function Page() { return null }',
    ].join('\n'),
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.features.serverSideProps.files, 1);
  assert.equal(result.signals.features.staticProps.files, 0);
  assert.equal(result.signals.features.routeRuntimeConfig.files, 1);
  assert.equal(result.signals.features.routeRevalidation.files, 1);
  assert.equal(result.signals.features.dynamicParamsEnabled.files, 1);
  assert.equal(result.signals.features.staticParams.files, 1);
});

test('records parse failures, uses only the bounded fallback, and lowers confidence', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': "import { cookies } from 'next/headers'\nexport default function Page( {",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.analysis.failedFiles, 1);
  assert.equal(result.signals.analysis.fallbackFiles, 1);
  assert.equal(result.signals.features.requestBoundApis.evidence[0].detectionMethod, 'regex-fallback');
  assert.equal(result.audit.confidence.level, 'medium');
  assert.match(result.audit.confidence.basis.join(' '), /AST parsing failed/);
});

test('resolves package-lock v1 and npm-shrinkwrap without executing npm', async (t) => {
  const v1 = await scan({
    'package.json': nextPackage('^15.0.0', { packageManager: 'npm@10.9.0' }),
    'package-lock.json': { lockfileVersion: 1, dependencies: { next: { version: '15.5.24' } } },
    'pages/index.js': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(v1.root, { recursive: true, force: true }));
  assert.equal(v1.signals.nextProjects[0].resolvedVersion, '15.5.24');
  assert.equal(v1.signals.nextProjects[0].resolution.file, 'package-lock.json');

  const shrinkwrap = await scan({
    'package.json': nextPackage('^16.0.0', { packageManager: 'npm@11.0.0' }),
    'npm-shrinkwrap.json': { lockfileVersion: 3, packages: { 'node_modules/next': { version: '16.3.5' } } },
    'app/page.js': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(shrinkwrap.root, { recursive: true, force: true }));
  assert.equal(shrinkwrap.signals.nextProjects[0].resolvedVersion, '16.3.5');
  assert.equal(shrinkwrap.signals.nextProjects[0].resolution.file, 'npm-shrinkwrap.json');
});

test('resolves distinct pnpm workspace versions including a prerelease', async (t) => {
  const result = await scan({
    'package.json': { name: 'root', private: true, packageManager: 'pnpm@10.0.0', workspaces: ['apps/*'] },
    'pnpm-lock.yaml': [
      "lockfileVersion: '9.0'",
      'importers:',
      '  apps/stable:',
      '    dependencies:',
      '      next:',
      '        specifier: ^16.0.0',
      '        version: 16.3.5(react@19.1.0)',
      '  apps/canary:',
      '    dependencies:',
      '      next:',
      '        specifier: 16.4.0-canary.12',
      '        version: 16.4.0-canary.12(react@19.1.0)',
    ].join('\n'),
    'apps/stable/package.json': nextPackage('^16.0.0'),
    'apps/stable/app/page.tsx': 'export default function Page() { return null }',
    'apps/canary/package.json': nextPackage('16.4.0-canary.12'),
    'apps/canary/app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const versions = Object.fromEntries(result.signals.nextProjects.map((project) => [project.path, project.resolvedVersion]));
  assert.deepEqual(versions, { 'apps/canary': '16.4.0-canary.12', 'apps/stable': '16.3.5' });
  assert.ok(result.signals.nextProjects.every((project) => project.resolution.packageManager === 'pnpm'));
});

test('resolves Yarn Classic and Berry descriptors, aliases, and workspace ranges', async (t) => {
  const classic = await scan({
    'package.json': nextPackage('npm:next@^15.0.0', { packageManager: 'yarn@1.22.22' }),
    'yarn.lock': [
      '# yarn lockfile v1',
      '',
      'next@npm:next@^15.0.0:',
      '  version "15.5.24"',
      '  resolved "https://registry.yarnpkg.com/next/-/next-15.5.24.tgz"',
    ].join('\n'),
    'pages/index.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(classic.root, { recursive: true, force: true }));
  assert.equal(classic.signals.nextProjects[0].resolvedVersion, '15.5.24');
  assert.equal(classic.signals.versionResolution.lockfile.lockfileVersion, 1);

  const berry = await scan({
    'package.json': { name: 'root', private: true, packageManager: 'yarn@4.9.2', workspaces: ['apps/*'] },
    'yarn.lock': [
      '__metadata:',
      '  version: 8',
      '  cacheKey: 10c0',
      '',
      '"next@npm:^16.0.0":',
      '  version: 16.3.5',
      '  resolution: "next@npm:16.3.5"',
    ].join('\n'),
    'apps/web/package.json': nextPackage('^16.0.0'),
    'apps/web/app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(berry.root, { recursive: true, force: true }));
  assert.equal(berry.signals.nextProjects[0].resolvedVersion, '16.3.5');
  assert.equal(berry.signals.versionResolution.lockfile.lockfileVersion, 8);
});

test('resolves Bun text workspaces and build metadata while rejecting binary guesses', async (t) => {
  const textLock = await scan({
    'package.json': { name: 'root', private: true, packageManager: 'bun@1.2.0', workspaces: ['apps/*'] },
    'bun.lock': [
      '{',
      '  // Bun text lockfiles are JSONC',
      '  "lockfileVersion": 1,',
      '  "workspaces": {',
      '    "apps/web": { "dependencies": { "next": "next@16.3.5+build.7" } },',
      '  },',
      '  "packages": { "next": ["next@16.3.5+build.7", "", {}, "sha512-x"], },',
      '}',
    ].join('\n'),
    'apps/web/package.json': nextPackage('^16.0.0'),
    'apps/web/app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(textLock.root, { recursive: true, force: true }));
  assert.equal(textLock.signals.nextProjects[0].resolvedVersion, '16.3.5+build.7');

  const binary = await scan({
    'package.json': nextPackage('^16.0.0', { packageManager: 'bun@1.1.0' }),
    'bun.lockb': Buffer.from([0, 1, 2, 3]),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(binary.root, { recursive: true, force: true }));
  assert.equal(binary.signals.nextProjects[0].resolvedVersion, null);
  assert.equal(binary.signals.nextProjects[0].resolution.source, 'unresolved');
  assert.equal(binary.signals.versionResolution.errors[0].code, 'unsupported-binary-lockfile');
});

test('prefers installed Next.js, reports lockfile drift, and preserves provenance', async (t) => {
  const result = await scan({
    'package.json': nextPackage('^16.0.0'),
    'package-lock.json': npmLock('16.3.3'),
    'node_modules/next/package.json': { name: 'next', version: '16.3.5' },
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const project = result.signals.nextProjects[0];
  assert.equal(project.resolvedVersion, '16.3.5');
  assert.equal(project.resolution.source, 'installed');
  assert.equal(project.resolution.scope, 'workspace');
  assert.match(project.resolutionWarnings[0], /does not match lockfile/);
  assert.equal(result.audit.confidence.level, 'medium');
});

test('returns structured failure for a malformed lockfile instead of guessing', async (t) => {
  const result = await scan({
    'package.json': nextPackage('^16.0.0', { packageManager: 'pnpm@10.0.0' }),
    'pnpm-lock.yaml': 'importers:\n  .:\n   broken: [',
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  assert.equal(result.signals.nextProjects[0].resolvedVersion, null);
  assert.equal(result.signals.nextProjects[0].resolution.source, 'unresolved');
  assert.equal(result.signals.nextProjects[0].resolutionErrors[0].code, 'malformed-lockfile');
  assert.equal(result.audit.confidence.level, 'medium');
});

test('does not follow an installed Next.js symlink outside the scanned repository', async (t) => {
  const outside = await fixture({ 'package.json': { name: 'next', version: '99.0.0' } });
  const root = await fixture({
    'package.json': nextPackage('^16.0.0'),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.symlink(outside, path.join(root, 'node_modules', 'next'), 'dir');
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(outside, { recursive: true, force: true }),
  ]));
  const { signals } = await scanProject(root);
  const project = signals.nextProjects[0];
  assert.equal(project.resolvedVersion, null);
  assert.equal(project.resolution.source, 'unresolved');
  assert.match(project.resolutionWarnings[0], /outside the scanned repository/);
});

test('keeps the human supplement fixed at seven fields and accepts all unknown', () => {
  assert.equal(HUMAN_QUESTIONS.length, 7);
  assert.deepEqual(HUMAN_QUESTIONS.map((question) => question.field), [
    'reviewDriver', 'evidenceStrength', 'productionRouteProfile', 'deploymentConstraint',
    'serverCapabilityCriticality', 'roadmapDirection', 'changeCapacity',
  ]);
  const context = normalizeHumanContext({});
  assert.equal(context.completeness, 0);
  assert.equal(context.unknownFields.length, 7);
  assert.equal(context.validationErrors.length, 0);
});

test('normalizes partial and invalid human input without replacing repository facts', () => {
  const context = normalizeHumanContext({
    reviewDriver: '開発速度',
    evidenceStrength: '体感・単発事例',
    productionRouteProfile: 'invalid-value',
    note: 'Additional facts stay in the single free-form note.',
  });
  assert.equal(context.rawAnswers.reviewDriver, '開発速度');
  assert.equal(context.rawAnswers.evidenceStrength, '体感・単発事例');
  assert.equal(context.rawAnswers.productionRouteProfile, 'unknown');
  assert.equal(context.validationErrors.length, 1);
  assert.equal(context.note, 'Additional facts stay in the single free-form note.');
});

test('flags static-only vs request-time evidence and prioritizes configuration investigation', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': "import { cookies } from 'next/headers'\nexport default async function Page() { return String(await cookies()) }",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const integrated = integrateHumanEvidence(result.audit, result.signals, normalizeHumanContext({
    deploymentConstraint: 'static-only',
    productionRouteProfile: '主に静的公開ページ',
  }));
  assert.equal(integrated.continuation.recommendation, 'modernize-first');
  assert.ok(integrated.humanEvidence.contradictions.some((item) => item.code === 'static-only-vs-request-time'));
  assert.equal(integrated.continuation.profile.router, result.audit.profile.router);
  assert.equal(integrated.continuation.summary.keepValue, result.audit.summary.keepValue);
});

test('does not create migration-candidate from answers and preserves measured support for a code candidate', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'next.config.mjs': "export default { output: 'export' }",
    'app/layout.tsx': "'use client'\nexport default function Layout({ children }) { return children }",
    'app/page.tsx': "'use client'\nexport default function Page() { return null }",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const measured = integrateHumanEvidence(result.audit, result.signals, normalizeHumanContext({
    reviewDriver: 'インフラ費用', evidenceStrength: '継続的な計測', changeCapacity: '小さなspikeのみ',
  }));
  assert.equal(measured.humanEvidence.recommendationBeforeHumanEvidence, 'migration-candidate');
  assert.equal(measured.continuation.recommendation, 'migration-candidate');

  const keepResult = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(keepResult.root, { recursive: true, force: true }));
  const answerOnly = integrateHumanEvidence(keepResult.audit, keepResult.signals, normalizeHumanContext({
    reviewDriver: 'インフラ費用', evidenceStrength: '複数の障害・SLO違反', changeCapacity: '全面移行を実施可能',
  }));
  assert.notEqual(answerOnly.continuation.recommendation, 'migration-candidate');
});

test('constrains a migration candidate when capacity is absent and weak evidence remains weak', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'next.config.mjs': "export default { output: 'export' }",
    'app/page.tsx': "'use client'\nexport default function Page() { return null }",
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const integrated = integrateHumanEvidence(result.audit, result.signals, normalizeHumanContext({
    reviewDriver: '開発速度', evidenceStrength: '体感・単発事例', changeCapacity: '移行予算なし',
  }));
  assert.equal(integrated.continuation.recommendation, 'keep-and-simplify');
  assert.match(integrated.continuation.nextSteps.join(' '), /continuing measurements/);
});

test('reports a contradiction when detected server value is reported unused', async (t) => {
  const result = await scan({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/api/route.ts': 'export async function POST(request) { return Response.json(await request.json()) }',
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(result.root, { recursive: true, force: true }));
  const integrated = integrateHumanEvidence(result.audit, result.signals, normalizeHumanContext({
    serverCapabilityCriticality: '利用していない',
  }));
  assert.ok(integrated.humanEvidence.contradictions.some((item) => item.code === 'reported-unused-vs-detected-server'));
  assert.equal(integrated.continuation.summary.keepValue, result.audit.summary.keepValue);
});

test('interactive mode does not prompt or hang when stdin is not a TTY', async (t) => {
  const root = await fixture({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': 'export default function Page() { return null }',
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cli = path.resolve('scripts/assess.mjs');
  const { stdout } = await execFileAsync(process.execPath, [cli, root, '--interactive', '--json'], { timeout: 5_000 });
  const output = JSON.parse(stdout);
  assert.equal(output.humanEvidence.promptStatus, 'skipped-non-tty');
  assert.equal(output.humanEvidence.unknownFields.length, 7);
  assert.match(output.humanEvidence.promptWarning, /without a TTY/);
});

test('context file is reflected in both human-readable and JSON output', async (t) => {
  const root = await fixture({
    'package.json': nextPackage(),
    'package-lock.json': npmLock(),
    'app/page.tsx': 'export default function Page() { return null }',
    'context.json': {
      answers: { reviewDriver: '開発速度', evidenceStrength: '体感・単発事例', changeCapacity: '小さなspikeのみ' },
      note: 'Keep raw context separate from source findings.',
    },
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cli = path.resolve('scripts/assess.mjs');
  const contextPath = path.join(root, 'context.json');
  const [human, json] = await Promise.all([
    execFileAsync(process.execPath, [cli, root, '--context', contextPath], { timeout: 5_000 }),
    execFileAsync(process.execPath, [cli, root, '--context', contextPath, '--json'], { timeout: 5_000 }),
  ]);
  assert.match(human.stdout, /Human evidence supplement:/);
  assert.match(human.stdout, /reviewDriver: 開発速度/);
  const output = JSON.parse(json.stdout);
  assert.equal(output.humanEvidence.rawAnswers.reviewDriver, '開発速度');
  assert.equal(output.humanEvidence.note, 'Keep raw context separate from source findings.');
  assert.equal(output.humanEvidence.implications[0].field, 'reviewDriver');
});
