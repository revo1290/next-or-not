#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { auditContinuation, scanProject } from './assess.mjs';
import { createNextVersionResolver } from './resolvers/next-version.mjs';

const execFileAsync = promisify(execFile);
const LEVELS = new Set(['low', 'medium', 'high']);
const ROUTERS = new Set(['app', 'pages', 'mixed']);
const RECOMMENDATIONS = new Set(['keep', 'keep-and-simplify', 'modernize-first', 'migration-candidate', 'insufficient-evidence']);
const SUPPORT_CLASSES = new Set(['supported', 'unsupported', 'pre-release']);
const MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const DIMENSIONS = ['keepValue', 'migrationCoupling', 'maintenanceRisk', 'portabilityOpportunity'];
const FEATURE_PATHS = new Set([
  'routes.appPages', 'routes.appLayouts', 'routes.appRouteHandlers', 'routes.pagesRoutes', 'routes.pagesApiRoutes',
  'features.serverDirectives', 'features.cacheApis', 'features.cacheDirectives', 'features.requestBoundApis',
  'features.middleware', 'features.proxy', 'features.customServer', 'config.staticExport', 'config.standaloneOutput',
]);

function get(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function present(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value?.files === 'number') return value.files > 0;
  if (typeof value?.count === 'number') return value.count > 0;
  return Boolean(value);
}

function parseMajor(version) {
  const match = typeof version === 'string' ? version.match(/(?:^|[^0-9])(\d+)\.(?:\d+|x|\*)/) : null;
  return match ? Number(match[1]) : null;
}

function safeRelative(value, allowDot = false) {
  return typeof value === 'string' && (allowDot && value === '.' || value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'));
}

export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (manifest?.labeledWithoutToolOutput !== true) errors.push('labeledWithoutToolOutput must be true.');
  if (!Array.isArray(manifest?.cases) || manifest.cases.length !== 30) errors.push('The manifest must contain exactly 30 cases.');
  const ids = new Set();
  const commits = new Set();
  for (const [index, item] of (manifest?.cases ?? []).entries()) {
    const label = item?.id || `case[${index}]`;
    if (!/^[a-z0-9][a-z0-9-]+$/.test(item?.id ?? '')) errors.push(`${label}: invalid id.`);
    if (ids.has(item?.id)) errors.push(`${label}: duplicate id.`);
    ids.add(item?.id);
    if (!/^[\w.-]+\/[\w.-]+$/.test(item?.repository ?? '')) errors.push(`${label}: invalid repository.`);
    if (!/^[0-9a-f]{40}$/.test(item?.commit ?? '')) errors.push(`${label}: commit must be a full 40-character SHA.`);
    const pin = `${item?.repository}@${item?.commit}`;
    if (commits.has(pin)) errors.push(`${label}: duplicate repository commit.`);
    commits.add(pin);
    if (!item?.license?.spdx || !item?.license?.evidencePath) errors.push(`${label}: license and evidencePath are required.`);
    if (!safeRelative(item?.workspacePath, true)) errors.push(`${label}: workspacePath must stay inside the checkout.`);
    if (!MANAGERS.has(item?.packageManager)) errors.push(`${label}: unsupported packageManager.`);
    if (!['small', 'medium', 'large'].includes(item?.projectSize)) errors.push(`${label}: invalid projectSize.`);
    if (typeof item?.nextVersionExpected !== 'string' || !item.nextVersionExpected) errors.push(`${label}: nextVersionExpected is required.`);
    if (!SUPPORT_CLASSES.has(item?.supportClass)) errors.push(`${label}: invalid supportClass.`);
    if (!ROUTERS.has(item?.routerExpected)) errors.push(`${label}: invalid routerExpected.`);
    if (!item?.featureExpectations || !Object.keys(item.featureExpectations).length) errors.push(`${label}: featureExpectations cannot be empty.`);
    for (const [feature, expected] of Object.entries(item?.featureExpectations ?? {})) {
      if (!FEATURE_PATHS.has(feature)) errors.push(`${label}: unknown feature ${feature}.`);
      if (typeof expected !== 'boolean') errors.push(`${label}: feature ${feature} must be boolean.`);
    }
    if (!Array.isArray(item?.evidencePaths) || !item.evidencePaths.length) errors.push(`${label}: evidencePaths cannot be empty.`);
    else if (item.evidencePaths.some((value) => !safeRelative(value))) errors.push(`${label}: evidencePaths must stay inside the checkout.`);
    if (!safeRelative(item?.license?.evidencePath)) errors.push(`${label}: license evidencePath must stay inside the checkout.`);
    for (const dimension of DIMENSIONS) if (!LEVELS.has(item?.expertLabels?.[dimension])) errors.push(`${label}: invalid ${dimension} label.`);
    if (!Array.isArray(item?.allowedRecommendations) || !item.allowedRecommendations.length ||
        item.allowedRecommendations.some((value) => !RECOMMENDATIONS.has(value))) errors.push(`${label}: invalid allowedRecommendations.`);
    if (!item?.rationale) errors.push(`${label}: rationale is required.`);
    if (item?.review?.status !== 'reviewed' || !item?.review?.reviewer || !item?.review?.reviewedAt) errors.push(`${label}: completed review metadata is required.`);
    if (!Array.isArray(item?.ambiguity)) errors.push(`${label}: ambiguity must be an array.`);
  }
  const managers = new Set((manifest?.cases ?? []).map((item) => item.packageManager));
  for (const manager of MANAGERS) if (!managers.has(manager)) errors.push(`Coverage missing package manager: ${manager}.`);
  for (const router of ROUTERS) if (!(manifest?.cases ?? []).some((item) => item.routerExpected === router)) errors.push(`Coverage missing router: ${router}.`);
  for (const supportClass of SUPPORT_CLASSES) if (!(manifest?.cases ?? []).some((item) => item.supportClass === supportClass)) errors.push(`Coverage missing support class: ${supportClass}.`);
  if (!(manifest?.cases ?? []).some((item) => item.workspacePath === '.')) errors.push('Coverage missing a single-package repository.');
  if (!(manifest?.cases ?? []).some((item) => item.workspacePath !== '.')) errors.push('Coverage missing a monorepo workspace.');
  const groups = manifest?.coverageGroups;
  const requiredGroups = [
    ['applicationProfile', 'static'], ['applicationProfile', 'content'], ['applicationProfile', 'product'],
    ['serverCapabilities', 'actions'], ['serverCapabilities', 'routes'], ['serverCapabilities', 'cache'],
    ['deployment', 'selfHosted'], ['deployment', 'adapter'],
  ];
  for (const [group, name] of requiredGroups) {
    const members = groups?.[group]?.[name];
    if (!Array.isArray(members) || !members.length) errors.push(`Coverage group ${group}.${name} must contain at least one case.`);
    else for (const id of members) if (!ids.has(id)) errors.push(`Coverage group ${group}.${name} references unknown case ${id}.`);
  }
  return errors;
}

