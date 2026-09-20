import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';

import { auditContinuation, scanProject } from '../scripts/assess.mjs';
import {
  HUMAN_QUESTIONS, integrateHumanEvidence, normalizeHumanContext, promptForHumanContext,
} from '../scripts/human-evidence.mjs';
import {
  CATALOGS, createTranslator, displayWidth, isMessage, localize, msg,
  normalizeLocale, padToWidth, resolveLocale, SUPPORTED_LOCALES,
} from '../scripts/i18n/index.mjs';

const execFileAsync = promisify(execFile);
const CLI = path.resolve('scripts/assess.mjs');

async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'next-or-not-i18n-'));
  await Promise.all(Object.entries(files).map(async ([name, content]) => {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }));
  return root;
}

/** A project that exercises server, static-export conflict, and deprecation messages at once. */
const RICH_PROJECT = {
  'package.json': {
    name: 'fixture',
    private: true,
    scripts: { lint: 'next lint' },
    dependencies: { next: '16.3.1', react: '19.1.0' },
  },
  'package-lock.json': { lockfileVersion: 3, packages: { '': { dependencies: { next: '16.3.1' } }, 'node_modules/next': { version: '16.3.1' } } },
  'next.config.mjs': "export default { output: 'export', redirects: async () => [] }",
  'middleware.ts': 'export function middleware() {}',
  'app/page.tsx': "import { cookies } from 'next/headers'\nexport default async function Page() { return String((await cookies()).size) }",
  'app/api/items/route.ts': 'export async function POST(request) { return Response.json(await request.json()) }',
  'app/actions.ts': "'use server'\nexport async function save() {}",
  'pages/legacy.tsx': 'export function getServerSideProps() { return { props: {} } }\nexport default function Legacy() { return null }',
};

function collectIds(value, found = new Set()) {
  if (isMessage(value)) {
    found.add(value.__msg);
    if (value.params) collectIds(value.params, found);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, found);
    return found;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) collectIds(item, found);
  }
  return found;
}

