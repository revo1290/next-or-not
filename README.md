# next-or-not

[![CI](https://github.com/revo1290/next-or-not/actions/workflows/ci.yml/badge.svg)](https://github.com/revo1290/next-or-not/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**English** · [日本語](README.ja.md)

`next-or-not` audits an **existing Next.js repository** and answers a narrower, safer question than a framework leaderboard:

> Should this application keep Next.js, simplify its Next-specific surface, modernize first, or become a candidate for measured migration discovery?

It is a read-only AST analyzer plus an installable agent skill. It does not execute project code, package scripts, upload source, or authorize a rewrite.

Reports are available in **English and Japanese** (`--lang en` / `--lang ja`); see [Report language](#report-language).

## Quick start

```bash
git clone https://github.com/revo1290/next-or-not.git
cd next-or-not
npm install
node scripts/assess.mjs /path/to/existing-next-app
```

Without cloning:

```bash
npx next-or-not /path/to/existing-next-app
```

> npm releases start at **v0.7.1**. Until that tag is published, use
> `npx github:revo1290/next-or-not` instead — the same command, built from the
> default branch.

<details>
<summary>Example output</summary>

```text
Recommendation: keep
Confidence: high
Router: app

Decision dimensions:
  Keep value:               medium
  Migration coupling:       medium
  Maintenance risk:         low
  Portability opportunity:  low

Observed findings:
  - Detected app router usage across 2 route-related file(s).
  - .: 16.3.5 (lockfile: package-lock.json) — 16.x is Active LTS in the evidence snapshot.
  - Route Handlers: 1 file(s) (app/api/items/route.ts)
  - Request-bound APIs: 1 file(s) (app/page.tsx)

Next checks:
  - Document which detected server capabilities justify Next.js and add regression coverage for their cache and runtime behavior.
  - Add project evidence for hosting constraints, operational pain, and migration budget before authorizing a rewrite.

This is migration triage, not authorization to rewrite. Use --json for file-level evidence.
```

</details>

For machine-readable evidence:

```bash
npx next-or-not /path/to/existing-next-app --json
```

### Requirements

Node.js 20 or newer. The scan reads files only; it never installs dependencies, runs package scripts, or sends source over the network.

## Report language

| Selector | Example | Precedence |
|---|---|---|
| `--lang` | `--lang ja` | 1 (highest) |
| `NEXT_OR_NOT_LANG` | `NEXT_OR_NOT_LANG=ja` | 2 |
| `LC_ALL`, `LC_MESSAGES`, `LANG` | `LANG=ja_JP.UTF-8` | 3 |
| default | — | `en` |

Supported values are `en` and `ja`. An unrecognized **environment** value falls back to English silently; an unrecognized `--lang` value is an error, so a typo never silently changes the report.

Language affects prose only. Recommendation states, dimension levels, router names, field names, and context values are locale-independent identifiers and never change. With `--json`, each message carries both a stable `id` and the translated `text`:

```json
{
  "id": "finding.router",
  "params": { "router": "app", "count": 2 },
  "text": "Detected app router usage across 2 route-related file(s)."
}
```

That makes the JSON output safe to assert on in CI regardless of the reader's locale. To add a language, copy `scripts/i18n/en.mjs`, translate the values, and register it in `scripts/i18n/index.mjs`; the test suite fails if any catalog is missing a key.

## Human evidence supplement

Seven non-code facts can change the action without replacing repository evidence:

```bash
npx next-or-not /path/to/existing-next-app --context context.json
npx next-or-not /path/to/existing-next-app --interactive
```

`--interactive` prompts only in a TTY and skips fields already supplied by `--context`. A context file may contain the fields directly or below `answers`:

```json
{
  "answers": {
    "reviewDriver": "delivery-speed",
    "evidenceStrength": "continuous-measurement",
    "productionRouteProfile": "mixed",
    "deploymentConstraint": "node-container",
    "serverCapabilityCriticality": "important-but-replaceable",
    "roadmapDirection": "status-quo",
    "changeCapacity": "small-spike-only"
  },
  "note": "Additional facts belong in this one free-form note."
}
```

### Accepted values

| Field | Values |
|---|---|
| `reviewDriver` | `no-clear-problem`, `delivery-speed`, `reliability-incidents`, `hosting-compliance`, `infrastructure-cost`, `unknown` |
| `evidenceStrength` | `none`, `anecdotal`, `continuous-measurement`, `repeated-incidents`, `unknown` |
| `productionRouteProfile` | `mostly-static-public`, `mostly-authenticated-client`, `mostly-request-time-dynamic`, `mixed`, `unknown` |
| `deploymentConstraint` | `static-only`, `node-container`, `edge-runtime`, `vercel-managed`, `flexible`, `unknown` |
| `serverCapabilityCriticality` | `unused`, `easily-replaceable`, `important-but-replaceable`, `essential`, `unknown` |
| `roadmapDirection` | `simplify-to-static-client`, `status-quo`, `more-server-integration`, `undecided`, `unknown` |
| `changeCapacity` | `no-budget`, `small-spike-only`, `incremental-migration`, `full-migration`, `unknown` |

Every field accepts `unknown`; blank interactive answers become `unknown`. Invalid values are also converted to `unknown` with a structured validation error instead of affecting the recommendation.

Display labels from any bundled locale are accepted as aliases, so context files written before v0.7 — whose values were Japanese labels such as `開発速度` — keep working unchanged. JSON output reports the canonical key in `rawAnswers` and preserves whatever you wrote in `suppliedAnswers`.

The seven fields are fixed: review driver, evidence strength, production route profile, deployment constraint, server-capability criticality, 12–18 month roadmap, and change capacity. Additional information goes into `note`, not an eighth scored question.

Raw answers, derived implications, code/context contradictions, validation errors, and the recommendation before/after integration are separate in JSON. Answers cannot erase code evidence or independently create `migration-candidate`. Low-strength pain remains a measurement task; static-only deployment conflicting with request-time code becomes a configuration investigation; and unavailable migration capacity constrains action to reversible simplification.

## What the audit measures

The first version ranked frameworks using user-supplied answers and additive scores. That was explainable, but too sensitive to subjective inputs and arbitrary weights. The tool instead audits four independent dimensions:

| Dimension | Question |
|---|---|
| Keep value | Which detected Next.js server/runtime capabilities would require an explicit replacement? |
| Migration coupling | How broadly do routing, imports, server behavior, and configuration depend on Next.js? |
| Maintenance risk | Is the app behind the current support-policy snapshot or carrying known upgrade residue? |
| Portability opportunity | Is there concrete evidence that the app is static/client-leaning with little server coupling? |

Results use `low`, `medium`, and `high` bands rather than probability-looking scores. Confidence describes **scan coverage**, not certainty that the recommendation is commercially correct.

## Automatic evidence

The scanner detects:

- Next.js workspaces inside monorepos;
- declared versions and exact installed/lockfile versions from npm, pnpm, Yarn, and Bun projects;
- App Router, Pages Router, and mixed-router applications;
- pages, layouts, Route Handlers, and Pages API routes;
- `use client`, `use server`, and `use cache` boundaries;
- used bindings and re-exports from `next/headers`, `next/cache`, `next/server`, `next/navigation`, `next/image`, `next/font`, `next/link`, and `next/script`, including aliases, multiline declarations, dynamic imports, and CommonJS `require`;
- `getServerSideProps`, `getStaticProps`, `getStaticPaths`, and `getInitialProps`;
- proxy, deprecated middleware, instrumentation, custom servers, route runtime and revalidation settings;
- static export, standalone output, Cache Components, image loader choices, rewrites, redirects, headers, custom webpack, and removed experimental PPR configuration;
- Next 16 upgrade residue such as `middleware` and `next lint`;
- static-export contradictions documented by Next.js.

Static-export analysis includes request-dependent Route Handlers and dynamic App Router routes with no detected `generateStaticParams` implementation. These are conservative source checks; a real build remains stronger evidence.

JavaScript, TypeScript, JSX, and TSX are parsed with Babel. Comments, ordinary strings, type-only imports, unused imports, and unrelated same-name functions are not treated as runtime evidence. Route Handler Request parameters are counted only when their binding is referenced. Each signal retains summary counts and includes bounded file, line, and `detectionMethod` evidence in JSON output. Parse failures are explicit and use only a limited fallback, which lowers confidence. Generated output, dependencies, and large files are excluded and reported as confidence limits. Parser selection is documented in [`references/adr-001-javascript-parser.md`](references/adr-001-javascript-parser.md).

Version resolution is read-only and workspace-specific. The precedence is: workspace-installed package, root-hoisted installed package, matching workspace lock entry, root lock entry, exact `package.json` declaration, then explicit unresolved status. JSON output records the chosen source, lockfile and schema version, alternative candidates, warnings, and parse failures. Supported inputs are `package-lock.json` v1–v3, `npm-shrinkwrap.json`, current and major older `pnpm-lock.yaml` structures, Yarn Classic and Berry `yarn.lock`, and Bun text `bun.lock`. Installed packages and lockfiles are compared instead of silently choosing one.

## Recommendation semantics

| Recommendation | Meaning |
|---|---|
| `keep` | Detected server/runtime value is material, or Next.js remains the least speculative continuation. |
| `keep-and-simplify` | No rewrite case is established, but new code should avoid unnecessary Next-specific surface. |
| `modernize-first` | Patch/support/deprecation or configuration contradictions would contaminate a migration comparison. |
| `migration-candidate` | Static/client-leaning evidence and low coupling justify a reversible comparison spike—not migration itself. |
| `insufficient-evidence` | Repository coverage is too weak for a responsible recommendation. |
| `not-applicable` | No `next` dependency was found. |

The detailed derivation and known blind spots are in [`references/decision-model.md`](references/decision-model.md).

## Agent skill

Install or link this repository as a skill and invoke `$next-or-not`. The skill runs the audit, verifies material findings in source, asks only for business facts that cannot be derived from code, and produces a continuation decision with a rollback-safe validation plan.

## Research standard

The bundled research report uses official Next.js and React documentation for capabilities and support status. It distinguishes source-detectable facts from inferences and non-detectable business evidence. See [`references/framework-evidence.md`](references/framework-evidence.md), reviewed **2026-09-14**.

The article [そのプロジェクト、本当にNext.js必要？](https://ashunar0.dev/posts/does-your-project-need-nextjs/) motivated the project. Its arguments are treated as hypotheses, not scoring rules.

## Real-world calibration

`dataset/real-world.json` freezes 30 public Next.js repositories at full commit SHAs. The set covers App Router, Pages Router, mixed and content-oriented applications; server routes; single-package and monorepo layouts; npm, pnpm, Yarn and Bun; and supported, unsupported and pre-release versions. Every record includes license provenance, workspace, expected version/router/features, four independently assigned expert labels, an allowed recommendation set, rationale, review status and known ambiguity.

The labels were recorded before running this tool. The evaluator retains disagreements and reports signal precision/recall, parser and lockfile failures, router/dimension/recommendation agreement, dangerous-error rate, confidence calibration and slices by router, package manager, project size and support class. It only fetches pinned Git objects and reads source; it never installs dependencies or executes repository code.

```bash
npm run dataset:validate              # offline manifest and coverage checks
npm run dataset:smoke                 # seven-repository CI subset
npm run dataset:full                  # all 30, writes JSON plus the baseline report
```

Pull requests run the fixed smoke set. A scheduled or manually dispatched workflow runs the complete set. The initial results and label-disagreement policy are documented in [`references/calibration-baseline.md`](references/calibration-baseline.md).

## Limits

Static analysis cannot establish production latency, traffic shape, cache hit rates, infrastructure cost, incidents, team productivity, roadmap, or migration budget. It also cannot prove deployed rendering behavior without observing a build and runtime, and it does not perform whole-program data flow across wrapper modules. The tool therefore never emits `migrate`.

Legacy binary `bun.lockb` is identified but not guessed. If no safe installed-package fallback exists, the version remains unresolved with `unsupported-binary-lockfile` provenance. Malformed, oversized, or unsupported lockfiles also remain explicit confidence limits. Installed-package symlinks that resolve outside the scanned repository are not followed.

## Contributing

Contributions are welcome in English or Japanese — see [CONTRIBUTING.md](CONTRIBUTING.md) ([日本語版](CONTRIBUTING.ja.md)) and the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security issue, read [SECURITY.md](SECURITY.md) first.

Run the complete check before opening a pull request:

```bash
npm run check
```

A detection or decision change should include a realistic regression fixture, a documented rationale, and an updated evidence date when the underlying framework fact is time-sensitive.

Changes must keep the dangerous-error gate at zero. A dangerous error is a migration-candidate result for a high keep-value case, understated unsupported/pre-release maintenance risk, or an actionable result emitted with low scan confidence.

## License

MIT — see [LICENSE](LICENSE).
