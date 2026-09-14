import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditContinuation, scanProject } from '../scripts/assess.mjs';

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-'));
  await Promise.all(Object.entries(files).map(async ([name, content]) => {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
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