async function runGit(args, options = {}) {
  return execFileAsync('git', args, { timeout: 300_000, maxBuffer: 20 * 1024 * 1024, ...options });
}

function sparsePatterns(item) {
  const rootFiles = [
    '/package.json', '/package-lock.json', '/npm-shrinkwrap.json', '/pnpm-lock.yaml', '/pnpm-workspace.yaml',
    '/yarn.lock', '/bun.lock', '/bun.lockb', '/turbo.json', '/.yarnrc.yml', '/.npmrc',
  ];
  if (item.workspacePath === '.') return ['/*', '!/.git'];
  const pinnedEvidence = [item.license.evidencePath, ...item.evidencePaths].flatMap((value) => [`/${value}`, `/${value}/**`]);
  return [...new Set([...rootFiles, ...pinnedEvidence, `/${item.workspacePath}/`, `/${item.workspacePath}/**`])];
}

async function materialize(item, cacheRoot) {
  const target = path.join(cacheRoot, item.id);
  await fs.mkdir(target, { recursive: true });
  if (!await fs.stat(path.join(target, '.git')).then(() => true, () => false)) {
    await runGit(['init', '--quiet', target]);
    await runGit(['-C', target, 'remote', 'add', 'origin', `https://github.com/${item.repository}.git`]);
  }
  try {
    await runGit(['-C', target, 'cat-file', '-e', `${item.commit}^{commit}`]);
  } catch {
    await runGit(['-C', target, 'fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', item.commit]);
  }
  await runGit(['-C', target, 'sparse-checkout', 'init', '--no-cone']);
  await fs.writeFile(path.join(target, '.git', 'info', 'sparse-checkout'), `${sparsePatterns(item).join('\n')}\n`);
  await runGit(['-C', target, 'checkout', '--quiet', '--detach', item.commit]);
  const { stdout } = await runGit(['-C', target, 'rev-parse', 'HEAD']);
  if (stdout.trim() !== item.commit) throw new Error(`checkout mismatch: expected ${item.commit}, got ${stdout.trim()}`);
  return target;
}

