#!/usr/bin/env node

/**
 * Keep the prose and the code from drifting apart.
 *
 * This is deliberately narrow: it checks the facts a contributor is most
 * likely to forget to update (recommendation states, the seven human-evidence
 * fields, supported locales, relative links) rather than trying to review
 * documentation quality.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { HUMAN_QUESTIONS } from './human-evidence.mjs';
import { CATALOGS, SUPPORTED_LOCALES } from './i18n/index.mjs';
import { isMainModule } from './entrypoint.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const RECOMMENDATIONS = [
  'keep', 'keep-and-simplify', 'modernize-first',
  'migration-candidate', 'insufficient-evidence', 'not-applicable',
];

/** Docs that must each describe the full recommendation contract. */
const CONTRACT_DOCS = ['README.md', 'README.ja.md', 'SKILL.md'];
const LINKED_DOCS = ['README.md', 'README.ja.md', 'SKILL.md', 'CONTRIBUTING.md', 'CONTRIBUTING.ja.md'];

async function read(relative) {
  return fs.readFile(path.join(ROOT, relative), 'utf8');
}

async function exists(relative) {
  try { await fs.access(path.join(ROOT, relative)); return true; } catch { return false; }
}

function backticked(text, token) {
  return text.includes(`\`${token}\``) || text.includes(`| \`${token}\``);
}

async function checkRecommendationContract(problems) {
  for (const doc of CONTRACT_DOCS) {
    if (!await exists(doc)) { problems.push(`${doc} is missing.`); continue; }
    const text = await read(doc);
    for (const state of RECOMMENDATIONS) {
      if (!backticked(text, state)) problems.push(`${doc} does not document the \`${state}\` recommendation state.`);
    }
    if (/\bnever emits? `migrate`|must not emit `migrate`|`migrate` を(?:出力|生成)[^\n。]*ありません/.test(text) === false) {
      problems.push(`${doc} does not state that the tool never emits \`migrate\`.`);
    }
  }
}

async function checkHumanEvidenceFields(problems) {
  for (const doc of ['README.md', 'README.ja.md']) {
    if (!await exists(doc)) continue;
    const text = await read(doc);
    for (const question of HUMAN_QUESTIONS) {
      if (!text.includes(question.field)) problems.push(`${doc} does not mention the \`${question.field}\` context field.`);
      for (const option of question.options) {
        if (option === 'unknown') continue;
        if (!text.includes(option)) problems.push(`${doc} does not list the \`${option}\` value for \`${question.field}\`.`);
      }
    }
  }
}

async function checkLocaleDocs(problems) {
  for (const doc of ['README.md', 'README.ja.md']) {
    if (!await exists(doc)) continue;
    const text = await read(doc);
    for (const locale of SUPPORTED_LOCALES) {
      if (!new RegExp(`--lang[^\\n]*\\b${locale}\\b`).test(text)) problems.push(`${doc} does not document \`--lang ${locale}\`.`);
    }
  }
  const reference = Object.keys(CATALOGS[SUPPORTED_LOCALES[0]]).sort().join('\u0000');
  for (const locale of SUPPORTED_LOCALES) {
    if (Object.keys(CATALOGS[locale]).sort().join('\u0000') !== reference) {
      problems.push(`The \`${locale}\` message catalog does not have the same keys as \`${SUPPORTED_LOCALES[0]}\`.`);
    }
  }
}

async function checkRelativeLinks(problems) {
  for (const doc of LINKED_DOCS) {
    if (!await exists(doc)) continue;
    const text = await read(doc);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const resolved = path.resolve(path.join(ROOT, path.dirname(doc)), target);
      if (!resolved.startsWith(ROOT)) { problems.push(`${doc} links outside the repository: ${target}`); continue; }
      if (!await exists(path.relative(ROOT, resolved) || '.')) problems.push(`${doc} links to a missing file: ${target}`);
    }
  }
}

async function checkCrossLinks(problems) {
  if (await exists('README.md') && !(await read('README.md')).includes('README.ja.md')) {
    problems.push('README.md does not link to README.ja.md.');
  }
  if (await exists('README.ja.md') && !(await read('README.ja.md')).includes('README.md')) {
    problems.push('README.ja.md does not link back to README.md.');
  }
}

export async function validateDocs() {
  const problems = [];
  await checkRecommendationContract(problems);
  await checkHumanEvidenceFields(problems);
  await checkLocaleDocs(problems);
  await checkRelativeLinks(problems);
  await checkCrossLinks(problems);
  return problems;
}

if (isMainModule(import.meta.url)) {
  const problems = await validateDocs();
  if (problems.length) {
    process.stderr.write(`Documentation is out of sync with the code:\n${problems.map((item) => `  - ${item}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Documentation matches the code contract.\n');
  }
}
