# Existing Next.js continuation model

## Purpose

This model triages an existing Next.js repository. It deliberately does not rank replacement frameworks: replacement choice is downstream of proving that change has material value and acceptable economics.

The model separates observed facts, bounded inferences, and facts that static analysis cannot know. This avoids the v0.1 failure mode where subjective questionnaire answers and additive weights could manufacture a precise-looking winner.

## Evidence classes

| Class | Examples | Use |
|---|---|---|
| Observed | package version, route files, imports, directives, configuration | May directly affect a dimension |
| Inferred | server integration is material, app is static/client-leaning | Must name its observed basis |
| Unknown | production cost, latency, incidents, delivery friction, roadmap | Must be supplied or measured before migration authorization |

Counts are based on unique files where possible. Path examples are capped so JSON remains usable. A repository-wide ratio is used only when at least ten or twenty source files exist; this prevents a two-file fixture from looking “100% deeply coupled.”

## Four independent dimensions

### Keep value

Keep value estimates how much detected runtime behavior needs an explicit replacement. Strong categories are:

- App Route Handlers or Pages API routes;
- Server Actions (`use server`);
- request-bound APIs imported from `next/headers`;
- cache APIs/directives;
- `getServerSideProps` or `getInitialProps`;
- proxy/middleware;
- a custom Next server.

Three or more categories, or broad server-file evidence, yields `high`. One category—or App Router without stronger evidence—yields `medium`. No server category yields `low`.

App Router alone is not treated as proof of RSC business value. The scanner cannot establish whether default Server Components are materially reducing client code or merely wrapping a client-heavy application.

### Migration coupling

Coupling estimates switching scope, not whether Next.js is good. It combines route files, files importing `next/*`, proxy/middleware, instrumentation, and server-category breadth.

- `high`: at least three server categories, at least 25 coupled-file observations, or a high ratio in a repository large enough for ratios to be meaningful;
- `medium`: one server category, at least six coupled-file observations, or a meaningful ratio in at least ten source files;
- `low`: smaller surface with no server category.

File counts are a first-order estimate only. A single central authentication proxy or cache abstraction can be more expensive to replace than many `next/link` imports.

### Maintenance risk

Maintenance risk uses a dated evidence snapshot. As reviewed 2026-09-14:

- Next.js 16 is Active LTS;
- Next.js 15 is Maintenance LTS;
- 14 and earlier are outside the documented supported versions;
- official August 2026 patched releases are 16.3.3 and 15.5.24.

An exact version is resolved only from npm lockfiles in v0.2. A declared range such as `^16.0.0` cannot prove the installed patch, so it becomes a confidence limit rather than a security finding.

`modernize-first` is triggered by unsupported or pre-release versions, an exact version below the recorded patched release, removed experimental PPR configuration, deprecated `middleware` on Next 16, or `next lint` on Next 16. The tool says “below a documented patched release,” not “vulnerable,” because advisory applicability can depend on features and deployment.

### Portability opportunity

Portability is `high` when either:

- `output: 'export'` is configured with no detected official incompatibility; or
- App Router entry files are strongly client-directed and no server category is detected.

It is `low` when keep value is high. Otherwise it is medium or low according to the available evidence.

The static-export checks cover detectable members of the official unsupported list: request-bound APIs, Server Actions, proxy/middleware, rewrites, redirects, headers, ISR/revalidation, intercepting routes, Pages API routes, default `next/image` optimization, Request-dependent Route Handlers, and dynamic routes when no `generateStaticParams` exists anywhere in the scanned app. Complete dynamic-parameter coverage and aliased/wrapped APIs still need deeper semantic analysis.

## Recommendation state machine

Recommendations are intentionally asymmetric because retaining the current system is reversible while a rewrite is expensive.

1. No Next.js dependency → `not-applicable`.
2. Low scan confidence → `insufficient-evidence`.
3. High maintenance risk or a static-export contradiction → `modernize-first`.
4. High keep value → `keep`.
5. High portability plus low coupling → `migration-candidate`.
6. Low keep value or high portability with remaining coupling → `keep-and-simplify`.
7. Otherwise → `keep`.

`migration-candidate` means that a reversible comparison may be worth funding. It does not mean that migration is economically justified.

## Confidence

Confidence describes whether the scan had enough trustworthy repository evidence:

- `high`: complete scan, recognized router, exact npm lockfile version, one Next workspace;
- `medium`: usable result with an unresolved exact version, multiple aggregated Next workspaces, skipped large files, or a stale evidence snapshot;
- `low`: truncated scan, repeated read errors, or no recognized route structure.

Confidence never means “80% likely to be correct.” Business evidence can reverse a high-coverage repository conclusion.

## Required human or runtime evidence

Before authorizing migration, add:

1. The concrete pain to remove, with incident, delivery, cost, or SLO evidence.
2. A route inventory and deployed rendering classification.
3. Hosting topology, cache ownership, response semantics, and observability requirements.
4. A representative route spike with the same data, auth, UI, and deployment class.
5. Measured build/runtime/client-output differences.
6. Conversion estimate for a median-coupling route and worst-case route.
7. Rollback path, retraining cost, and opportunity cost.

If those facts do not demonstrate material benefit beyond switching cost, retain the existing system even when another framework appears simpler in isolation.