async function scanCase(item, checkoutRoot) {
  for (const evidencePath of [item.license.evidencePath, ...item.evidencePaths]) {
    await fs.stat(path.resolve(checkoutRoot, evidencePath)).catch(() => {
      throw new Error(`pinned evidence path is missing: ${evidencePath}`);
    });
  }
  const workspace = path.resolve(checkoutRoot, item.workspacePath);
  const { signals } = await scanProject(workspace);
  const project = signals.nextProjects.find((candidate) => candidate.path === '.') ?? signals.nextProjects[0];
  if (project && item.workspacePath !== '.') {
    const resolver = await createNextVersionResolver(checkoutRoot);
    const resolution = await resolver.resolve(workspace, project.declaredVersion);
    project.resolvedVersion = resolution.resolvedVersion;
    project.versionSource = resolution.resolution.source;
    project.resolution = resolution.resolution;
    project.resolutionWarnings = resolution.warnings;
    project.resolutionErrors = resolution.errors;
    project.resolutionCandidates = resolution.candidates;
    project.major = parseMajor(resolution.resolvedVersion ?? project.declaredVersion);
    signals.packageManager = resolver.packageManager;
    signals.versionResolution = { lockfile: resolver.lockfile, errors: resolver.errors };
  }
  const audit = auditContinuation(signals, new Date('2026-09-14T00:00:00Z'));
  return { signals, audit };
}

