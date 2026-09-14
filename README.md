# next-or-not

`next-or-not` audits an **existing Next.js repository** and answers a narrower, safer question than a framework leaderboard:

> Should this application keep Next.js, simplify its Next-specific surface, modernize first, or become a candidate for measured migration discovery?

It is a read-only AST analyzer plus an installable agent skill. It does not execute project code, package scripts, upload source, or authorize a rewrite.

## Quick start

```bash
git clone https://github.com/revo1290/next-or-not.git
cd next-or-not
node scripts/assess.mjs /path/to/existing-next-app
```

For machine-readable evidence:

```bash
node scripts/assess.mjs /path/to/existing-next-app --json
```

## What changed in v0.2

The first version ranked frameworks using user-supplied answers and additive scores. That was explainable, but too sensitive to subjective inputs and arbitrary weights. v0.2 instead audits four independent dimensions:

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
- declared versions and exact npm lockfile versions;
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

## Limits

Static analysis cannot establish production latency, traffic shape, cache hit rates, infrastructure cost, incidents, team productivity, roadmap, or migration budget. It also cannot prove deployed rendering behavior without observing a build and runtime, and it does not perform whole-program data flow across wrapper modules. The tool therefore never emits `migrate`.

Only npm lockfiles are currently resolved to an exact Next.js version. pnpm, Yarn, and Bun projects retain the declared range and receive a confidence limit until lockfile parsers are added.

## Contributing

Run the complete check before opening a pull request:

```bash
npm run check
```

A detection or decision change should include a realistic regression fixture, a documented rationale, and an updated evidence date when the underlying framework fact is time-sensitive.

## License

MIT
