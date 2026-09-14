# Calibration dataset

`real-world.json` is a manually reviewed manifest of 30 public Next.js repositories. It records only repository metadata, fixed commit identifiers, evidence paths and expert labels; no third-party source is redistributed.

## Selection

Each case must be public at review time, contain a Next.js application at the recorded workspace, have a confirmed repository or package license, and be pinned to a full commit SHA. The collection is stratified across:

- App Router, Pages Router and mixed-router code;
- static/content sites and server-integrated products;
- Server Actions, route handlers/API routes and cache APIs;
- self-hosted applications and an explicit deployment-adapter fixture;
- single-package repositories and monorepo workspaces;
- npm, pnpm, Yarn and Bun lockfile families;
- supported, unsupported and pre-release Next.js versions.

The manifest's `coverageGroups` makes the non-exclusive profile claims auditable. `evidencePaths` and `license.evidencePath` are verified in the pinned checkout before a case is evaluated.

## Label protocol

Reviewers inspect the pinned tree and record `routerExpected`, `featureExpectations`, all four decision dimensions, an allowed recommendation set, rationale and ambiguity before viewing next-or-not output. A later tool disagreement is appended to the generated report; it does not silently mutate the human label. Proposed label changes require a manifest diff, rationale and a new review date.

Positive feature expectations are recorded explicitly. The evaluator derives negative App-vs-Pages route checks from `routerExpected`, so both false positives and false negatives contribute to precision and recall.

## Safe execution

The evaluator invokes only Git plumbing needed to fetch and materialize a pinned tree. It uses sparse checkout for monorepos, verifies the resulting SHA and evidence paths, and then calls the same read-only scanner as the CLI. It never runs package-manager install commands, builds, tests or any code from a sampled repository.

The dangerous-error gate fails when the tool:

- marks a high keep-value case as `migration-candidate`;
- understates maintenance risk for an unsupported or pre-release case; or
- emits an actionable recommendation at low scan confidence.

Clone and scan failures are reported separately and make the evaluator exit non-zero. Full JSON results retain per-case checks and are the source for `references/calibration-baseline.md`.

