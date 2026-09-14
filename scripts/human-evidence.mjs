import fs from 'node:fs/promises';
import readline from 'node:readline/promises';

export const HUMAN_QUESTIONS = [
  {
    field: 'reviewDriver',
    prompt: '1. 見直しの主目的は何か',
    options: ['明確な問題なし', '開発速度', '信頼性・障害', 'hosting / compliance制約', 'インフラ費用', 'unknown'],
  },
  {
    field: 'evidenceStrength',
    prompt: '2. その問題を裏付ける証拠はあるか',
    options: ['証拠なし', '体感・単発事例', '継続的な計測', '複数の障害・SLO違反', 'unknown'],
  },
  {
    field: 'productionRouteProfile',
    prompt: '3. 本番routeの実際の性質は何か',
    options: ['主に静的公開ページ', '主に認証済みclient app', '主にrequest-time dynamic', 'mixed', 'unknown'],
  },
  {
    field: 'deploymentConstraint',
    prompt: '4. deployment上の必須制約は何か',
    options: ['static-only', 'Node / container', 'edge runtime', 'Vercel運用', 'flexible', 'unknown'],
  },
  {
    field: 'serverCapabilityCriticality',
    prompt: '5. 検出されたNext.js server機能は置換可能か',
    options: ['利用していない', '容易に置換可能', '重要だが代替可能', '必須・置換困難', 'unknown'],
  },
  {
    field: 'roadmapDirection',
    prompt: '6. 12–18か月のroadmapはどちらへ向かうか',
    options: ['static/clientへ簡素化', '現状維持', 'server統合を増やす', '未確定', 'unknown'],
  },
  {
    field: 'changeCapacity',
    prompt: '7. 変更へ投入できる能力はどの程度か',
    options: ['移行予算なし', '小さなspikeのみ', '段階移行可能', '全面移行を実施可能', 'unknown'],
  },
];

const QUESTION_BY_FIELD = new Map(HUMAN_QUESTIONS.map((question) => [question.field, question]));

export async function loadHumanContext(target) {
  const data = JSON.parse(await fs.readFile(target, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Context JSON must be an object.');
  const source = data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers) ? data.answers : data;
  return { ...source, ...(typeof data.note === 'string' ? { note: data.note } : {}) };
}

export function normalizeHumanContext(input = {}) {
  const rawAnswers = {};
  const validationErrors = [];
  for (const question of HUMAN_QUESTIONS) {
    const supplied = input[question.field];
    if (supplied === undefined || supplied === null || supplied === '') {
      rawAnswers[question.field] = 'unknown';
    } else if (question.options.includes(supplied)) {
      rawAnswers[question.field] = supplied;
    } else {
      rawAnswers[question.field] = 'unknown';
      validationErrors.push({
        field: question.field,
        value: supplied,
        message: `Invalid value; expected one of: ${question.options.join(', ')}`,
      });
    }
  }
  const unknownFields = HUMAN_QUESTIONS.filter((question) => rawAnswers[question.field] === 'unknown').map((question) => question.field);
  return {
    schemaVersion: 1,
    fields: HUMAN_QUESTIONS.map((question) => question.field),
    rawAnswers,
    note: typeof input.note === 'string' ? input.note : null,
    completeness: Number(((HUMAN_QUESTIONS.length - unknownFields.length) / HUMAN_QUESTIONS.length).toFixed(3)),
    unknownFields,
    validationErrors,
  };
}

export async function promptForHumanContext(existing = {}, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY) return {
    answers: existing,
    promptStatus: 'skipped-non-tty',
    promptWarning: '`--interactive` was requested without a TTY; no prompt was opened.',
  };
  const answers = { ...existing };
  const terminal = readline.createInterface({ input, output });
  try {
    for (const question of HUMAN_QUESTIONS) {
      if (question.options.includes(answers[question.field]) && answers[question.field] !== 'unknown') continue;
      output.write(`\n${question.prompt}\n`);
      question.options.forEach((option, index) => output.write(`  ${index + 1}. ${option}\n`));
      const response = (await terminal.question('選択番号（Enterでunknown）: ')).trim();
      const selected = response === '' ? 'unknown' : question.options[Number(response) - 1];
      answers[question.field] = selected ?? response;
    }
  } finally {
    terminal.close();
  }
  return { answers, promptStatus: 'completed', promptWarning: null };
}

function implication(field, value, meaning, strength = 'context') {
  return { field, value, meaning, strength };
}

