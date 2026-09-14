#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const IGNORED = new Set([
  '.git', '.next', '.nuxt', '.output', '.turbo', 'build', 'coverage', 'dist',
  'node_modules', 'out', 'storybook-static', 'target', 'vendor',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;

export const ANSWER_VALUES = {
  audience: ['public', 'authenticated', 'mixed', 'unknown'],
  content: ['content', 'app', 'mixed', 'unknown'],
  seo: ['low', 'medium', 'high', 'unknown'],
  rendering: ['csr', 'static', 'ssr', 'hybrid', 'unknown'],
  serverData: ['none', 'simple', 'complex', 'unknown'],
  rsc: ['none', 'useful', 'required', 'unknown'],
  backend: ['separate', 'bff', 'none', 'unknown'],
  hosting: ['static', 'node', 'edge', 'vercel', 'flexible', 'unknown'],
  maturity: ['strict', 'balanced', 'experimental', 'unknown'],
  migration: ['new', 'existing-next', 'existing-other', 'unknown'],
};

const QUESTIONS = [
  ['audience', 'Audience', 'public/authenticated/mixed/unknown'],
  ['content', 'Primary product shape', 'content/app/mixed/unknown'],
  ['seo', 'Search and non-JS crawler importance', 'low/medium/high/unknown'],
  ['rendering', 'Required rendering model', 'csr/static/ssr/hybrid/unknown'],
  ['serverData', 'Server-only data composition per page', 'none/simple/complex/unknown'],
  ['rsc', 'RSC value', 'none/useful/required/unknown'],
  ['backend', 'Backend ownership', 'separate/bff/none/unknown'],
  ['hosting', 'Hosting constraint', 'static/node/edge/vercel/flexible/unknown'],
  ['maturity', 'Framework maturity tolerance', 'strict/balanced/experimental/unknown'],
];

function emptySignals() {
  return {
    packageManager: null,
    dependencies: [],
    sourceFiles: 0,
    truncated: false,
    appRouterFiles: 0,
    pagesRouterFiles: 0,
    clientDirectives: 0,
    serverDirectives: 0,
    routeHandlers: 0,
    metadataApis: 0,
    staticParamApis: 0,
    cacheApis: 0,
    dynamicRequestApis: 0,
    nextImageImports: 0,
    nextFontImports: 0,
    staticExport: false,
    frameworks: [],
  };
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

async function collectFiles(root) {
  const files = [];
  const stack = [root];
  let truncated = false;
  while (stack.length && files.length < MAX_FILES) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
      if (files.length >= MAX_FILES) {
        truncated = true;
        break;
      }
    }
  }
  return { files, truncated };
}