function evaluateOne(item, result) {
  const signalChecks = Object.entries(item.featureExpectations).map(([feature, expected]) => {
    const actual = present(get(result.signals, feature));
    return { feature, expected, actual, correct: expected === actual };
  });
  const impliedNegativeRoutes = item.routerExpected === 'app'
    ? ['routes.pagesRoutes', 'routes.pagesApiRoutes']
    : item.routerExpected === 'pages' ? ['routes.appPages', 'routes.appLayouts', 'routes.appRouteHandlers'] : [];
  for (const feature of impliedNegativeRoutes) if (!(feature in item.featureExpectations)) {
    const actual = present(get(result.signals, feature));
    signalChecks.push({ feature, expected: false, actual, correct: !actual, derivedFrom: 'routerExpected' });
  }
  signalChecks.push({ feature: 'router', expected: item.routerExpected, actual: result.signals.router, correct: item.routerExpected === result.signals.router });
  const dimensionChecks = DIMENSIONS.map((dimension) => ({
    dimension, expected: item.expertLabels[dimension], actual: result.audit.summary?.[dimension] ?? null,
    correct: item.expertLabels[dimension] === result.audit.summary?.[dimension],
  }));
  const recommendationAllowed = item.allowedRecommendations.includes(result.audit.recommendation);
  const dangerousErrors = [];
  if (item.expertLabels.keepValue === 'high' && result.audit.recommendation === 'migration-candidate') dangerousErrors.push('high-keep-value-marked-migration-candidate');
  if (['unsupported', 'pre-release'].includes(item.supportClass) && result.audit.summary?.maintenanceRisk !== 'high') dangerousErrors.push('support-risk-understated');
  if (result.audit.confidence?.level === 'low' && result.audit.recommendation !== 'insufficient-evidence') dangerousErrors.push('low-confidence-actionable-recommendation');
  return {
    id: item.id, repository: item.repository, commit: item.commit, workspacePath: item.workspacePath,
    packageManagerExpected: item.packageManager, packageManagerActual: result.signals.packageManager,
    versionExpected: item.nextVersionExpected,
    versionActual: result.signals.nextProjects[0]?.resolvedVersion ?? result.signals.nextProjects[0]?.declaredVersion ?? null,
    signalChecks, dimensionChecks, recommendation: result.audit.recommendation,
    allowedRecommendations: item.allowedRecommendations, recommendationAllowed,
    confidence: result.audit.confidence?.level ?? 'low',
    parserFailures: result.signals.analysis?.failedFiles ?? 0, sourceFiles: result.signals.sourceFiles ?? 0,
    lockfileFailure: Boolean(result.signals.versionResolution?.errors?.length || result.signals.nextProjects.some((project) => project.resolutionErrors?.length)),
    dangerousErrors,
  };
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

export function summarize(cases, recordsById) {
  const evaluated = [];
  const failures = [];
  for (const item of cases) {
    const value = recordsById.get(item.id);
    if (value?.error) failures.push({ id: item.id, error: value.error });
    else if (value) evaluated.push(evaluateOne(item, value));
  }
  const checks = evaluated.flatMap((item) => item.signalChecks.filter((check) => check.feature !== 'router'));
  const tp = checks.filter((x) => x.expected && x.actual).length;
  const fp = checks.filter((x) => !x.expected && x.actual).length;
  const fn = checks.filter((x) => x.expected && !x.actual).length;
  const tn = checks.filter((x) => !x.expected && !x.actual).length;
  const allDimensions = evaluated.flatMap((item) => item.dimensionChecks);
  const confidenceBuckets = Object.fromEntries(['high', 'medium', 'low'].map((level) => {
    const bucket = evaluated.filter((item) => item.confidence === level);
    return [level, { total: bucket.length, recommendationAccuracy: ratio(bucket.filter((item) => item.recommendationAllowed).length, bucket.length) }];
  }));
  const slice = (field, values) => Object.fromEntries(values.map((value) => {
    const ids = cases.filter((item) => item[field] === value).map((item) => item.id);
    const rows = evaluated.filter((item) => ids.includes(item.id));
    return [value, { total: rows.length, recommendationAccuracy: ratio(rows.filter((row) => row.recommendationAllowed).length, rows.length), dangerousErrors: rows.reduce((sum, row) => sum + row.dangerousErrors.length, 0) }];
  }));
  const disagreements = evaluated.flatMap((item) => [
    ...item.signalChecks.filter((check) => !check.correct).map((check) => ({ id: item.id, kind: 'signal', field: check.feature, expected: check.expected, actual: check.actual })),
    ...item.dimensionChecks.filter((check) => !check.correct).map((check) => ({ id: item.id, kind: 'dimension', field: check.dimension, expected: check.expected, actual: check.actual })),
    ...(!item.recommendationAllowed ? [{ id: item.id, kind: 'recommendation', field: 'recommendation', expected: item.allowedRecommendations, actual: item.recommendation }] : []),
  ]);
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), totalSelected: cases.length,
    totalEvaluated: evaluated.length, cloneOrScanFailures: failures,
    metrics: {
      signals: { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) },
      routerAccuracy: ratio(evaluated.filter((item) => item.signalChecks.find((x) => x.feature === 'router')?.correct).length, evaluated.length),
      dimensionAccuracy: ratio(allDimensions.filter((item) => item.correct).length, allDimensions.length),
      recommendationAccuracy: ratio(evaluated.filter((item) => item.recommendationAllowed).length, evaluated.length),
      parserFailureRate: ratio(evaluated.reduce((sum, item) => sum + item.parserFailures, 0), evaluated.reduce((sum, item) => sum + item.sourceFiles, 0)),
      lockfileFailureRate: ratio(evaluated.filter((item) => item.lockfileFailure).length, evaluated.length),
      dangerousErrorRate: ratio(evaluated.reduce((sum, item) => sum + item.dangerousErrors.length, 0), evaluated.length),
      confidenceCalibration: confidenceBuckets,
    },
    slices: {
      router: slice('routerExpected', ['app', 'pages', 'mixed']),
      packageManager: slice('packageManager', ['npm', 'pnpm', 'yarn', 'bun']),
      projectSize: slice('projectSize', ['small', 'medium', 'large']),
      supportClass: slice('supportClass', ['supported', 'unsupported', 'pre-release']),
    },
    disagreements, cases: evaluated,
  };
}

export function dangerousGate(report) {
  const count = report.cases.reduce((sum, item) => sum + item.dangerousErrors.length, 0);
  return { passed: count === 0, count };
}

