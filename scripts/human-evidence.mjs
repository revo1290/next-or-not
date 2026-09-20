import fs from 'node:fs/promises';
import readline from 'node:readline/promises';

import { CATALOGS, createTranslator, msg } from './i18n/index.mjs';

/**
 * The seven fixed non-code questions.
 *
 * Option values are locale-independent keys. They are the stable contract for
 * `--context` files and for JSON output, so an English-speaking user never has
 * to type a Japanese literal (and vice versa). Display labels live in the
 * message catalogs under `option.<field>.<key>`.
 */
export const HUMAN_QUESTIONS = [
  {
    field: 'reviewDriver',
    options: ['no-clear-problem', 'delivery-speed', 'reliability-incidents', 'hosting-compliance', 'infrastructure-cost', 'unknown'],
  },
  {
    field: 'evidenceStrength',
    options: ['none', 'anecdotal', 'continuous-measurement', 'repeated-incidents', 'unknown'],
  },
  {
    field: 'productionRouteProfile',
    options: ['mostly-static-public', 'mostly-authenticated-client', 'mostly-request-time-dynamic', 'mixed', 'unknown'],
  },
  {
    field: 'deploymentConstraint',
    options: ['static-only', 'node-container', 'edge-runtime', 'vercel-managed', 'flexible', 'unknown'],
  },
  {
    field: 'serverCapabilityCriticality',
    options: ['unused', 'easily-replaceable', 'important-but-replaceable', 'essential', 'unknown'],
  },
  {
    field: 'roadmapDirection',
    options: ['simplify-to-static-client', 'status-quo', 'more-server-integration', 'undecided', 'unknown'],
  },
  {
    field: 'changeCapacity',
    options: ['no-budget', 'small-spike-only', 'incremental-migration', 'full-migration', 'unknown'],
  },
];

export const HUMAN_FIELDS = HUMAN_QUESTIONS.map((question) => question.field);

export function questionPrompt(field) {
  return msg(`question.${field}`);
}

export function optionLabel(field, value) {
  return value === 'unknown' ? msg('option.unknown') : msg(`option.${field}.${value}`);
}

