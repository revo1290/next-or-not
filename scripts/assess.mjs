#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { analyzeSourceAst, analyzeSourceFallback } from './analyzers/ast.mjs';
import {
  createTranslator, DEFAULT_LOCALE, displayWidth, localize, msg, padToWidth, resolveLocale, SUPPORTED_LOCALES,
} from './i18n/index.mjs';
import { createNextVersionResolver } from './resolvers/next-version.mjs';
import {
  integrateHumanEvidence, loadHumanContext, normalizeHumanContext, promptForHumanContext,
} from './human-evidence.mjs';

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
  const result = { count: 0, files: 0, examples: [], evidence: [] };
  Object.defineProperty(result, '_files', { value: new Set(), enumerable: false });
  return result;
}

function emptySignals() {
  return {
    packageManager: null,
    versionResolution: { lockfile: null, errors: [] },
    packageJsonFiles: 0,
    nextProjects: [],
    sourceFiles: 0,
    sourceFilesSkippedLarge: 0,
    readErrors: 0,
    truncated: false,
    analysis: {
      parser: '@babel/parser', parsedFiles: 0, fallbackFiles: 0, failedFiles: 0,
      failures: [], unusedNextImports: [],
    },
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

function addFeature(target, rel, count = 1, detail = {}) {
  if (!count) return;
  target.count += count;
  const newFile = !target._files.has(rel);
  if (newFile) {
    target._files.add(rel);
    target.files += 1;
    if (target.examples.length < MAX_EXAMPLES) target.examples.push(rel);
  }
  if (target.evidence.length < 25) target.evidence.push({
    file: rel,
    line: detail.line ?? null,
    detectionMethod: detail.detectionMethod ?? 'filesystem',
    ...(detail.detail ? { detail: detail.detail } : {}),
  });
}

function parseMajor(version) {
  if (typeof version !== 'string') return null;
  const match = version.match(/(?:^|[^0-9])(\d+)\.(?:\d+|x|\*)/i);
  return match ? Number(match[1]) : null;
}

function compareVersions(left, right) {
  const a = left.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const b = right.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function isAppFile(rel, namePattern = '.+') {
  return new RegExp(`^(?:src/)?app/(?:.+/)?${namePattern}\\.(?:js|jsx|ts|tsx)$`).test(rel);
}

function isPagesFile(rel) {
  return /^(?:src\/)?pages\/.+\.(?:js|jsx|ts|tsx)$/.test(rel);
}

function applyConfigFlags(source, target) {
  for (const [name, value] of Object.entries(source)) if (value === true) target[name] = true;
}

export async function scanProject(projectPath = '.') {
  const root = path.resolve(projectPath);
  const signals = emptySignals();
  const { files, truncated } = await collectFiles(root);
  signals.truncated = truncated;
  const packageFiles = files.filter((file) => path.basename(file) === 'package.json');
  signals.packageJsonFiles = packageFiles.length;
  const versionResolver = await createNextVersionResolver(root);
  signals.packageManager = versionResolver.packageManager;
  signals.versionResolution = { lockfile: versionResolver.lockfile, errors: versionResolver.errors };

  for (const packageFile of packageFiles) {
    let pkg;
    try { pkg = await readJson(packageFile); } catch { signals.readErrors += 1; continue; }
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    if (!dependencies.next) continue;
    const projectRoot = path.dirname(packageFile);
    const version = await versionResolver.resolve(projectRoot, dependencies.next);
    signals.nextProjects.push({
      path: normalize(root, projectRoot), name: pkg.name ?? null, declaredVersion: dependencies.next,
      resolvedVersion: version.resolvedVersion,
      versionSource: version.resolution.source,
      resolution: version.resolution,
      resolutionWarnings: version.warnings,
      resolutionErrors: version.errors,
      resolutionCandidates: version.candidates,
      major: parseMajor(version.resolvedVersion ?? dependencies.next),
    });
    if (Object.values(pkg.scripts ?? {}).some((value) => /(?:^|\s)next\s+lint(?:\s|$)/.test(value))) signals.scripts.nextLint = true;
  }

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
    const configFile = /^next\.config\.(?:js|mjs|cjs|ts)$/.test(rel);
    if (configFile) {
      signals.config.found = true;
      signals.config.examples.push(rootRel);
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
    let stat;
    try { stat = await fs.stat(file); } catch { signals.readErrors += 1; continue; }
    if (stat.size > MAX_FILE_BYTES) { signals.sourceFilesSkippedLarge += 1; continue; }
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { signals.readErrors += 1; continue; }
    if (!configFile) signals.sourceFiles += 1;

    const appFile = /^(?:src\/)?app\//.test(rel);
    const pagesFile = isPagesFile(rel);
    if (isAppFile(rel, 'page')) addFeature(signals.routes.appPages, rootRel);
    if (isAppFile(rel, 'layout')) addFeature(signals.routes.appLayouts, rootRel);
    if (pagesFile && /^(?:src\/)?pages\/api\//.test(rel)) addFeature(signals.routes.pagesApiRoutes, rootRel);
    else if (pagesFile && !/\/(?:_app|_document|_error)\.(?:js|jsx|ts|tsx)$/.test(rel)) addFeature(signals.routes.pagesRoutes, rootRel);
    if (appFile && /(?:^|\/)\(\.\.\)|(?:^|\/)\(\.\)|(?:^|\/)@[^/]+\//.test(rel)) addFeature(signals.features.interceptingRoutes, rootRel);
    if (appFile && /\[[^/]+\]/.test(rel) && /\/(?:page|route)\.(?:js|jsx|ts|tsx)$/.test(rel)) addFeature(signals.features.dynamicAppRoutes, rootRel);

    let analysis;
    try {
      analysis = analyzeSourceAst(text, rootRel);
      signals.analysis.parsedFiles += 1;
    } catch (error) {
      analysis = analyzeSourceFallback(text);
      signals.analysis.fallbackFiles += 1;
      signals.analysis.failedFiles += 1;
      if (signals.analysis.failures.length < 100) signals.analysis.failures.push({
        file: rootRel,
        message: error.message,
        detectionMethod: 'regex-fallback',
      });
    }
    const method = analysis.detectionMethod;
    if (configFile) {
      applyConfigFlags(analysis.config, signals.config);
      continue;
    }

    for (const item of analysis.unusedImports) {
      if ((item.module === 'next' || item.module.startsWith('next/')) && signals.analysis.unusedNextImports.length < 100) {
        signals.analysis.unusedNextImports.push({ file: rootRel, ...item, detectionMethod: method });
      }
    }

    const importsByModule = new Map();
    for (const item of analysis.imports) {
      const items = importsByModule.get(item.module) ?? [];
      items.push(item);
      importsByModule.set(item.module, items);
    }
    const nextModules = [...importsByModule.keys()].filter((name) => name === 'next' || name.startsWith('next/'));
    if (nextModules.length) addFeature(signals.features.nextImports, rootRel, nextModules.length, {
      line: nextModules.flatMap((name) => importsByModule.get(name)).find((item) => item.line)?.line ?? null,
      detectionMethod: method,
      detail: nextModules.join(', '),
    });
    const addModuleFeature = (name, target) => {
      const items = importsByModule.get(name);
      if (items?.length) addFeature(target, rootRel, items.length, { line: items[0].line, detectionMethod: method, detail: name });
    };
    addModuleFeature('next/headers', signals.features.requestBoundApis);
    addModuleFeature('next/cache', signals.features.cacheApis);
    addModuleFeature('next/server', signals.features.nextServerApis);
    if (importsByModule.has('next/navigation') || importsByModule.has('next/router')) {
      const item = importsByModule.get('next/navigation')?.[0] ?? importsByModule.get('next/router')[0];
      addFeature(signals.features.navigationApis, rootRel, 1, { line: item.line, detectionMethod: method, detail: item.module });
    }
    addModuleFeature('next/image', signals.features.imageComponent);
    const fontImport = analysis.imports.find((item) => item.module.startsWith('next/font/'));
    if (fontImport) addFeature(signals.features.fontOptimization, rootRel, 1, { line: fontImport.line, detectionMethod: method, detail: fontImport.module });
    addModuleFeature('next/link', signals.features.linkComponent);
    addModuleFeature('next/script', signals.features.scriptComponent);
    addModuleFeature('server-only', signals.features.serverOnlyModules);
    if (importsByModule.has('next') && /^server\.(?:js|mjs|cjs|ts)$/.test(rel)) {
      addFeature(signals.features.customServer, rootRel, 1, { line: importsByModule.get('next')[0].line, detectionMethod: method });
    }

    for (const directive of analysis.directives) {
      const detail = { line: directive.line, detectionMethod: method, detail: directive.value };
      if (directive.value === 'use client') addFeature(signals.features.clientDirectives, rootRel, 1, detail);
      else if (directive.value === 'use server') addFeature(signals.features.serverDirectives, rootRel, 1, detail);
      else if (/^use cache(?:: (?:private|remote))?$/.test(directive.value)) addFeature(signals.features.cacheDirectives, rootRel, 1, detail);
    }

    if (isAppFile(rel, 'route') && analysis.routeHandlers.length) {
      addFeature(signals.routes.appRouteHandlers, rootRel, analysis.routeHandlers.length, {
        line: analysis.routeHandlers[0].line, detectionMethod: method,
        detail: analysis.routeHandlers.map((item) => item.name).join(', '),
      });
    }
    for (const item of analysis.exportedFeatures) {
      const permitted = item.name === 'requestDependentRouteHandlers' ? isAppFile(rel, 'route')
        : ['serverSideProps', 'staticProps', 'staticPaths'].includes(item.name) ? pagesFile
          : ['metadataApis', 'staticParams', 'routeRuntimeConfig', 'routeRevalidation', 'dynamicParamsEnabled'].includes(item.name) ? appFile
            : true;
      if (permitted) addFeature(signals.features[item.name], rootRel, 1, { line: item.line, detectionMethod: method });
    }
    if (pagesFile) for (const line of analysis.initialProps) {
      addFeature(signals.features.initialProps, rootRel, 1, { line, detectionMethod: method });
    }
  }

  const appRoutes = signals.routes.appPages.files + signals.routes.appLayouts.files + signals.routes.appRouteHandlers.files;
  const pagesRoutes = signals.routes.pagesRoutes.files + signals.routes.pagesApiRoutes.files;
  signals.router = appRoutes && pagesRoutes ? 'mixed' : appRoutes ? 'app' : pagesRoutes ? 'pages' : 'unknown';
  return { root, signals };
}

function supportStatus(project) {
  const { major, resolvedVersion } = project;
  if (!major) return { status: 'unknown', detail: msg('support.unknown') };
  if (resolvedVersion?.includes('-')) return { status: 'prerelease', detail: msg('support.prerelease', { version: resolvedVersion }) };
  const known = major === EVIDENCE_SNAPSHOT.activeLtsMajor || EVIDENCE_SNAPSHOT.maintenanceLtsMajors.includes(major);
  if (known) {
    const floor = EVIDENCE_SNAPSHOT.patchedFloors[major];
    if (resolvedVersion && compareVersions(resolvedVersion, floor) < 0) {
      return { status: 'patch-review', detail: msg('support.patchReview', { version: resolvedVersion, floor }) };
    }
    return major === EVIDENCE_SNAPSHOT.activeLtsMajor
      ? { status: 'active-lts', detail: msg('support.activeLts', { major }) }
      : { status: 'maintenance-lts', detail: msg('support.maintenanceLts', { major }) };
  }
  if (major < Math.min(...EVIDENCE_SNAPSHOT.maintenanceLtsMajors)) return { status: 'unsupported', detail: msg('support.unsupported', { major }) };
  return { status: 'snapshot-unknown', detail: msg('support.snapshotUnknown', { major }) };
}

function evidence(labelId, value) {
  if (!value.files) return null;
  return msg('finding.evidence', { label: msg(labelId), files: value.files, examples: value.examples });
}

function staticExportConflicts(signals) {
  if (!signals.config.staticExport) return [];
  const f = signals.features;
  const r = signals.routes;
  return [
    f.requestBoundApis.files && 'conflict.requestBoundApis',
    f.serverDirectives.files && 'conflict.serverActions',
    f.middleware.files && 'conflict.middleware', f.proxy.files && 'conflict.proxy',
    signals.config.rewrites && 'conflict.rewrites', signals.config.redirects && 'conflict.redirects',
    signals.config.headers && 'conflict.headers', f.routeRevalidation.files && 'conflict.routeRevalidation',
    f.interceptingRoutes.files && 'conflict.interceptingRoutes',
    f.dynamicParamsEnabled.files && 'conflict.dynamicParams',
    f.dynamicAppRoutes.files && !f.staticParams.files && 'conflict.dynamicRoutesWithoutStaticParams',
    f.requestDependentRouteHandlers.files && 'conflict.requestDependentRouteHandlers',
    f.imageComponent.files && !signals.config.customImageLoader && !signals.config.imagesUnoptimized && 'conflict.imageWithoutLoader',
    r.pagesApiRoutes.files && 'conflict.pagesApiRoutes',
  ].filter(Boolean).map((id) => msg(id));
}

export function auditContinuation(signals = emptySignals(), now = new Date()) {
  if (!signals.nextProjects.length) {
    return {
      applicable: false, recommendation: 'not-applicable',
      confidence: { level: 'high', basis: [msg('notApplicable.confidence')] },
      summary: msg('notApplicable.summary'), dimensions: null, findings: [],
      unknowns: [msg('notApplicable.unknown')],
      nextSteps: [msg('notApplicable.nextStep')],
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
  if (supportStatuses.includes('unsupported')) maintenanceEvidence.push(msg('maintenance.unsupported'));
  if (supportStatuses.includes('prerelease')) maintenanceEvidence.push(msg('maintenance.prerelease'));
  if (supportStatuses.includes('patch-review')) maintenanceEvidence.push(msg('maintenance.patchReview'));
  if (supportStatuses.includes('maintenance-lts')) maintenanceEvidence.push(msg('maintenance.maintenanceLts'));
  if (supportStatuses.includes('unknown') || supportStatuses.includes('snapshot-unknown')) maintenanceEvidence.push(msg('maintenance.unknownStatus'));
  if (signals.router === 'mixed') maintenanceEvidence.push(msg('maintenance.mixedRouter'));
  if (f.middleware.files && support.some((project) => project.major >= 16)) maintenanceEvidence.push(msg('maintenance.middlewareDeprecated'));
  if (signals.scripts.nextLint && support.some((project) => project.major >= 16)) maintenanceEvidence.push(msg('maintenance.nextLintRemoved'));
  if (signals.config.experimentalPpr && support.some((project) => project.major >= 16)) maintenanceEvidence.push(msg('maintenance.experimentalPpr'));
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
  if (signals.truncated) confidenceBasis.push(msg('confidence.truncated', { max: MAX_FILES }));
  if (signals.readErrors) confidenceBasis.push(msg('confidence.readErrors', { count: signals.readErrors }));
  if (signals.analysis?.failedFiles) confidenceBasis.push(msg('confidence.parseFailures', { count: signals.analysis.failedFiles }));
  if (signals.sourceFilesSkippedLarge) confidenceBasis.push(msg('confidence.largeFiles', { count: signals.sourceFilesSkippedLarge }));
  const resolutionWarnings = support.flatMap((project) => project.resolutionWarnings ?? []);
  const resolutionErrors = support.flatMap((project) => project.resolutionErrors ?? []);
  if (resolutionWarnings.length) confidenceBasis.push(msg('confidence.resolutionWarnings', { count: resolutionWarnings.length }));
  if (resolutionErrors.length || signals.versionResolution?.errors?.length) confidenceBasis.push(msg('confidence.lockfileUnresolved'));
  if (signals.nextProjects.length > 1) confidenceBasis.push(msg('confidence.multipleWorkspaces', { count: signals.nextProjects.length }));
  if (signals.router === 'unknown') confidenceBasis.push(msg('confidence.unknownRouter'));
  if (support.some((project) => !project.resolvedVersion)) confidenceBasis.push(msg('confidence.noExactVersion'));
  let confidenceLevel = signals.truncated || signals.readErrors > 5 || (signals.analysis?.failedFiles ?? 0) > 5 || signals.router === 'unknown'
    ? 'low' : confidenceBasis.length ? 'medium' : 'high';
  if (now > new Date(`${EVIDENCE_SNAPSHOT.refreshAfter}T23:59:59Z`)) {
    confidenceBasis.push(msg('confidence.staleEvidence', { date: EVIDENCE_SNAPSHOT.refreshAfter }));
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
    msg('finding.router', { router: msg(`router.${signals.router}`), count: routeFiles }),
    ...support.map((project) => msg('finding.workspaceVersion', {
      path: project.path,
      version: project.resolvedVersion ?? project.declaredVersion,
      source: `${project.resolution?.source ?? 'unknown'}${project.resolution?.file ? `: ${project.resolution.file}` : ''}`,
      detail: project.support.detail,
    })),
    ...resolutionWarnings,
    evidence('evidence.routeHandlers', r.appRouteHandlers), evidence('evidence.pagesApiRoutes', r.pagesApiRoutes),
    evidence('evidence.serverActions', f.serverDirectives), evidence('evidence.requestBoundApis', f.requestBoundApis),
    evidence('evidence.cache', combinedCache), evidence('evidence.serverSideProps', f.serverSideProps),
    evidence('evidence.proxyOrMiddleware', combinedProxy),
    signals.config.staticExport ? msg('finding.staticExportConfigured') : null,
    exportConflicts.length ? msg('finding.staticExportConflicts', { conflicts: exportConflicts }) : null,
    ...maintenanceEvidence,
  ].filter(Boolean);

  const unknowns = [
    msg('unknown.businessFacts'),
    msg('unknown.deployedBehavior'),
    signals.analysis?.failedFiles ? msg('unknown.parseFailures') : null,
    support.some((project) => !project.resolvedVersion) ? msg('unknown.patchVersion') : null,
    signals.nextProjects.length > 1 ? msg('unknown.monorepoAggregation') : null,
  ].filter(Boolean);

  const nextSteps = [];
  if (recommendation === 'modernize-first') nextSteps.push(msg('nextStep.modernizeFirst'));
  if (signals.router === 'mixed') nextSteps.push(msg('nextStep.mixedRouterInventory'));
  if (exportConflicts.length) nextSteps.push(msg('nextStep.resolveExportConflicts'));
  if (recommendation === 'migration-candidate') nextSteps.push(msg('nextStep.migrationSpike'));
  else if (recommendation === 'keep-and-simplify') nextSteps.push(msg('nextStep.keepAndSimplify'));
  else if (recommendation === 'keep') nextSteps.push(msg('nextStep.keep'));
  nextSteps.push(msg('nextStep.businessEvidence'));

  return {
    applicable: true, recommendation, confidence: { level: confidenceLevel, basis: confidenceBasis.length ? confidenceBasis : [msg('confidence.complete')] },
    summary: { keepValue: frameworkValueLevel, migrationCoupling: migrationCouplingLevel, maintenanceRisk: maintenanceRiskLevel, portabilityOpportunity: portabilityLevel },
    profile: {
      router: signals.router, nextProjects: support, routeFiles, strongServerFiles, serverCapabilityCategories: serverCategoryCount,
      couplingFiles: coupledFiles, couplingRatio: couplingRatio === null ? null : Number(couplingRatio.toFixed(3)),
      clientDirectiveShareOfAppEntries: clientShare === null ? null : Number(clientShare.toFixed(3)), staticExport: signals.config.staticExport,
    },
    dimensions: {
      keepValue: { level: frameworkValueLevel, meaning: msg('dimension.keepValue') },
      migrationCoupling: { level: migrationCouplingLevel, meaning: msg('dimension.migrationCoupling') },
      maintenanceRisk: { level: maintenanceRiskLevel, meaning: msg('dimension.maintenanceRisk') },
      portabilityOpportunity: { level: portabilityLevel, meaning: msg('dimension.portabilityOpportunity') },
    },
    findings, unknowns, nextSteps,
  };
}

/** Render a localized audit tree. `mode` is `text` for terminals, `rich` for JSON. */
export function localizeAudit(audit, locale = DEFAULT_LOCALE, mode = 'text') {
  return localize(audit, createTranslator(locale), mode);
}

function formatHuman(result, t) {
  const audit = result.continuation;
  const lines = [
    `${t('ui.recommendation')}: ${t(`recommendation.${audit.recommendation}`)}`,
    `${t('ui.confidence')}: ${t(`level.${audit.confidence.level}`)}`,
  ];
  if (audit.applicable) {
    const labels = [
      [t('ui.keepValue'), audit.summary.keepValue],
      [t('ui.migrationCoupling'), audit.summary.migrationCoupling],
      [t('ui.maintenanceRisk'), audit.summary.maintenanceRisk],
      [t('ui.portabilityOpportunity'), audit.summary.portabilityOpportunity],
    ];
    const column = labels.reduce((max, [label]) => Math.max(max, displayWidth(label)), 0);
    lines.push(`${t('ui.router')}: ${t(`router.${audit.profile.router}`)}`, '', t('ui.dimensions'));
    for (const [label, level] of labels) lines.push(`  ${padToWidth(label, column)}  ${t(`level.${level}`)}`);
  } else lines.push(t(audit.summary));
  lines.push('', t('ui.findings'), ...audit.findings.map((item) => `  - ${t(item)}`));
  if (audit.confidence.basis.length) lines.push('', t('ui.confidenceLimits'), ...audit.confidence.basis.map((item) => `  - ${t(item)}`));
  lines.push('', t('ui.unknowns'), ...audit.unknowns.map((item) => `  - ${t(item)}`));
  if (result.humanEvidence) {
    const human = result.humanEvidence;
    lines.push('', t('ui.humanEvidence'),
      `  ${t('ui.completeness')}: ${Math.round(human.completeness * 100)}%`,
      `  ${t('ui.beforeAfter')}: ${t(`recommendation.${human.recommendationBeforeHumanEvidence}`)} -> ${t(`recommendation.${human.recommendationAfterHumanEvidence}`)}`);
    for (const [field, value] of Object.entries(human.rawAnswers)) {
      // The key is the contract; show the localized label only when it adds something.
      const label = t(human.answerLabels[field]);
      lines.push(`  ${field}: ${value}${label === value ? '' : ` (${label})`}`);
    }
    if (human.validationErrors.length) lines.push(`  ${t('ui.validationErrors')}`, ...human.validationErrors.map((item) => `    - ${item.field}: ${t(item.message)}`));
    if (human.contradictions.length) lines.push(`  ${t('ui.contradictions')}`, ...human.contradictions.map((item) => `    - ${t(item.message)}`));
    if (human.promptWarning) lines.push(`  ${t('ui.prompt')}: ${t(human.promptWarning)}`);
  }
  lines.push('', t('ui.nextChecks'), ...audit.nextSteps.map((item) => `  - ${t(item)}`));
  lines.push('', t('ui.footer'));
  return lines.join('\n');
}

function usage(t) {
  return [t('cli.usage.synopsis'), '', t('cli.usage.body'), '',
    t('cli.usage.context'), t('cli.usage.interactive'), t('cli.usage.lang')].join('\n');
}

export function parseArgs(argv, t = createTranslator()) {
  const args = { projectPath: '.', json: false, interactive: false, contextPath: null, lang: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') args.json = true;
    else if (value === '--interactive') args.interactive = true;
    else if (value === '--context' || value === '--lang') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        throw new Error(t(value === '--context' ? 'cli.error.contextRequiresPath' : 'cli.error.langRequiresValue'));
      }
      if (value === '--context') args.contextPath = next;
      else args.lang = next;
      index += 1;
    }
    else if (value === '--help' || value === '-h') args.help = true;
    else if (value.startsWith('-')) throw new Error(t('cli.error.unknownOption', { option: value }));
    else args.projectPath = value;
  }
  return args;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let t = createTranslator(resolveLocale(null, env));
  const args = parseArgs(argv, t);
  let locale;
  try {
    locale = resolveLocale(args.lang, env);
  } catch (error) {
    if (error.code !== 'UNSUPPORTED_LOCALE') throw error;
    throw new Error(t('cli.error.unsupportedLocale', { locale: args.lang, supported: SUPPORTED_LOCALES }));
  }
  t = createTranslator(locale);
  if (args.help) { process.stdout.write(`${usage(t)}\n`); return; }

  const { root, signals } = await scanProject(args.projectPath);
  const repositoryAudit = auditContinuation(signals);
  let continuation = repositoryAudit;
  let humanEvidence = null;
  if (args.contextPath || args.interactive) {
    let rawContext = args.contextPath ? await loadHumanContext(args.contextPath) : {};
    let promptStatus = args.interactive ? 'not-started' : 'not-requested';
    let promptWarning = null;
    if (args.interactive) {
      const prompted = await promptForHumanContext(rawContext, {
        input: process.stdin,
        output: args.json ? process.stderr : process.stdout,
        t,
      });
      rawContext = prompted.answers;
      promptStatus = prompted.promptStatus;
      promptWarning = prompted.promptWarning;
    }
    const integrated = integrateHumanEvidence(repositoryAudit, signals, normalizeHumanContext(rawContext));
    continuation = integrated.continuation;
    humanEvidence = { ...integrated.humanEvidence, promptStatus, promptWarning };
  }
  const result = {
    schemaVersion: 5,
    generatedAt: new Date().toISOString(),
    locale,
    evidenceSnapshot: EVIDENCE_SNAPSHOT,
    projectRoot: root,
    continuation,
    humanEvidence,
    scan: signals,
  };
  process.stdout.write(args.json
    ? `${JSON.stringify(localize(result, t, 'rich'), null, 2)}\n`
    : `${formatHuman(result, t)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`next-or-not: ${error.message}\n`); process.exitCode = 1; });
}