function count(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

export async function scanProject(projectPath = '.') {
  const root = path.resolve(projectPath);
  const signals = emptySignals();
  const packagePath = path.join(root, 'package.json');
  if (await exists(packagePath)) {
    const pkg = await readJson(packagePath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    signals.dependencies = Object.keys(deps).sort();
    if (signals.dependencies.includes('next')) signals.frameworks.push('next');
    if (signals.dependencies.includes('react-router') || signals.dependencies.includes('react-router-dom')) signals.frameworks.push('react-router');
    if (signals.dependencies.includes('@tanstack/react-start')) signals.frameworks.push('tanstack-start');
    if (signals.dependencies.includes('@tanstack/react-router')) signals.frameworks.push('tanstack-router');
    if (signals.dependencies.includes('astro')) signals.frameworks.push('astro');
    if (signals.dependencies.includes('vite')) signals.frameworks.push('vite');
  }
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) signals.packageManager = 'pnpm';
  else if (await exists(path.join(root, 'yarn.lock'))) signals.packageManager = 'yarn';
  else if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) signals.packageManager = 'bun';
  else if (await exists(path.join(root, 'package-lock.json'))) signals.packageManager = 'npm';

  const { files, truncated } = await collectFiles(root);
  signals.truncated = truncated;
  const relative = files.map((file) => [file, path.relative(root, file).split(path.sep).join('/')]);
  signals.appRouterFiles = relative.filter(([, rel]) => /^(src\/)?app\/.+\.(jsx?|tsx?)$/.test(rel)).length;
  signals.pagesRouterFiles = relative.filter(([, rel]) => /^(src\/)?pages\/.+\.(jsx?|tsx?)$/.test(rel)).length;

  for (const [file, rel] of relative) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    signals.sourceFiles += 1;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    signals.clientDirectives += count(text, /^[\t ]*['"]use client['"];?/gm);
    signals.serverDirectives += count(text, /^[\t ]*['"]use server['"];?/gm);
    signals.metadataApis += count(text, /\b(generateMetadata|metadata\s*[:=])/g);
    signals.staticParamApis += count(text, /\bgenerateStaticParams\b/g);
    signals.cacheApis += count(text, /\b(revalidatePath|revalidateTag|updateTag|cacheTag|cacheLife|unstable_cache)\b|['"]use cache(?:: (?:private|remote))?['"]/g);
    signals.dynamicRequestApis += count(text, /\b(cookies|headers|draftMode|connection)\s*\(/g);
    signals.nextImageImports += count(text, /from\s+['"]next\/image['"]/g);
    signals.nextFontImports += count(text, /from\s+['"]next\/font\//g);
    if (/(^|\/)route\.(js|ts)$/.test(rel) && /export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m.test(text)) {
      signals.routeHandlers += 1;
    }
  }

  for (const configName of ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs']) {
    const configPath = path.join(root, configName);
    if (!await exists(configPath)) continue;
    const config = await fs.readFile(configPath, 'utf8');
    if (/output\s*:\s*['"]export['"]/.test(config)) signals.staticExport = true;
  }
  return { root, signals };
}

function validateAnswers(raw = {}) {
  const answers = {};
  for (const [key, allowed] of Object.entries(ANSWER_VALUES)) {
    const value = raw[key] ?? 'unknown';
    if (!allowed.includes(value)) {
      throw new Error(`Invalid ${key}: ${value}. Expected one of: ${allowed.join(', ')}`);
    }
    answers[key] = value;
  }
  return answers;
}

export function inferAnswers(signals, raw = {}) {
  const inferred = { ...raw };
  const hasNext = signals.frameworks.includes('next');
  if (!inferred.migration) inferred.migration = hasNext ? 'existing-next' : signals.dependencies.length ? 'existing-other' : 'new';
  if (!inferred.rendering && signals.staticExport) inferred.rendering = 'static';
  if (!inferred.rendering && hasNext && (signals.dynamicRequestApis || signals.serverDirectives || signals.routeHandlers)) inferred.rendering = 'hybrid';
  if (!inferred.rsc && hasNext && (signals.dynamicRequestApis || signals.cacheApis)) inferred.rsc = 'useful';
  if (!inferred.backend && signals.routeHandlers) inferred.backend = 'bff';
  return validateAnswers(inferred);
}

function makeCandidate(id, label) {
  return { id, label, score: 50, reasons: [], cautions: [] };
}

function adjust(candidate, points, reason, type = 'reason') {
  candidate.score += points;
  candidate[type === 'caution' ? 'cautions' : 'reasons'].push(`${points > 0 ? '+' : ''}${points}: ${reason}`);
}

export function assess(rawAnswers = {}, signals = emptySignals()) {
  const answers = inferAnswers(signals, rawAnswers);
  const candidates = [
    makeCandidate('next', 'Next.js App Router'),
    makeCandidate('react-router', 'React Router Framework Mode'),
    makeCandidate('tanstack-start', 'TanStack Start'),
    makeCandidate('astro', 'Astro'),
    makeCandidate('vite-spa', 'Vite SPA'),
  ];
  const byId = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate]));
  const all = (ids, points, reason, type) => ids.forEach((id) => adjust(byId[id], points, reason, type));

  if (answers.audience === 'public') all(['next', 'react-router', 'tanstack-start', 'astro'], 8, 'public routes benefit from HTML rendering options');
  if (answers.audience === 'authenticated') {
    adjust(byId['vite-spa'], 18, 'authenticated application can often use client rendering');
    adjust(byId.next, -10, 'public initial HTML is not a stated requirement', 'caution');
    adjust(byId.astro, -12, 'application-first authenticated UI is not Astro’s primary strength', 'caution');
  }
  if (answers.audience === 'mixed') all(['next', 'react-router', 'tanstack-start'], 10, 'mixed public/private routes benefit from per-route rendering');

  if (answers.content === 'content') {
    adjust(byId.astro, 28, 'content-heavy output aligns with static-by-default rendering');
    adjust(byId['vite-spa'], -18, 'content-first sites usually benefit from generated HTML', 'caution');
  }
  if (answers.content === 'app') {
    all(['next', 'react-router', 'tanstack-start', 'vite-spa'], 7, 'application UI fits React application stacks');
    adjust(byId.astro, -10, 'highly interactive application increases island coordination', 'caution');
  }
  if (answers.content === 'mixed') all(['next', 'react-router', 'tanstack-start', 'astro'], 5, 'candidate supports mixed static and dynamic routes');

  if (answers.seo === 'high') {
    all(['next', 'react-router', 'tanstack-start', 'astro'], 12, 'SSR or prerendering can deliver crawlable initial HTML');
    adjust(byId['vite-spa'], -22, 'client-only HTML adds crawler and status-code caveats', 'caution');
  }
  if (answers.seo === 'low') adjust(byId['vite-spa'], 8, 'no strong search requirement reduces the value of server rendering');

  if (answers.rendering === 'csr') {
    adjust(byId['vite-spa'], 24, 'CSR is the direct deployment model');
    adjust(byId['react-router'], 10, 'Framework Mode supports SPA mode');
    adjust(byId.next, -8, 'Next.js can run as an SPA but adds unused framework surface', 'caution');
  }
  if (answers.rendering === 'static') {
    adjust(byId.astro, 24, 'static generation is the default');
    all(['next', 'react-router'], 10, 'candidate supports static export or prerendering');
    adjust(byId['vite-spa'], 6, 'static asset hosting is simple, without generated route HTML by default');
  }
  if (answers.rendering === 'ssr') all(['next', 'react-router', 'tanstack-start', 'astro'], 14, 'candidate supports request-time server rendering');
  if (answers.rendering === 'hybrid') {
    adjust(byId.next, 18, 'mature per-route static, server, and client rendering');
    adjust(byId['react-router'], 14, 'SSR plus route prerendering is supported');
    adjust(byId['tanstack-start'], 18, 'selective SSR supports per-route server, client, and data-only modes');
    adjust(byId.astro, 12, 'static-by-default routes can opt into on-demand rendering');
    adjust(byId['vite-spa'], -20, 'hybrid rendering requires a framework or custom SSR integration', 'caution');
  }

  if (answers.serverData === 'complex') {
    adjust(byId.next, 12, 'server components can compose server-only data in the render tree');
    all(['react-router', 'tanstack-start'], 8, 'route loaders and server execution support server data composition');
    adjust(byId['vite-spa'], -12, 'complex server composition moves to a separate API and client orchestration', 'caution');
  }
  if (answers.serverData === 'none') adjust(byId['vite-spa'], 8, 'no server-only composition is required');

  if (answers.rsc === 'required') {
    adjust(byId.next, 35, 'Next.js is the most complete stable RSC framework implementation');
    adjust(byId['react-router'], -25, 'React Router RSC support is marked unstable', 'caution');
    adjust(byId['tanstack-start'], -18, 'framework maturity and RSC implementation require additional validation', 'caution');
    all(['astro', 'vite-spa'], -35, 'does not satisfy the stated RSC requirement', 'caution');
  }
  if (answers.rsc === 'useful') adjust(byId.next, 15, 'RSC can remove server-only component code from the client bundle');
  if (answers.rsc === 'none') {
    adjust(byId.next, -8, 'a primary differentiator is not needed', 'caution');
    all(['react-router', 'vite-spa'], 6, 'avoids an unnecessary RSC boundary');
  }

  if (answers.backend === 'separate') {
    adjust(byId['vite-spa'], 14, 'cleanly consumes a separately owned API');
    all(['react-router', 'tanstack-start'], 7, 'route data APIs can sit over a separate backend');
    adjust(byId.next, -6, 'integrated backend surface is less valuable', 'caution');
  }
  if (answers.backend === 'bff') all(['next', 'react-router', 'tanstack-start'], 10, 'integrated server routes can implement a BFF');
  if (answers.backend === 'none') adjust(byId.astro, 5, 'static content can avoid an application backend');

  if (answers.hosting === 'static') {
    all(['astro', 'vite-spa'], 16, 'deploys directly as static assets');
    all(['next', 'react-router'], 6, 'supports static output with server-only feature limits');
    if (['ssr', 'hybrid'].includes(answers.rendering) || answers.rsc === 'required') {
      all(['next', 'react-router', 'tanstack-start', 'astro'], -18, 'request-time rendering conflicts with static-only hosting', 'caution');
    }
  }
  if (answers.hosting === 'vercel') adjust(byId.next, 10, 'first-party platform integration reduces deployment work');
  if (answers.hosting === 'node') all(['next', 'react-router', 'tanstack-start', 'astro'], 5, 'server deployment is supported');
  if (answers.hosting === 'edge') {
    all(['react-router', 'tanstack-start', 'astro'], 5, 'adapter-based edge deployment is available');
    adjust(byId.next, -3, 'verify every required API against the chosen edge adapter/runtime', 'caution');
  }

  if (answers.maturity === 'strict') {
    adjust(byId['tanstack-start'], -22, 'current official status is pre-1.0/beta and must be rechecked', 'caution');
    all(['next', 'react-router', 'astro', 'vite-spa'], 6, 'established stable option');
  }
  if (answers.maturity === 'experimental') adjust(byId['tanstack-start'], 8, 'team accepts an emerging framework for selective SSR and type-safety benefits');

  const nextSpecificSignals = signals.serverDirectives + signals.routeHandlers + signals.cacheApis + signals.dynamicRequestApis + signals.nextImageImports + signals.nextFontImports;
  if (answers.migration === 'existing-next') {
    adjust(byId.next, Math.min(18, 6 + nextSpecificSignals), 'existing implementation and Next-specific surface create switching cost');
  }

  for (const candidate of candidates) candidate.score = Math.max(0, Math.min(100, candidate.score));
  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const next = candidates.find((candidate) => candidate.id === 'next');
  const best = candidates[0];
  const known = Object.entries(answers).filter(([key, value]) => key !== 'migration' && value !== 'unknown').length;
  let verdict;
  if (known < 3) verdict = 'Insufficient evidence';
  else if (answers.rsc === 'required' && !(answers.hosting === 'static' && ['ssr', 'hybrid'].includes(answers.rendering))) verdict = 'Next.js required';
  else if (best.id === 'next' && next.score >= 70 && next.score - candidates[1].score >= 8) verdict = 'Next.js strong fit';
  else if (next.score >= 55 && next.score >= best.score - 8) verdict = 'Next.js viable but not required';
  else verdict = 'Next.js not justified';

  let action = null;
  if (answers.migration === 'existing-next') {
    const gap = best.score - next.score;
    if (best.id === 'next' || gap < 12) action = 'keep';
    else if (nextSpecificSignals >= 5) action = 'reduce Next-specific surface';
    else action = 'run migration spike';
  }

  const contradictions = [];
  if (answers.hosting === 'static' && ['ssr', 'hybrid'].includes(answers.rendering)) contradictions.push('Static-only hosting conflicts with request-time rendering.');
  if (answers.hosting === 'static' && answers.rsc === 'required') contradictions.push('Runtime RSC needs a server; build-time-only RSC may still be possible.');
  if (answers.audience === 'authenticated' && answers.seo === 'high') contradictions.push('Clarify which authenticated routes are intended to be indexed.');

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    action,
    bestCandidate: verdict === 'Insufficient evidence' ? null : best.id,
    evidenceCoverage: `${known}/9 decision fields known`,
    answers,
    candidates,
    contradictions,
    scan: signals,
    disclaimer: 'Scores are explainable heuristics, not probabilities, benchmarks, or measured business value.',
  };
}

async function promptForAnswers(seed) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers = { ...seed };
  try {
    for (const [key, label, choices] of QUESTIONS) {
      if (answers[key] && answers[key] !== 'unknown') continue;
      const value = (await rl.question(`${label} (${choices}) [unknown]: `)).trim() || 'unknown';
      answers[key] = value;
    }
  } finally {
    rl.close();
  }
  return answers;
}

function formatHuman(result) {
  const lines = [
    `Verdict: ${result.verdict}`,
    result.action ? `Existing-system action: ${result.action}` : null,
    `Best-fit candidate: ${result.bestCandidate ? result.candidates[0].label : 'undetermined'}`,
    `Evidence coverage: ${result.evidenceCoverage}`,
    '',
    'Candidate fit (heuristic):',
    ...result.candidates.map((candidate) => `  ${String(candidate.score).padStart(3)}  ${candidate.label}`),
  ].filter((line) => line !== null);
  if (result.contradictions.length) lines.push('', 'Resolve first:', ...result.contradictions.map((item) => `  - ${item}`));
  lines.push('', result.disclaimer, 'Run with --json to inspect every score adjustment and scan signal.');
  return lines.join('\n');
}

function usage() {
  return `next-or-not [project-path] [--answers file.json] [--json] [--no-prompt]\n\n` +
    `Answer fields: ${Object.keys(ANSWER_VALUES).join(', ')}\n`;
}

function parseArgs(argv) {
  const args = { projectPath: '.', json: false, noPrompt: false, answersPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') args.json = true;
    else if (value === '--no-prompt') args.noPrompt = true;
    else if (value === '--help' || value === '-h') args.help = true;
    else if (value === '--answers') args.answersPath = argv[++index];
    else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`);
    else args.projectPath = value;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const { signals } = await scanProject(args.projectPath);
  let rawAnswers = args.answersPath ? await readJson(path.resolve(args.answersPath)) : {};
  if (!args.answersPath && !args.noPrompt && process.stdin.isTTY && process.stdout.isTTY) {
    rawAnswers = await promptForAnswers(inferAnswers(signals, rawAnswers));
  }
  const result = assess(rawAnswers, signals);
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHuman(result)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`next-or-not: ${error.message}\n`);
    process.exitCode = 1;
  });
}