function deriveImplications(answers) {
  const items = [];
  if (answers.reviewDriver === '明確な問題なし') items.push(implication('reviewDriver', answers.reviewDriver, 'No evidenced change driver was asserted.', 'neutral'));
  else if (answers.reviewDriver !== 'unknown') items.push(implication('reviewDriver', answers.reviewDriver, `The stated review driver is ${answers.reviewDriver}.`, 'context'));

  const evidence = {
    '証拠なし': ['The stated pain has no supporting evidence.', 'none'],
    '体感・単発事例': ['The stated pain is anecdotal or isolated.', 'weak'],
    '継続的な計測': ['The stated pain has continuing measurements.', 'strong'],
    '複数の障害・SLO違反': ['The stated pain has repeated incident or SLO evidence.', 'strong'],
  }[answers.evidenceStrength];
  if (evidence) items.push(implication('evidenceStrength', answers.evidenceStrength, evidence[0], evidence[1]));
  if (answers.productionRouteProfile !== 'unknown') items.push(implication('productionRouteProfile', answers.productionRouteProfile, `Production routes are reported as ${answers.productionRouteProfile}.`, 'context'));
  if (answers.deploymentConstraint !== 'unknown') items.push(implication('deploymentConstraint', answers.deploymentConstraint, `Deployment is constrained to ${answers.deploymentConstraint}.`, 'constraint'));
  if (answers.serverCapabilityCriticality !== 'unknown') items.push(implication('serverCapabilityCriticality', answers.serverCapabilityCriticality, `Detected server capability replacement is reported as ${answers.serverCapabilityCriticality}.`, 'context'));
  if (answers.roadmapDirection !== 'unknown') items.push(implication('roadmapDirection', answers.roadmapDirection, `The 12–18 month roadmap is ${answers.roadmapDirection}.`, 'context'));
  if (answers.changeCapacity !== 'unknown') items.push(implication('changeCapacity', answers.changeCapacity, `Available change capacity is ${answers.changeCapacity}.`, 'constraint'));
  return items;
}

function requestTimeEvidence(signals) {
  const f = signals.features;
  const r = signals.routes;
  return [
    [f.requestBoundApis.files, 'request-bound APIs'],
    [f.requestDependentRouteHandlers.files, 'Request-dependent Route Handlers'],
    [f.serverSideProps.files, 'getServerSideProps'],
    [r.pagesApiRoutes.files, 'Pages API routes'],
    [f.middleware.files + f.proxy.files, 'middleware/proxy'],
    [signals.config.rewrites || signals.config.redirects || signals.config.headers, 'dynamic next.config routing/headers'],
  ].filter(([present]) => Boolean(present)).map(([, label]) => label);
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
    message: `A static-only deployment conflicts with detected ${requestTime.join(', ')}.`,
    codeEvidence: requestTime,
  });
  if (answers.serverCapabilityCriticality === '利用していない' && hasServerEvidence) contradictions.push({
    code: 'reported-unused-vs-detected-server',
    fields: ['serverCapabilityCriticality'],
    message: 'Server capabilities were reported as unused, but repository evidence indicates server/runtime coupling.',
    codeEvidence: requestTime.length ? requestTime : [`keep value: ${audit.summary.keepValue}`],
  });
  if (answers.productionRouteProfile === '主に静的公開ページ' && requestTime.length) contradictions.push({
    code: 'static-profile-vs-request-time',
    fields: ['productionRouteProfile'],
    message: 'The reported mainly-static production profile needs route-level verification against request-time code evidence.',
    codeEvidence: requestTime,
  });
  if (answers.reviewDriver === '明確な問題なし' && ['継続的な計測', '複数の障害・SLO違反'].includes(answers.evidenceStrength)) contradictions.push({
    code: 'no-driver-vs-strong-evidence',
    fields: ['reviewDriver', 'evidenceStrength'],
    message: 'No review problem was selected while strong supporting evidence was selected.',
    codeEvidence: [],
  });

  const integrated = structuredClone(audit);
  if (integrated.applicable) {
    if (contradictions.some((item) => item.code === 'static-only-vs-request-time') && integrated.recommendation !== 'insufficient-evidence') {
      integrated.recommendation = 'modernize-first';
      integrated.nextSteps.unshift('Resolve the static-only deployment contradiction with a route inventory and representative build before architecture comparison.');
    }
    if (answers.serverCapabilityCriticality === '必須・置換困難' && audit.summary.keepValue !== 'low'
      && !['insufficient-evidence', 'modernize-first'].includes(integrated.recommendation)) {
      integrated.recommendation = 'keep';
      integrated.nextSteps.unshift('Document ownership and replacement requirements for the server capabilities reported as essential.');
    }
    if (answers.changeCapacity === '移行予算なし' && integrated.recommendation === 'migration-candidate') {
      integrated.recommendation = 'keep-and-simplify';
      integrated.nextSteps.unshift('No migration budget is available; limit action to reversible simplification and measurement.');
    }
    if (['証拠なし', '体感・単発事例'].includes(answers.evidenceStrength)) {
      integrated.nextSteps.push('Collect continuing measurements before treating the stated pain as migration evidence.');
    }
    for (const contradiction of contradictions) integrated.nextSteps.push(`Verify contradiction: ${contradiction.message}`);
  }

  return {
    continuation: integrated,
    humanEvidence: {
      ...normalized,
      implications,
      contradictions,
      recommendationBeforeHumanEvidence: audit.recommendation,
      recommendationAfterHumanEvidence: integrated.recommendation,
      rule: 'Human answers supplement repository facts and cannot independently create migration-candidate.',
    },
  };
}