function aliasKey(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Accept a canonical key, or any display label from any bundled locale.
 * This keeps pre-0.7 `--context` files (whose values were Japanese labels)
 * working without change.
 */
const VALUE_ALIASES = (() => {
  const table = new Map();
  for (const question of HUMAN_QUESTIONS) {
    const perField = new Map();
    for (const option of question.options) {
      perField.set(aliasKey(option), option);
      for (const catalog of Object.values(CATALOGS)) {
        const label = option === 'unknown' ? catalog['option.unknown'] : catalog[`option.${question.field}.${option}`];
        if (typeof label === 'string') perField.set(aliasKey(label), option);
      }
    }
    table.set(question.field, perField);
  }
  return table;
})();

export function canonicalAnswer(field, value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  return VALUE_ALIASES.get(field)?.get(aliasKey(value)) ?? null;
}

export async function loadHumanContext(target) {
  const data = JSON.parse(await fs.readFile(target, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Context JSON must be an object.');
  const source = data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers) ? data.answers : data;
  return { ...source, ...(typeof data.note === 'string' ? { note: data.note } : {}) };
}

export function normalizeHumanContext(input = {}) {
  const rawAnswers = {};
  const suppliedAnswers = {};
  const validationErrors = [];
  for (const question of HUMAN_QUESTIONS) {
    const supplied = input[question.field];
    const canonical = canonicalAnswer(question.field, supplied);
    if (supplied !== undefined && supplied !== null && supplied !== '') suppliedAnswers[question.field] = supplied;
    if (canonical === null) {
      rawAnswers[question.field] = 'unknown';
      validationErrors.push({
        field: question.field,
        value: supplied,
        message: msg('validation.invalidValue', { options: question.options }),
      });
    } else {
      rawAnswers[question.field] = canonical;
    }
  }
  const unknownFields = HUMAN_QUESTIONS.filter((question) => rawAnswers[question.field] === 'unknown').map((question) => question.field);
  return {
    schemaVersion: 2,
    fields: HUMAN_FIELDS,
    rawAnswers,
    suppliedAnswers,
    answerLabels: Object.fromEntries(HUMAN_QUESTIONS.map((question) => [question.field, optionLabel(question.field, rawAnswers[question.field])])),
    note: typeof input.note === 'string' ? input.note : null,
    completeness: Number(((HUMAN_QUESTIONS.length - unknownFields.length) / HUMAN_QUESTIONS.length).toFixed(3)),
    unknownFields,
    validationErrors,
  };
}

export async function promptForHumanContext(existing = {}, { input = process.stdin, output = process.stdout, t = createTranslator() } = {}) {
  if (!input.isTTY) return {
    answers: existing,
    promptStatus: 'skipped-non-tty',
    promptWarning: msg('prompt.nonTty'),
  };
  const answers = { ...existing };
  const terminal = readline.createInterface({ input, output });
  try {
    for (const question of HUMAN_QUESTIONS) {
      const current = canonicalAnswer(question.field, answers[question.field]);
      if (current && current !== 'unknown') continue;
      output.write(`\n${t(questionPrompt(question.field))}\n`);
      question.options.forEach((option, index) => output.write(`  ${index + 1}. ${t(optionLabel(question.field, option))}\n`));
      const response = (await terminal.question(t('prompt.select'))).trim();
      const selected = response === '' ? 'unknown' : question.options[Number(response) - 1];
      answers[question.field] = selected ?? response;
    }
  } finally {
    terminal.close();
  }
  return { answers, promptStatus: 'completed', promptWarning: null };
}

function implication(field, value, meaning, strength = 'context') {
  return { field, value, label: optionLabel(field, value), meaning, strength };
}

function deriveImplications(answers) {
  const items = [];
  if (answers.reviewDriver === 'no-clear-problem') {
    items.push(implication('reviewDriver', answers.reviewDriver, msg('implication.reviewDriver.none'), 'neutral'));
  } else if (answers.reviewDriver !== 'unknown') {
    items.push(implication('reviewDriver', answers.reviewDriver, msg('implication.reviewDriver', { value: optionLabel('reviewDriver', answers.reviewDriver) })));
  }

  const evidence = {
    none: ['implication.evidenceStrength.none', 'none'],
    anecdotal: ['implication.evidenceStrength.anecdotal', 'weak'],
    'continuous-measurement': ['implication.evidenceStrength.continuous', 'strong'],
    'repeated-incidents': ['implication.evidenceStrength.incidents', 'strong'],
  }[answers.evidenceStrength];
  if (evidence) items.push(implication('evidenceStrength', answers.evidenceStrength, msg(evidence[0]), evidence[1]));

  const plain = [
    ['productionRouteProfile', 'implication.productionRouteProfile', 'context'],
    ['deploymentConstraint', 'implication.deploymentConstraint', 'constraint'],
    ['serverCapabilityCriticality', 'implication.serverCapabilityCriticality', 'context'],
    ['roadmapDirection', 'implication.roadmapDirection', 'context'],
    ['changeCapacity', 'implication.changeCapacity', 'constraint'],
  ];
  for (const [field, id, strength] of plain) {
    if (answers[field] === 'unknown') continue;
    items.push(implication(field, answers[field], msg(id, { value: optionLabel(field, answers[field]) }), strength));
  }
  return items;
}

function requestTimeEvidence(signals) {
  const f = signals.features;
  const r = signals.routes;
  return [
    [f.requestBoundApis.files, 'codeEvidence.requestBoundApis'],
    [f.requestDependentRouteHandlers.files, 'codeEvidence.requestDependentRouteHandlers'],
    [f.serverSideProps.files, 'codeEvidence.serverSideProps'],
    [r.pagesApiRoutes.files, 'codeEvidence.pagesApiRoutes'],
    [f.middleware.files + f.proxy.files, 'codeEvidence.middlewareOrProxy'],
    [signals.config.rewrites || signals.config.redirects || signals.config.headers, 'codeEvidence.dynamicConfigRouting'],
  ].filter(([present]) => Boolean(present)).map(([, id]) => msg(id));
}

export function integrateHumanEvidence(audit, signals, normalized) {
  const answers = normalized.rawAnswers;
  const implications = deriveImplications(answers);
  const contradictions = [];
  const requestTime = requestTimeEvidence(signals);
  const hasServerEvidence = audit.applicable && (audit.profile.serverCapabilityCategories > 0 || requestTime.length > 0);

  if (answers.deploymentConstraint === 'static-only' && requestTime.length) contradictions.push({
    code: 'static-only-vs-request-time',
    fields: ['deploymentConstraint'],
    message: msg('contradiction.staticOnlyVsRequestTime', { evidence: requestTime }),
    codeEvidence: requestTime,
  });
  if (answers.serverCapabilityCriticality === 'unused' && hasServerEvidence) contradictions.push({
    code: 'reported-unused-vs-detected-server',
    fields: ['serverCapabilityCriticality'],
    message: msg('contradiction.reportedUnusedVsDetectedServer'),
    codeEvidence: requestTime.length ? requestTime : [msg('codeEvidence.keepValue', { level: msg(`level.${audit.summary.keepValue}`) })],
  });
  if (answers.productionRouteProfile === 'mostly-static-public' && requestTime.length) contradictions.push({
    code: 'static-profile-vs-request-time',
    fields: ['productionRouteProfile'],
    message: msg('contradiction.staticProfileVsRequestTime'),
    codeEvidence: requestTime,
  });
  if (answers.reviewDriver === 'no-clear-problem' && ['continuous-measurement', 'repeated-incidents'].includes(answers.evidenceStrength)) contradictions.push({
    code: 'no-driver-vs-strong-evidence',
    fields: ['reviewDriver', 'evidenceStrength'],
    message: msg('contradiction.noDriverVsStrongEvidence'),
    codeEvidence: [],
  });

  const integrated = structuredClone(audit);
  if (integrated.applicable) {
    if (contradictions.some((item) => item.code === 'static-only-vs-request-time') && integrated.recommendation !== 'insufficient-evidence') {
      integrated.recommendation = 'modernize-first';
      integrated.nextSteps.unshift(msg('nextStep.resolveStaticOnlyContradiction'));
    }
    if (answers.serverCapabilityCriticality === 'essential' && audit.summary.keepValue !== 'low'
      && !['insufficient-evidence', 'modernize-first'].includes(integrated.recommendation)) {
      integrated.recommendation = 'keep';
      integrated.nextSteps.unshift(msg('nextStep.documentEssentialCapabilities'));
    }
    if (answers.changeCapacity === 'no-budget' && integrated.recommendation === 'migration-candidate') {
      integrated.recommendation = 'keep-and-simplify';
      integrated.nextSteps.unshift(msg('nextStep.noMigrationBudget'));
    }
    if (['none', 'anecdotal'].includes(answers.evidenceStrength)) {
      integrated.nextSteps.push(msg('nextStep.collectMeasurements'));
    }
    for (const contradiction of contradictions) integrated.nextSteps.push(msg('nextStep.verifyContradiction', { message: contradiction.message }));
  }

  return {
    continuation: integrated,
    humanEvidence: {
      ...normalized,
      implications,
      contradictions,
      recommendationBeforeHumanEvidence: audit.recommendation,
      recommendationAfterHumanEvidence: integrated.recommendation,
      rule: msg('humanEvidence.rule'),
    },
  };
}
