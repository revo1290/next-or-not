import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assess, scanProject } from '../scripts/assess.mjs';

const base = {
  audience: 'unknown',
  content: 'unknown',
  seo: 'unknown',
  rendering: 'unknown',
  serverData: 'unknown',
  rsc: 'unknown',
  backend: 'unknown',
  hosting: 'unknown',
  maturity: 'unknown',
  migration: 'new',
};

test('prefers a Vite SPA for an authenticated CSR app with a separate backend', () => {
  const result = assess({
    ...base,
    audience: 'authenticated',
    content: 'app',
    seo: 'low',
    rendering: 'csr',
    serverData: 'none',
    rsc: 'none',
    backend: 'separate',
    hosting: 'static',
    maturity: 'strict',
  });
  assert.equal(result.bestCandidate, 'vite-spa');
  assert.equal(result.verdict, 'Next.js not justified');
});

test('marks Next.js required only for an explicit compatible RSC requirement', () => {
  const result = assess({
    ...base,
    audience: 'mixed',
    content: 'app',
    seo: 'high',
    rendering: 'hybrid',
    serverData: 'complex',
    rsc: 'required',
    backend: 'bff',
    hosting: 'node',
    maturity: 'strict',
  });
  assert.equal(result.bestCandidate, 'next');
  assert.equal(result.verdict, 'Next.js required');
});

test('flags contradictory static hosting and request-time SSR', () => {
  const result = assess({ ...base, audience: 'public', content: 'app', seo: 'high', rendering: 'ssr', hosting: 'static' });
  assert.ok(result.contradictions.some((item) => item.includes('Static-only')));
  assert.notEqual(result.verdict, 'Next.js required');
});

test('does not recommend an automatic migration for an existing Next.js app', () => {
  const result = assess({
    ...base,
    audience: 'authenticated',
    content: 'app',
    seo: 'low',
    rendering: 'csr',
    serverData: 'none',
    rsc: 'none',
    backend: 'separate',
    hosting: 'static',
    maturity: 'strict',
    migration: 'existing-next',
  });
  assert.ok(['keep', 'reduce Next-specific surface', 'run migration spike'].includes(result.action));
});

test('refuses to decide when business requirements are unknown', () => {
  const result = assess(base);
  assert.equal(result.verdict, 'Insufficient evidence');
  assert.equal(result.bestCandidate, null);
});

test('scanner detects Next.js-specific surface and static export', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-'));
  await fs.mkdir(path.join(root, 'app', 'api', 'hello'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '16.3.5', react: '19.3.0' } }));
  await fs.writeFile(path.join(root, 'next.config.mjs'), "export default { output: 'export' }\n");
  await fs.writeFile(path.join(root, 'app', 'page.tsx'), "import Image from 'next/image';\nexport const metadata = {};\nexport default function Page(){return <Image src='/a.png' alt='' width={1} height={1}/>;}\n");
  await fs.writeFile(path.join(root, 'app', 'api', 'hello', 'route.ts'), "export async function GET(){ return Response.json({ok:true}); }\n");
  const { signals } = await scanProject(root);
  assert.ok(signals.frameworks.includes('next'));
  assert.equal(signals.staticExport, true);
  assert.equal(signals.routeHandlers, 1);
  assert.equal(signals.nextImageImports, 1);
});
