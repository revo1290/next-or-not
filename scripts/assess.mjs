#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const IGNORED = new Set([
  '.git', '.next', '.nuxt', '.output', '.turbo', 'build', 'coverage', 'dist',
  'node_modules', 'out', 'storybook-static', 'target', 'vendor',
]);
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_EXAMPLES = 5;

export const EVIDENCE_SNAPSHOT = {
  reviewedAt: '2026-09-14',
  refreshAfter: '2026-10-20',
  activeLtsMajor: 16,
  maintenanceLtsMajors: [15],
  patchedFloors: { 15: '15.5.24', 16: '16.3.3' },
};

function feature() {
  return { count: 0, files: 0, examples: [] };
}

function emptySignals() {
  return {
    packageManager: null,
    packageJsonFiles: 0,
    nextProjects: [],
    sourceFiles: 0,
    sourceFilesSkippedLarge: 0,
    readErrors: 0,
    truncated: false,
    router: 'unknown',
    routes: {
      appPages: feature(),
      appLayouts: feature(),
      appRouteHandlers: feature(),
      pagesRoutes: feature(),
      pagesApiRoutes: feature(),
    },
    features: {
      clientDirectives: feature(), serverDirectives: feature(), cacheDirectives: feature(),
      requestBoundApis: feature(), cacheApis: feature(), nextServerApis: feature(), navigationApis: feature(),
      imageComponent: feature(), fontOptimization: feature(), linkComponent: feature(), scriptComponent: feature(),
      metadataApis: feature(), staticParams: feature(), serverSideProps: feature(), staticProps: feature(),
      staticPaths: feature(), initialProps: feature(), serverOnlyModules: feature(), routeRuntimeConfig: feature(),
      routeRevalidation: feature(), middleware: feature(), proxy: feature(), instrumentation: feature(),
      customServer: feature(), interceptingRoutes: feature(), dynamicAppRoutes: feature(),
      dynamicParamsEnabled: feature(), requestDependentRouteHandlers: feature(), nextImports: feature(),
    },
    config: {
      found: false, examples: [], staticExport: false, standaloneOutput: false, cacheComponents: false,
      customImageLoader: false, imagesUnoptimized: false, rewrites: false, redirects: false,
      headers: false, customWebpack: false, experimentalPpr: false,
    },
    scripts: { nextLint: false },
  };
}

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
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
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
      if (files.length >= MAX_FILES) { truncated = true; break; }
    }
  }
  return { files, truncated };
}

