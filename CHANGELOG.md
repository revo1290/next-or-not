# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] - 2026-09-20

### Fixed

- **The CLI did nothing when invoked through an installed `bin` symlink.** The
  entry-point guard compared `path.resolve(process.argv[1])` with the module
  path, and `path.resolve` does not follow symlinks. Running
  `node_modules/.bin/next-or-not` — which is how both a local install and
  `npx` invoke it — exited 0 having printed nothing. The guard now compares
  real paths (`scripts/entrypoint.mjs`), and a regression test invokes the CLI
  through a symlink. This affected `scripts/assess.mjs`,
  `scripts/evaluate-dataset.mjs`, and `scripts/validate-docs.mjs`.

### Added

- `npm run validate:package` packs the real tarball and asserts the published
  contract: every module the CLI needs is present, tests and CI configuration
  are absent, and the `bin` is executable with a shebang. It runs as part of
  `npm run check`.
- A `Release` workflow, driven by a `v*.*.*` tag. It runs the full check
  suite, refuses to publish when the tag disagrees with `package.json`,
  installs the packed tarball into a clean project and runs the CLI through
  its `bin` symlink in both locales, then publishes with npm provenance and
  opens a GitHub release.
- `publishConfig` with `access: public` and `provenance: true`.

## [0.7.0] - 2026-09-20

### Added

- **Japanese report language.** `--lang en` / `--lang ja`, falling back to
  `NEXT_OR_NOT_LANG`, then `LC_ALL` / `LC_MESSAGES` / `LANG`, then English. An
  unrecognized environment value falls back silently; an unrecognized `--lang`
  is an error, so a typo cannot quietly change the report.
- A message-catalog layer under `scripts/i18n/`. Analysis code emits
  `msg(id, params)` descriptors instead of building prose, and the renderer
  translates at output time.
- `README.ja.md`, `CONTRIBUTING.md` / `CONTRIBUTING.ja.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, bilingual issue templates and a pull
  request template.
- `npm run validate:docs`, which fails when the prose drifts from the code:
  missing recommendation states, undocumented context values or locales,
  broken relative links, message-catalog key mismatches.
- ESLint with a flat configuration, and `npm run lint`.
- Dimension labels align by display width, counting CJK characters as two
  columns.

### Changed

- **Human-evidence option values are now locale-independent keys** such as
  `delivery-speed` and `no-budget`. They were previously Japanese display
  labels used as JSON identifiers, which meant a non-Japanese speaker could
  not write a `--context` file at all. Display labels from any bundled locale
  are still accepted as aliases, so existing context files keep working, and
  `suppliedAnswers` preserves whatever was written.
- **JSON output is `schemaVersion: 5`** and carries a `locale` field.
  Human-readable entries — `findings`, `nextSteps`, `unknowns`,
  `confidence.basis`, contradiction and implication text — are now
  `{ id, params, text }` objects. Structural values (`recommendation`,
  dimension levels, `router`, `confidence.level`, context field names and
  values) remain locale-independent identifiers.
- `normalizeHumanContext` returns `schemaVersion: 2`, adding `suppliedAnswers`
  and `answerLabels`.
- CI runs on Node 20, 22 and 24, and now includes lint and documentation
  validation.
- Both READMEs document the accepted `--context` values, which were previously
  undocumented.

### Fixed

- An unused destructured binding in `scripts/analyzers/ast.mjs`, a dead
  `exists` helper in `scripts/assess.mjs`, and an unexplained empty catch in
  `scripts/resolvers/next-version.mjs`, all surfaced by the new lint step.

### Migration notes

No decision logic changed: the four dimension computations, the recommendation
ladder, and the dangerous-error conditions are untouched.

- Reading `--json`? Human-readable entries are objects now. Use `.text` for
  display and `.id` when a conclusion depends on a specific detection. Never
  key off `text`.
- Writing `--context` files? Japanese values still work. New files should use
  the canonical keys documented in the README.

[Unreleased]: https://github.com/revo1290/next-or-not/compare/v0.7.1...HEAD
[0.7.1]: https://github.com/revo1290/next-or-not/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/revo1290/next-or-not/releases/tag/v0.7.0