test('every catalog defines the same keys with non-empty values', () => {
  const reference = Object.keys(CATALOGS.en).sort();
  assert.ok(reference.length > 0);
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    assert.deepEqual(Object.keys(catalog).sort(), reference, `${locale} key set differs from en`);
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value === 'function') continue;
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string or a function`);
      assert.ok(value.trim().length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

test('every message emitted by a real audit resolves in every locale', async (t) => {
  const root = await fixture(RICH_PROJECT);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { signals } = await scanProject(root);
  const audit = auditContinuation(signals, new Date('2026-12-01T00:00:00Z'));
  const answers = normalizeHumanContext({
    reviewDriver: 'no-clear-problem',
    evidenceStrength: 'continuous-measurement',
    productionRouteProfile: 'mostly-static-public',
    deploymentConstraint: 'static-only',
    serverCapabilityCriticality: 'unused',
    roadmapDirection: 'status-quo',
    changeCapacity: 'no-budget',
  });
  const integrated = integrateHumanEvidence(audit, signals, answers);

  const ids = collectIds({ audit, integrated, signals });
  assert.ok(ids.size > 25, `expected a broad message sample, saw ${ids.size}`);
  for (const locale of SUPPORTED_LOCALES) {
    for (const id of ids) {
      assert.ok(id in CATALOGS[locale], `${locale} is missing ${id}`);
      const rendered = createTranslator(locale)(msg(id, {
        count: 1, max: 1, major: 1, version: '1.0.0', floor: '1.0.0', date: '2026-01-01',
        path: '.', source: 'lockfile', detail: 'detail', label: 'label', level: 'low',
        router: 'app', file: 'a.ts', reason: 'reason', option: '--x', locale: 'fr',
        installed: '1.0.0', locked: '1.0.0', workspace: '.', value: 'value', message: 'message',
        examples: ['a.ts'], conflicts: ['a'], evidence: ['a'], options: ['a'], supported: ['en'],
      }));
      assert.notEqual(rendered, id, `${locale}.${id} rendered as its own id`);
    }
  }
});

test('unresolved placeholders never leak into rendered text', async (t) => {
  const root = await fixture(RICH_PROJECT);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { signals } = await scanProject(root);
  const audit = auditContinuation(signals, new Date('2026-12-01T00:00:00Z'));
  for (const locale of SUPPORTED_LOCALES) {
    const t2 = createTranslator(locale);
    const rendered = localize([...audit.findings, ...audit.nextSteps, ...audit.unknowns, ...audit.confidence.basis], t2);
    for (const line of rendered) {
      assert.equal(typeof line, 'string');
      assert.doesNotMatch(line, /\{[a-zA-Z]+\}/, `${locale} left a placeholder in: ${line}`);
      assert.doesNotMatch(line, /\[object Object\]/, `${locale} stringified an object in: ${line}`);
    }
  }
});

test('locale resolution follows --lang, NEXT_OR_NOT_LANG, then POSIX variables', () => {
  assert.equal(resolveLocale('ja', {}), 'ja');
  assert.equal(resolveLocale(null, { NEXT_OR_NOT_LANG: 'ja', LANG: 'en_US.UTF-8' }), 'ja');
  assert.equal(resolveLocale(null, { LC_ALL: 'ja_JP.UTF-8' }), 'ja');
  assert.equal(resolveLocale(null, { LANG: 'ja_JP.UTF-8' }), 'ja');
  assert.equal(resolveLocale(null, { LANG: 'C' }), 'en');
  assert.equal(resolveLocale(null, { LANG: 'fr_FR.UTF-8' }), 'en', 'an unsupported environment locale falls back silently');
  assert.equal(resolveLocale(null, {}), 'en');
  assert.throws(() => resolveLocale('fr', {}), /Unsupported --lang/, 'an explicit unsupported locale is an error');
});

test('normalizeLocale accepts common spellings and rejects noise', () => {
  assert.equal(normalizeLocale('JA'), 'ja');
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale('en_GB.UTF-8'), 'en');
  assert.equal(normalizeLocale('POSIX'), null);
  assert.equal(normalizeLocale(''), null);
  assert.equal(normalizeLocale(undefined), null);
});

test('rich localization keeps a stable id beside translated text', () => {
  const t2 = createTranslator('ja');
  const rich = localize({ note: msg('confidence.readErrors', { count: 3 }) }, t2, 'rich');
  assert.equal(rich.note.id, 'confidence.readErrors');
  assert.deepEqual(rich.note.params, { count: 3 });
  assert.match(rich.note.text, /3 件/);
});

test('display width counts CJK as two columns so dimension labels stay aligned', () => {
  assert.equal(displayWidth('Keep value:'), 11);
  assert.equal(displayWidth('継続価値:'), 9);
  assert.equal(displayWidth(padToWidth('継続価値:', 12)), 12);
  assert.equal(padToWidth('already wide enough', 3), 'already wide enough');
});

test('every human-evidence option has a label in every locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(CATALOGS[locale]['option.unknown'], `${locale} is missing option.unknown`);
    for (const question of HUMAN_QUESTIONS) {
      assert.ok(CATALOGS[locale][`question.${question.field}`], `${locale} is missing question.${question.field}`);
      for (const option of question.options) {
        if (option === 'unknown') continue;
        assert.ok(CATALOGS[locale][`option.${question.field}.${option}`], `${locale} is missing option.${question.field}.${option}`);
      }
    }
  }
});

test('the CLI renders the same audit in either language and keeps ids in JSON', async (t) => {
  const root = await fixture(RICH_PROJECT);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const [english, japanese, jsonJa] = await Promise.all([
    execFileAsync(process.execPath, [CLI, root, '--lang', 'en'], { timeout: 10_000 }),
    execFileAsync(process.execPath, [CLI, root, '--lang', 'ja'], { timeout: 10_000 }),
    execFileAsync(process.execPath, [CLI, root, '--lang', 'ja', '--json'], { timeout: 10_000 }),
  ]);
  assert.match(english.stdout, /^Recommendation: modernize-first$/m);
  assert.match(japanese.stdout, /^推奨: modernize-first（先に更新）$/m);
  assert.doesNotMatch(japanese.stdout, /Observed findings/);

  const output = JSON.parse(jsonJa.stdout);
  assert.equal(output.schemaVersion, 5);
  assert.equal(output.locale, 'ja');
  assert.equal(output.continuation.recommendation, 'modernize-first', 'the recommendation enum stays locale-independent');
  assert.equal(output.continuation.findings[0].id, 'finding.router');
  assert.ok(output.continuation.findings[0].text.length > 0);
});

test('the environment selects the language when --lang is absent', async (t) => {
  const root = await fixture(RICH_PROJECT);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { stdout } = await execFileAsync(process.execPath, [CLI, root], {
    timeout: 10_000,
    env: { ...process.env, NEXT_OR_NOT_LANG: 'ja' },
  });
  assert.match(stdout, /^推奨: /m);
});

test('an unsupported --lang value fails loudly instead of silently falling back', async (t) => {
  const root = await fixture(RICH_PROJECT);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    execFileAsync(process.execPath, [CLI, root, '--lang', 'fr'], { timeout: 10_000 }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Unsupported --lang value: fr/);
      assert.match(error.stderr, /en, ja/);
      return true;
    },
  );
});

test('--help is localized', async () => {
  const [english, japanese] = await Promise.all([
    execFileAsync(process.execPath, [CLI, '--help', '--lang', 'en'], { timeout: 10_000 }),
    execFileAsync(process.execPath, [CLI, '--help', '--lang', 'ja'], { timeout: 10_000 }),
  ]);
  assert.match(english.stdout, /Audit an existing Next\.js repository/);
  assert.match(japanese.stdout, /既存のNext\.jsリポジトリ/);
  for (const output of [english.stdout, japanese.stdout]) assert.match(output, /--lang en\|ja/);
});

test('interactive prompts are localized but always record canonical keys', async () => {
  const transcripts = {};
  for (const locale of SUPPORTED_LOCALES) {
    const input = new PassThrough();
    input.isTTY = true;
    const output = new PassThrough();
    let printed = '';
    output.on('data', (chunk) => { printed += chunk; });

    const pending = promptForHumanContext({}, { input, output, t: createTranslator(locale) });
    const answering = setInterval(() => input.write('2\n'), 5);
    const result = await pending;
    clearInterval(answering);

    assert.equal(result.promptStatus, 'completed');
    // Option 2 of every question, regardless of the language it was shown in.
    assert.deepEqual(result.answers, {
      reviewDriver: 'delivery-speed',
      evidenceStrength: 'anecdotal',
      productionRouteProfile: 'mostly-authenticated-client',
      deploymentConstraint: 'node-container',
      serverCapabilityCriticality: 'easily-replaceable',
      roadmapDirection: 'status-quo',
      changeCapacity: 'small-spike-only',
    }, `${locale} prompts did not produce canonical keys`);

    for (const question of HUMAN_QUESTIONS) {
      assert.ok(printed.includes(CATALOGS[locale][`question.${question.field}`]), `${locale} did not show question.${question.field}`);
    }
    transcripts[locale] = printed;
  }
  assert.notEqual(transcripts.en, transcripts.ja, 'the two locales printed identical prompts');
});
