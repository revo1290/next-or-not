import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { dangerousGate, summarize, validateManifest } from '../scripts/evaluate-dataset.mjs';

const manifest = JSON.parse(await fs.readFile(new URL('../dataset/real-world.json', import.meta.url), 'utf8'));

test('real-world manifest contains 30 reviewed and pinned cases with required coverage', () => {
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(manifest.cases.length, 30);
  assert.deepEqual(new Set(manifest.cases.map((item) => item.packageManager)), new Set(['npm', 'pnpm', 'yarn', 'bun']));
  assert.deepEqual(new Set(manifest.cases.map((item) => item.routerExpected)), new Set(['app', 'pages', 'mixed']));
  assert.deepEqual(new Set(manifest.cases.map((item) => item.supportClass)), new Set(['supported', 'unsupported', 'pre-release']));
});

test('summary reports confusion counts, disagreements, slices, and confidence calibration', () => {
  const cases = [manifest.cases[0]];
  const item = cases[0];
  const records = new Map([[item.id, {
    signals: {
      packageManager: item.packageManager,
      router: item.routerExpected,
      routes: { appPages: { files: 1 }, appRouteHandlers: { files: 0 } },
      features: {}, config: {}, sourceFiles: 10,
      analysis: { failedFiles: 1 }, versionResolution: { errors: [] },
      nextProjects: [{ declaredVersion: item.nextVersionExpected, resolvedVersion: item.nextVersionExpected, resolutionErrors: [] }],
    },
    audit: {
      recommendation: 'modernize-first', confidence: { level: 'medium' },
      summary: item.expertLabels,
    },
  }]]);
  const report = summarize(cases, records);
  assert.equal(report.metrics.signals.truePositive, 1);
  assert.equal(report.metrics.signals.falseNegative, 3);
  assert.equal(report.metrics.signals.precision, 1);
  assert.equal(report.metrics.signals.recall, 0.25);
  assert.equal(report.metrics.routerAccuracy, 1);
  assert.equal(report.metrics.dimensionAccuracy, 1);
  assert.equal(report.metrics.confidenceCalibration.medium.recommendationAccuracy, 1);
  assert.equal(report.slices.packageManager.pnpm.total, 1);
  assert.equal(report.disagreements.length, 3);
});

test('dangerous gate rejects migration advice for a high keep-value case', () => {
  const item = { ...manifest.cases[0], allowedRecommendations: ['migration-candidate'] };
  const report = summarize([item], new Map([[item.id, {
    signals: {
      packageManager: 'pnpm', router: 'app', routes: { appPages: { files: 1 }, appRouteHandlers: { files: 1 } },
      features: {}, config: {}, sourceFiles: 2, analysis: { failedFiles: 0 }, versionResolution: { errors: [] },
      nextProjects: [{ declaredVersion: item.nextVersionExpected, resolutionErrors: [] }],
    },
    audit: { recommendation: 'migration-candidate', confidence: { level: 'high' }, summary: item.expertLabels },
  }]]));
  assert.deepEqual(dangerousGate(report), { passed: false, count: 1 });
  assert.equal(report.cases[0].dangerousErrors[0], 'high-keep-value-marked-migration-candidate');
});