function normalize(root, target) {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

function isInside(target, scope) {
  const relative = path.relative(scope, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function addFeature(target, rel, count = 1) {
  if (!count) return;
  target.count += count;
  target.files += 1;
  if (target.examples.length < MAX_EXAMPLES) target.examples.push(rel);
}

function parseMajor(version) {
  if (typeof version !== 'string') return null;
  const match = version.match(/(?:^|[^0-9])(\d+)\.(?:\d+|x|\*)/i);
  return match ? Number(match[1]) : null;
}

function exactVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
  return match?.[1] ?? null;
}

function compareVersions(left, right) {
  const a = left.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const b = right.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

async function findResolvedNpmVersion(root, projectRoot) {
  const lockPath = path.join(root, 'package-lock.json');
  if (!await exists(lockPath)) return null;
  try {
    const lock = await readJson(lockPath);
    const projectRel = normalize(root, projectRoot);
    const candidates = projectRel === '.' ? ['node_modules/next'] : [`${projectRel}/node_modules/next`, 'node_modules/next'];
    for (const key of candidates) {
      const version = lock.packages?.[key]?.version;
      if (exactVersion(version)) return version;
    }
    const legacy = lock.dependencies?.next?.version;
    return exactVersion(legacy);
  } catch { return null; }
}

function importModules(text) {
  const modules = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](next(?:\/[^'"]*)?)['"]/g,
    /import\(\s*['"](next(?:\/[^'"]*)?)['"]\s*\)/g,
    /require\(\s*['"](next(?:\/[^'"]*)?)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) modules.add(match[1]);
  return modules;
}

function isAppFile(rel, namePattern = '.+') {
  return new RegExp(`^(?:src/)?app/(?:.+/)?${namePattern}\\.(?:js|jsx|ts|tsx)$`).test(rel);
}

function isPagesFile(rel) {
  return /^(?:src\/)?pages\/.+\.(?:js|jsx|ts|tsx)$/.test(rel);
}

function configFlags(text, config) {
  config.staticExport ||= /\boutput\s*:\s*['"]export['"]/.test(text);
  config.standaloneOutput ||= /\boutput\s*:\s*['"]standalone['"]/.test(text);
  config.cacheComponents ||= /\bcacheComponents\s*:\s*true/.test(text);
  config.customImageLoader ||= /\bloader\s*:\s*['"]custom['"]|\bloaderFile\s*:/.test(text);
  config.imagesUnoptimized ||= /\bunoptimized\s*:\s*true/.test(text);
  config.rewrites ||= /\brewrites\s*(?::|\()/.test(text);
  config.redirects ||= /\bredirects\s*(?::|\()/.test(text);
  config.headers ||= /\bheaders\s*(?::|\()/.test(text);
  config.customWebpack ||= /\bwebpack\s*(?::|\()/.test(text);
  config.experimentalPpr ||= /\bexperimental_ppr\b|\bexperimental\s*:\s*\{[^}]*\bppr\s*:/s.test(text);
}

export async function scanProject(projectPath = '.') {
  const root = path.resolve(projectPath);
  const signals = emptySignals();
  const { files, truncated } = await collectFiles(root);
  signals.truncated = truncated;
  const packageFiles = files.filter((file) => path.basename(file) === 'package.json');
  signals.packageJsonFiles = packageFiles.length;

  for (const packageFile of packageFiles) {
    let pkg;
    try { pkg = await readJson(packageFile); } catch { signals.readErrors += 1; continue; }
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    if (!dependencies.next) continue;
    const projectRoot = path.dirname(packageFile);
    const resolvedVersion = await findResolvedNpmVersion(root, projectRoot);
    signals.nextProjects.push({
      path: normalize(root, projectRoot), name: pkg.name ?? null, declaredVersion: dependencies.next,
      resolvedVersion, major: parseMajor(resolvedVersion ?? dependencies.next),
    });
    if (Object.values(pkg.scripts ?? {}).some((value) => /(?:^|\s)next\s+lint(?:\s|$)/.test(value))) signals.scripts.nextLint = true;
  }

  if (await exists(path.join(root, 'pnpm-lock.yaml'))) signals.packageManager = 'pnpm';
  else if (await exists(path.join(root, 'yarn.lock'))) signals.packageManager = 'yarn';
  else if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) signals.packageManager = 'bun';
  else if (await exists(path.join(root, 'package-lock.json'))) signals.packageManager = 'npm';

  const scopes = signals.nextProjects.map((project) => path.resolve(root, project.path));
  if (!scopes.length) return { root, signals };

  for (const file of files) {
    const projectRoot = scopes.find((scope) => isInside(file, scope));
    if (!projectRoot) continue;
    const rel = normalize(projectRoot, file);
    const rootRel = normalize(root, file);
    if (/^(?:src\/)?(?:middleware|proxy)\.(?:js|ts)$/.test(rel)) addFeature(rel.includes('proxy.') ? signals.features.proxy : signals.features.middleware, rootRel);
    if (/^(?:src\/)?instrumentation(?:-client)?\.(?:js|ts)$/.test(rel)) addFeature(signals.features.instrumentation, rootRel);
    if (/^server\.(?:js|mjs|cjs|ts)$/.test(rel)) addFeature(signals.features.customServer, rootRel);
    if (/^next\.config\.(?:js|mjs|cjs|ts)$/.test(rel)) {
      signals.config.found = true;
      signals.config.examples.push(rootRel);
      try { configFlags(await fs.readFile(file, 'utf8'), signals.config); } catch { signals.readErrors += 1; }
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    let stat;
    try { stat = await fs.stat(file); } catch { signals.readErrors += 1; continue; }
    if (stat.size > MAX_FILE_BYTES) { signals.sourceFilesSkippedLarge += 1; continue; }
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { signals.readErrors += 1; continue; }
    signals.sourceFiles += 1;

    const appFile = /^(?:src\/)?app\//.test(rel);
    const pagesFile = isPagesFile(rel);
    if (isAppFile(rel, 'page')) addFeature(signals.routes.appPages, rootRel);
    if (isAppFile(rel, 'layout')) addFeature(signals.routes.appLayouts, rootRel);
    if (isAppFile(rel, 'route') && /export\s+(?:(?:async\s+)?function|const)\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m.test(text)) {
      addFeature(signals.routes.appRouteHandlers, rootRel);
      const requestParam = text.match(/export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*([A-Za-z_$][\w$]*)/)?.[1]
        ?? text.match(/export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/)?.[1];
      if (requestParam && countMatches(text, new RegExp(`\\b${requestParam}\\b`, 'g')) > 1) addFeature(signals.features.requestDependentRouteHandlers, rootRel);
    }
    if (pagesFile && /^(?:src\/)?pages\/api\//.test(rel)) addFeature(signals.routes.pagesApiRoutes, rootRel);
    else if (pagesFile && !/\/(?:_app|_document|_error)\.(?:js|jsx|ts|tsx)$/.test(rel)) addFeature(signals.routes.pagesRoutes, rootRel);
    if (appFile && /(?:^|\/)\(\.\.\)|(?:^|\/)\(\.\)|(?:^|\/)@[^/]+\//.test(rel)) addFeature(signals.features.interceptingRoutes, rootRel);
    if (appFile && /\[[^/]+\]/.test(rel) && /\/(?:page|route)\.(?:js|jsx|ts|tsx)$/.test(rel)) addFeature(signals.features.dynamicAppRoutes, rootRel);

    const modules = importModules(text);
    if (modules.size) addFeature(signals.features.nextImports, rootRel, modules.size);
    if (modules.has('next/headers')) addFeature(signals.features.requestBoundApis, rootRel);
    if (modules.has('next/cache')) addFeature(signals.features.cacheApis, rootRel);
    if (modules.has('next/server')) addFeature(signals.features.nextServerApis, rootRel);
    if (modules.has('next/navigation') || modules.has('next/router')) addFeature(signals.features.navigationApis, rootRel);
    if (modules.has('next/image')) addFeature(signals.features.imageComponent, rootRel);
    if ([...modules].some((module) => module.startsWith('next/font/'))) addFeature(signals.features.fontOptimization, rootRel);
    if (modules.has('next/link')) addFeature(signals.features.linkComponent, rootRel);
    if (modules.has('next/script')) addFeature(signals.features.scriptComponent, rootRel);
    if (/(?:import\s+['"]server-only['"]|require\(\s*['"]server-only['"]\s*\))/.test(text)) addFeature(signals.features.serverOnlyModules, rootRel);
    if (modules.has('next') && /^server\.(?:js|mjs|cjs|ts)$/.test(rel)) addFeature(signals.features.customServer, rootRel);

    addFeature(signals.features.clientDirectives, rootRel, countMatches(text, /^[\t ]*['"]use client['"];?/gm));
    addFeature(signals.features.serverDirectives, rootRel, countMatches(text, /^[\t ]*['"]use server['"];?/gm));
    addFeature(signals.features.cacheDirectives, rootRel, countMatches(text, /^[\t ]*['"]use cache(?:: (?:private|remote))?['"];?/gm));
    if (appFile && /\bexport\s+(?:async\s+function\s+generateMetadata|const\s+metadata\b|function\s+generateMetadata)/m.test(text)) addFeature(signals.features.metadataApis, rootRel);
    if (appFile && /\bexport\s+(?:async\s+)?function\s+generateStaticParams\b|\bexport\s+const\s+generateStaticParams\b/m.test(text)) addFeature(signals.features.staticParams, rootRel);
    if (pagesFile && /\bexport\s+(?:const|async\s+function|function)\s+getServerSideProps\b/m.test(text)) addFeature(signals.features.serverSideProps, rootRel);
    if (pagesFile && /\bexport\s+(?:const|async\s+function|function)\s+getStaticProps\b/m.test(text)) addFeature(signals.features.staticProps, rootRel);
    if (pagesFile && /\bexport\s+(?:const|async\s+function|function)\s+getStaticPaths\b/m.test(text)) addFeature(signals.features.staticPaths, rootRel);
    if (pagesFile && /\bgetInitialProps\s*=|\.getInitialProps\s*=|\bstatic\s+(?:async\s+)?getInitialProps\b/m.test(text)) addFeature(signals.features.initialProps, rootRel);
    if (appFile && /\bexport\s+const\s+runtime\s*=/.test(text)) addFeature(signals.features.routeRuntimeConfig, rootRel);
    if (appFile && /\bexport\s+const\s+revalidate\s*=/.test(text)) addFeature(signals.features.routeRevalidation, rootRel);
    if (appFile && /\bexport\s+const\s+dynamicParams\s*=\s*true\b/.test(text)) addFeature(signals.features.dynamicParamsEnabled, rootRel);
  }

  const appRoutes = signals.routes.appPages.files + signals.routes.appLayouts.files + signals.routes.appRouteHandlers.files;
  const pagesRoutes = signals.routes.pagesRoutes.files + signals.routes.pagesApiRoutes.files;
  signals.router = appRoutes && pagesRoutes ? 'mixed' : appRoutes ? 'app' : pagesRoutes ? 'pages' : 'unknown';
  return { root, signals };
}

function supportStatus(project) {
  const { major, resolvedVersion } = project;
  if (!major) return { status: 'unknown', detail: 'Next.js major version could not be resolved.' };
  if (resolvedVersion?.includes('-')) return { status: 'prerelease', detail: `${resolvedVersion} is a pre-release build; official policy does not recommend canary for production traffic.` };
  if (major === EVIDENCE_SNAPSHOT.activeLtsMajor) {
    const floor = EVIDENCE_SNAPSHOT.patchedFloors[major];
    if (resolvedVersion && compareVersions(resolvedVersion, floor) < 0) return { status: 'patch-review', detail: `${resolvedVersion} is below the ${floor} patched release in the evidence snapshot.` };
    return { status: 'active-lts', detail: `${major}.x is Active LTS in the evidence snapshot.` };
  }
  if (EVIDENCE_SNAPSHOT.maintenanceLtsMajors.includes(major)) {
    const floor = EVIDENCE_SNAPSHOT.patchedFloors[major];
    if (resolvedVersion && compareVersions(resolvedVersion, floor) < 0) return { status: 'patch-review', detail: `${resolvedVersion} is below the ${floor} patched release in the evidence snapshot.` };
    return { status: 'maintenance-lts', detail: `${major}.x is Maintenance LTS in the evidence snapshot.` };
  }
  if (major < Math.min(...EVIDENCE_SNAPSHOT.maintenanceLtsMajors)) return { status: 'unsupported', detail: `${major}.x is outside the documented LTS versions in the evidence snapshot.` };
  return { status: 'snapshot-unknown', detail: `${major}.x is newer than the bundled support-policy snapshot.` };
}

function evidence(label, value) {
  if (!value.files) return null;
  return `${label}: ${value.files} file(s)${value.examples.length ? ` (${value.examples.join(', ')})` : ''}`;
}

function staticExportConflicts(signals) {
  if (!signals.config.staticExport) return [];
  const f = signals.features;
  const r = signals.routes;
  return [
    f.requestBoundApis.files && 'request-bound APIs (`cookies`, `headers`, or related imports)',
    f.serverDirectives.files && 'Server Actions / `use server`',
    f.middleware.files && '`middleware`', f.proxy.files && '`proxy`',
    signals.config.rewrites && 'rewrites in next.config', signals.config.redirects && 'redirects in next.config',
    signals.config.headers && 'headers in next.config', f.routeRevalidation.files && 'route revalidation / ISR configuration',
    f.interceptingRoutes.files && 'intercepting or parallel routes',
    f.dynamicParamsEnabled.files && 'dynamicParams: true',
    f.dynamicAppRoutes.files && !f.staticParams.files && 'dynamic App Router routes without detected generateStaticParams',
    f.requestDependentRouteHandlers.files && 'Route Handlers that use the incoming Request',
    f.imageComponent.files && !signals.config.customImageLoader && !signals.config.imagesUnoptimized && '`next/image` without a detected custom loader or unoptimized mode',
    r.pagesApiRoutes.files && 'Pages API routes',
  ].filter(Boolean);
}

export function auditContinuation(signals = emptySignals(), now = new Date()) {
  if (!signals.nextProjects.length) {
    return {
      applicable: false, recommendation: 'not-applicable',
      confidence: { level: 'high', basis: ['No package.json declaring `next` was found in the scanned tree.'] },
      summary: 'This repository was not identified as a Next.js project.', dimensions: null, findings: [],
      unknowns: ['A dynamically generated or non-package.json dependency declaration may not be visible to the scanner.'],
      nextSteps: ['Point the CLI at the Next.js workspace directory if this is a monorepo.'],
    };
  }

  const f = signals.features;
  const r = signals.routes;
  const support = signals.nextProjects.map((project) => ({ ...project, support: supportStatus(project) }));
  const strongServerFiles = new Set([
    ...r.appRouteHandlers.examples, ...r.pagesApiRoutes.examples, ...f.serverDirectives.examples,
    ...f.requestBoundApis.examples, ...f.cacheApis.examples, ...f.serverSideProps.examples,
    ...f.initialProps.examples, ...f.proxy.examples, ...f.middleware.examples, ...f.customServer.examples,
  ]).size;
  const serverCategoryCount = [
    r.appRouteHandlers.files + r.pagesApiRoutes.files, f.serverDirectives.files, f.requestBoundApis.files,
    f.cacheApis.files + f.cacheDirectives.files + Number(signals.config.cacheComponents),
    f.serverSideProps.files + f.initialProps.files + f.serverOnlyModules.files,
    f.proxy.files + f.middleware.files, f.customServer.files,
  ].filter(Boolean).length;
  const frameworkValueLevel = serverCategoryCount >= 3 || strongServerFiles >= 8 ? 'high' : serverCategoryCount >= 1 || signals.router === 'app' ? 'medium' : 'low';

  const routeFiles = r.appPages.files + r.appLayouts.files + r.appRouteHandlers.files + r.pagesRoutes.files + r.pagesApiRoutes.files;
  const coupledFiles = f.nextImports.files + routeFiles + f.middleware.files + f.proxy.files + f.instrumentation.files;
  const couplingRatio = signals.sourceFiles ? Math.min(1, coupledFiles / signals.sourceFiles) : null;
  const migrationCouplingLevel = serverCategoryCount >= 3 || coupledFiles >= 25 || (signals.sourceFiles >= 20 && couplingRatio !== null && couplingRatio >= 0.45)
    ? 'high' : coupledFiles >= 6 || serverCategoryCount >= 1 || (signals.sourceFiles >= 10 && couplingRatio !== null && couplingRatio >= 0.15) ? 'medium' : 'low';

  const maintenanceEvidence = [];
  const supportStatuses = support.map((project) => project.support.status);
  if (supportStatuses.includes('unsupported')) maintenanceEvidence.push('At least one Next.js project is outside the bundled LTS policy.');
  if (supportStatuses.includes('prerelease')) maintenanceEvidence.push('At least one project resolves to a pre-release Next.js build.');
  if (supportStatuses.includes('patch-review')) maintenanceEvidence.push('An exact installed version is below a patched release recorded in the evidence snapshot.');
  if (supportStatuses.includes('maintenance-lts')) maintenanceEvidence.push('At least one project is on Maintenance LTS.');
  if (supportStatuses.includes('unknown') || supportStatuses.includes('snapshot-unknown')) maintenanceEvidence.push('Support status could not be established from the snapshot.');
  if (signals.router === 'mixed') maintenanceEvidence.push('App Router and Pages Router coexist.');
  if (f.middleware.files && support.some((project) => project.major >= 16)) maintenanceEvidence.push('`middleware` is deprecated in Next.js 16 in favor of `proxy`.');
  if (signals.scripts.nextLint && support.some((project) => project.major >= 16)) maintenanceEvidence.push('A package script still invokes the removed `next lint` command.');
  if (signals.config.experimentalPpr && support.some((project) => project.major >= 16)) maintenanceEvidence.push('Removed experimental PPR configuration was detected.');
  const modernizationBlocker = (f.middleware.files && support.some((project) => project.major >= 16)) ||
    (signals.scripts.nextLint && support.some((project) => project.major >= 16)) ||
    (signals.config.experimentalPpr && support.some((project) => project.major >= 16));
  const highMaintenance = supportStatuses.some((status) => ['unsupported', 'patch-review', 'prerelease'].includes(status)) || modernizationBlocker;
  const maintenanceRiskLevel = highMaintenance ? 'high' : maintenanceEvidence.length ? 'medium' : 'low';

  const exportConflicts = staticExportConflicts(signals);
  const appComponentFiles = r.appPages.files + r.appLayouts.files;
  const clientShare = appComponentFiles ? Math.min(1, f.clientDirectives.files / appComponentFiles) : null;
  const staticLean = signals.config.staticExport && !exportConflicts.length;
  const clientLean = clientShare !== null && clientShare >= 0.6 && serverCategoryCount === 0;
  const portabilityLevel = frameworkValueLevel === 'high' ? 'low' : staticLean || clientLean ? 'high' : frameworkValueLevel === 'low' ? 'medium' : 'low';

  const confidenceBasis = [];
  if (signals.truncated) confidenceBasis.push(`File scan stopped at ${MAX_FILES} files.`);
  if (signals.readErrors) confidenceBasis.push(`${signals.readErrors} file(s) could not be parsed or read.`);
  if (signals.sourceFilesSkippedLarge) confidenceBasis.push(`${signals.sourceFilesSkippedLarge} source file(s) exceeded the size limit.`);
  if (signals.nextProjects.length > 1) confidenceBasis.push(`${signals.nextProjects.length} Next.js workspaces were aggregated; audit each workspace separately for a final decision.`);
  if (signals.router === 'unknown') confidenceBasis.push('No App Router or Pages Router route files were identified.');
  if (!support.some((project) => project.resolvedVersion)) confidenceBasis.push('No exact installed Next.js version was resolved from package-lock.json.');
  let confidenceLevel = signals.truncated || signals.readErrors > 5 || signals.router === 'unknown' ? 'low' : confidenceBasis.length ? 'medium' : 'high';
  if (now > new Date(`${EVIDENCE_SNAPSHOT.refreshAfter}T23:59:59Z`)) {
    confidenceBasis.push(`Framework support evidence is stale after ${EVIDENCE_SNAPSHOT.refreshAfter}.`);
    if (confidenceLevel === 'high') confidenceLevel = 'medium';
  }

  let recommendation;
  if (confidenceLevel === 'low') recommendation = 'insufficient-evidence';
  else if (maintenanceRiskLevel === 'high' || exportConflicts.length) recommendation = 'modernize-first';
  else if (frameworkValueLevel === 'high') recommendation = 'keep';
  else if (portabilityLevel === 'high' && migrationCouplingLevel === 'low') recommendation = 'migration-candidate';
  else if (frameworkValueLevel === 'low' || portabilityLevel === 'high') recommendation = 'keep-and-simplify';
  else recommendation = 'keep';

  const combinedCache = { files: f.cacheApis.files + f.cacheDirectives.files, examples: [...new Set([...f.cacheApis.examples, ...f.cacheDirectives.examples])].slice(0, MAX_EXAMPLES) };
  const combinedProxy = { files: f.proxy.files + f.middleware.files, examples: [...f.proxy.examples, ...f.middleware.examples].slice(0, MAX_EXAMPLES) };
  const findings = [
    `Detected ${signals.router} router usage across ${routeFiles} route-related file(s).`,
    ...support.map((project) => `${project.path}: ${project.resolvedVersion ?? project.declaredVersion} — ${project.support.detail}`),
    evidence('Route Handlers', r.appRouteHandlers), evidence('Pages API routes', r.pagesApiRoutes),
    evidence('Server Actions', f.serverDirectives), evidence('Request-bound APIs', f.requestBoundApis),
    evidence('Cache APIs/directives', combinedCache), evidence('Request-time Pages rendering', f.serverSideProps),
    evidence('Proxy or middleware', combinedProxy), signals.config.staticExport ? 'Static export is configured.' : null,
    exportConflicts.length ? `Static-export conflicts detected: ${exportConflicts.join('; ')}.` : null,
    ...maintenanceEvidence,
  ].filter(Boolean);

  const unknowns = [
    'Repository scanning cannot establish production traffic, user-visible latency, hosting spend, incident rate, or team delivery pain.',
    'Source patterns do not prove which routes execute dynamically in the deployed build.',
    !support.some((project) => project.resolvedVersion) ? 'The installed Next.js patch version is unknown without a supported lockfile resolution.' : null,
    signals.nextProjects.length > 1 ? 'Aggregated monorepo results can hide materially different application profiles.' : null,
  ].filter(Boolean);

  const nextSteps = [];
  if (recommendation === 'modernize-first') nextSteps.push('Patch or upgrade Next.js and remove detected deprecated/contradictory configuration before comparing architectures.');
  if (signals.router === 'mixed') nextSteps.push('Inventory routes by router and identify the owner and migration plan for each Pages Router route.');
  if (exportConflicts.length) nextSteps.push('Run `next build` in CI and resolve each static-export conflict; do not infer deployability from config alone.');
  if (recommendation === 'migration-candidate') nextSteps.push('Rebuild one representative route outside Next.js and compare deploy steps, client output, response semantics, and maintenance effort.');
  else if (recommendation === 'keep-and-simplify') nextSteps.push('Keep delivery stable while reducing unnecessary Next-specific imports at new boundaries; reassess after measuring a representative route.');
  else if (recommendation === 'keep') nextSteps.push('Document which detected server capabilities justify Next.js and add regression coverage for their cache and runtime behavior.');
  nextSteps.push('Add project evidence for hosting constraints, operational pain, and migration budget before authorizing a rewrite.');

  return {
    applicable: true, recommendation, confidence: { level: confidenceLevel, basis: confidenceBasis.length ? confidenceBasis : ['Complete source scan, recognized router, and exact npm lockfile version.'] },
    summary: { keepValue: frameworkValueLevel, migrationCoupling: migrationCouplingLevel, maintenanceRisk: maintenanceRiskLevel, portabilityOpportunity: portabilityLevel },
    profile: {
      router: signals.router, nextProjects: support, routeFiles, strongServerFiles, serverCapabilityCategories: serverCategoryCount,
      couplingFiles: coupledFiles, couplingRatio: couplingRatio === null ? null : Number(couplingRatio.toFixed(3)),
      clientDirectiveShareOfAppEntries: clientShare === null ? null : Number(clientShare.toFixed(3)), staticExport: signals.config.staticExport,
    },
    dimensions: {
      keepValue: { level: frameworkValueLevel, meaning: 'Detected Next.js server/runtime capabilities that would need an explicit replacement.' },
      migrationCoupling: { level: migrationCouplingLevel, meaning: 'Breadth of routing, imports, and server semantics tied to Next.js.' },
      maintenanceRisk: { level: maintenanceRiskLevel, meaning: 'Support-policy, patch, deprecation, and mixed-router signals.' },
      portabilityOpportunity: { level: portabilityLevel, meaning: 'Evidence that the application is static/client-leaning with limited server coupling.' },
    },
    findings, unknowns, nextSteps,
  };
}

function formatHuman(result) {
  const audit = result.continuation;
  const lines = [`Recommendation: ${audit.recommendation}`, `Confidence: ${audit.confidence.level}`];
  if (audit.applicable) {
    lines.push(`Router: ${audit.profile.router}`, '', 'Decision dimensions:',
      `  Keep value:              ${audit.summary.keepValue}`,
      `  Migration coupling:      ${audit.summary.migrationCoupling}`,
      `  Maintenance risk:        ${audit.summary.maintenanceRisk}`,
      `  Portability opportunity: ${audit.summary.portabilityOpportunity}`);
  } else lines.push(audit.summary);
  lines.push('', 'Observed findings:', ...audit.findings.map((item) => `  - ${item}`));
  if (audit.confidence.basis.length) lines.push('', 'Confidence limits:', ...audit.confidence.basis.map((item) => `  - ${item}`));
  lines.push('', 'Unknown from source alone:', ...audit.unknowns.map((item) => `  - ${item}`));
  lines.push('', 'Next checks:', ...audit.nextSteps.map((item) => `  - ${item}`));
  lines.push('', 'This is migration triage, not authorization to rewrite. Use --json for file-level evidence.');
  return lines.join('\n');
}

function usage() {
  return ['next-or-not [project-path] [--json]', '', 'Audit an existing Next.js repository for keep value, migration coupling,',
    'maintenance risk, and portability opportunity. The scan is read-only and',
    'does not execute project code or send source files over the network.'].join('\n');
}

function parseArgs(argv) {
  const args = { projectPath: '.', json: false };
  for (const value of argv) {
    if (value === '--json') args.json = true;
    else if (value === '--help' || value === '-h') args.help = true;
    else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`);
    else args.projectPath = value;
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }
  const { root, signals } = await scanProject(args.projectPath);
  const result = { schemaVersion: 2, generatedAt: new Date().toISOString(), evidenceSnapshot: EVIDENCE_SNAPSHOT, projectRoot: root, continuation: auditContinuation(signals), scan: signals };
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatHuman(result)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`next-or-not: ${error.message}\n`); process.exitCode = 1; });
}
