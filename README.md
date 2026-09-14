# next-or-not

`next-or-not` checks whether Next.js is **required**, merely **a good fit**, or **unjustified** for a project. It combines a zero-dependency repository scanner, an explainable decision model, and an installable agent skill for Codex or other skill-aware coding agents.

It is deliberately not an anti-Next.js tool. Next.js supports SPA and static export, can be self-hosted, and remains the most complete React Server Components implementation. The tool makes those facts compete with equally real costs: rendering complexity, hosting constraints, framework coupling, maturity requirements, and migration economics.

## Quick start

```bash
git clone https://github.com/revo1290/next-or-not.git
cd next-or-not
node scripts/assess.mjs /path/to/project
```

For non-interactive use, supply an answers file:

```bash
node scripts/assess.mjs /path/to/project --answers answers.json --json
```

The answer fields and scoring rules are documented in [`references/decision-model.md`](references/decision-model.md). Scores are transparent heuristics, not probabilities or benchmark results.

## Agent skill

Copy or link this repository into your agent's skill directory, then invoke `$next-or-not`. The skill instructs the agent to inspect code, fill evidence gaps, verify time-sensitive framework claims, and distinguish:

1. whether Next.js is actually required;
2. whether it is still a sound choice;
3. whether an existing application is worth migrating.

## What is inspected

The scanner reads `package.json`, framework configuration, and source file names/content while skipping generated and dependency directories. It reports signals such as:

- App Router and Pages Router usage;
- Client/Server Component directives;
- Route Handlers and Server Actions;
- Next.js cache, image, font, and metadata APIs;
- static export configuration;
- alternative router/framework dependencies.

No source code or telemetry leaves the machine.

## Supported candidates

- Next.js App Router
- React Router Framework Mode
- TanStack Start
- Astro
- Vite SPA with React Router or TanStack Router and an optional separate API/BFF

The initial scope is React-centered. Astro is included because content-heavy sites are a common case where a React full-stack framework may be unnecessary.

## Research standard

Capabilities and maturity are sourced primarily from official React, Next.js, React Router, TanStack, Astro, Vite, Hono, and Google Search documentation. The evidence snapshot and limitations are in [`references/framework-evidence.md`](references/framework-evidence.md), last reviewed 2026-09-13.

The article [そのプロジェクト、本当にNext.js必要？](https://ashunar0.dev/posts/does-your-project-need-nextjs/) motivated the project. Its claims are treated as hypotheses and checked against current primary sources rather than copied as rules.

## Contributing

Framework capabilities change quickly. A decision-rule change should include:

- an official source or a clearly labeled analytical rationale;
- a test showing the decision that changes;
- an updated review date when time-sensitive evidence changes.

Run `npm test` before opening a pull request.

## License

MIT