function markdown(report) {
  const m = report.metrics;
  const gate = dangerousGate(report);
  return [
    '# Real-world calibration baseline', '',
    `Generated from ${report.totalEvaluated}/${report.totalSelected} pinned repositories. No repository source is redistributed.`, '',
    '| Metric | Result |', '| --- | ---: |',
    `| Signal precision | ${m.signals.precision ?? 'n/a'} (${m.signals.truePositive} TP / ${m.signals.falsePositive} FP) |`,
    `| Signal recall | ${m.signals.recall ?? 'n/a'} (${m.signals.truePositive} TP / ${m.signals.falseNegative} FN) |`,
    `| Router accuracy | ${m.routerAccuracy ?? 'n/a'} |`, `| Four-dimension label accuracy | ${m.dimensionAccuracy ?? 'n/a'} |`,
    `| Recommendation within allowed set | ${m.recommendationAccuracy ?? 'n/a'} |`,
    `| Parser failure rate | ${m.parserFailureRate ?? 'n/a'} |`, `| Lockfile failure rate | ${m.lockfileFailureRate ?? 'n/a'} |`,
    `| Dangerous error rate | ${m.dangerousErrorRate ?? 'n/a'} |`, '',
    `Dangerous-error gate: **${gate.passed ? 'PASS' : 'FAIL'}** (${gate.count}).`, '',
    `Disagreements: ${report.disagreements.length}. Clone/scan failures: ${report.cloneOrScanFailures.length}.`, '',
    '## Confidence calibration', '',
    '| Confidence | Cases | Recommendation agreement |', '| --- | ---: | ---: |',
    ...Object.entries(m.confidenceCalibration).map(([level, value]) => `| ${level} | ${value.total} | ${value.recommendationAccuracy ?? 'n/a'} |`), '',
    '## Slice summary', '',
    '| Slice | Cases | Recommendation agreement | Dangerous errors |', '| --- | ---: | ---: | ---: |',
    ...Object.entries(report.slices).flatMap(([dimension, values]) => Object.entries(values).map(([value, row]) =>
      `| ${dimension}: ${value} | ${row.total} | ${row.recommendationAccuracy ?? 'n/a'} | ${row.dangerousErrors} |`)), '',
    '## Disagreement log', '',
    ...(report.disagreements.length ? report.disagreements.map((item) =>
      `- \`${item.id}\` ${item.kind} \`${item.field}\`: expected \`${JSON.stringify(item.expected)}\`, actual \`${JSON.stringify(item.actual)}\`.`) : ['No disagreements.']), '',
    'The manifest labels were frozen before running the tool. Disagreements are retained here and in `dataset/results-full.json` for adjudication; they were not silently relabeled.', '',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { manifest: 'dataset/real-world.json', subset: 'full', cache: path.join(os.tmpdir(), 'next-or-not-dataset'), output: null, markdown: null, validateOnly: false, concurrency: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--validate-only') args.validateOnly = true;
    else if (['--manifest', '--subset', '--cache', '--output', '--markdown', '--concurrency'].includes(value)) {
      if (!argv[index + 1]) throw new Error(`${value} requires a value.`);
      args[value.slice(2)] = value === '--concurrency' ? Number(argv[index + 1]) : argv[index + 1];
      index += 1;
    } else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!['full', 'smoke'].includes(args.subset)) throw new Error('--subset must be full or smoke.');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) throw new Error('--concurrency must be an integer from 1 to 8.');
  return args;
}

async function runPool(items, concurrency, operation) {
  const output = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      try { output.set(item.id, await operation(item)); }
      catch (error) { output.set(item.id, { error: error.message }); }
    }
  }));
  return output;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write('evaluate-dataset [--validate-only] [--subset smoke|full] [--cache DIR] [--output FILE] [--markdown FILE] [--concurrency N]\n');
    return;
  }
  const manifest = JSON.parse(await fs.readFile(path.resolve(args.manifest), 'utf8'));
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid dataset manifest:\n- ${errors.join('\n- ')}`);
  if (args.validateOnly) { process.stdout.write(`Validated ${manifest.cases.length} pinned cases.\n`); return; }
  const selected = args.subset === 'smoke' ? manifest.cases.filter((item) => item.smoke) : manifest.cases;
  await fs.mkdir(path.resolve(args.cache), { recursive: true });
  const results = await runPool(selected, args.concurrency, async (item) => {
    const checkout = await materialize(item, path.resolve(args.cache));
    return scanCase(item, checkout);
  });
  const report = summarize(selected, results);
  if (args.output) await fs.writeFile(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
  if (args.markdown) await fs.writeFile(path.resolve(args.markdown), markdown(report));
  process.stdout.write(`${JSON.stringify({ totalEvaluated: report.totalEvaluated, failures: report.cloneOrScanFailures.length, metrics: report.metrics, dangerousGate: dangerousGate(report) }, null, 2)}\n`);
  if (!dangerousGate(report).passed) process.exitCode = 2;
  if (report.cloneOrScanFailures.length) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`next-or-not dataset: ${error.message}\n`); process.exitCode = 1; });
