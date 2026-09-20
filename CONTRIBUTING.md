# Contributing to next-or-not

[English](CONTRIBUTING.md) · [日本語](CONTRIBUTING.ja.md)

Thanks for considering a contribution. **Issues and pull requests are welcome in English or Japanese** — write in whichever you are more comfortable with. Maintainers read both.

## What this project is

`next-or-not` decides whether an *existing* Next.js application should keep Next.js, simplify, modernize first, or enter migration discovery. It is not a framework benchmark and not a new-project chooser.

Two rules shape almost every review:

1. **Evidence over opinion.** A detection must be traceable to a file, a line, and a detection method. A recommendation must be traceable to detections.
2. **The tool never authorizes a rewrite.** It never emits `migrate`. It suggests reversible spikes and measurements.

## Getting started

```bash
git clone https://github.com/revo1290/next-or-not.git
cd next-or-not
npm install
npm run check
```

Node.js 20 or newer is required. CI runs the suite on Node 20, 22, and 24, so avoid APIs that are unavailable on Node 20.

Run the CLI against a scratch project while you work:

```bash
node scripts/assess.mjs /path/to/some-next-app
node scripts/assess.mjs /path/to/some-next-app --json --lang ja
```

## The check pipeline

`npm run check` runs everything CI runs on a pull request:

| Command | What it guards |
|---|---|
| `npm run lint` | ESLint over all sources |
| `npm test` | Unit, CLI, and i18n suites |
| `npm run validate:skill` | `SKILL.md` front matter |
| `npm run validate:docs` | README/SKILL prose against the code contract |
| `npm run dataset:validate` | The pinned calibration manifest, offline |

`npm run dataset:smoke` fetches seven pinned public repositories and needs network access; CI runs it on pull requests.

## Changing detection or decisions

A detection or decision change should include:

- a realistic regression fixture in `test/`, not a synthetic one-liner;
- a documented rationale — update `references/decision-model.md` when the derivation changes;
- an updated evidence date in `references/framework-evidence.md` when the underlying framework fact is time-sensitive.

Changes must keep the **dangerous-error gate at zero**. A dangerous error is:

- a `migration-candidate` result for a high keep-value case,
- understated maintenance risk for an unsupported or pre-release version,
- an actionable result emitted with low scan confidence.

If your change moves a dimension band, run `npm run dataset:full` and include the diff in the baseline report.

## Working with translations

All user-facing prose lives in message catalogs under `scripts/i18n/`. Analysis code never builds a sentence; it emits a message descriptor:

```js
import { msg } from './i18n/index.mjs';

maintenanceEvidence.push(msg('maintenance.mixedRouter'));
findings.push(msg('finding.router', { router: msg(`router.${signals.router}`), count: routeFiles }));
```

The renderer translates descriptors at output time. This is why `--json` can carry a stable `id` beside translated `text`, and why adding a language requires no changes to the analyzer.

### Adding a message

1. Add the key to **every** catalog in `scripts/i18n/`. `test/i18n.test.mjs` fails if a catalog is missing a key, has an empty value, or leaves a `{placeholder}` unresolved.
2. Use `{name}` placeholders rather than string concatenation, so word order can differ per language.
3. Pass nested descriptors as parameters when a message embeds another message; the translator resolves them recursively.
4. Keys are public API — they appear as `id` in `--json`. Renaming one is a breaking change.

### Adding a language

1. Copy `scripts/i18n/en.mjs` to `scripts/i18n/<tag>.mjs` and translate the values.
2. Register it in the `CATALOGS` map in `scripts/i18n/index.mjs`.
3. Set `_listSeparator` to the separator your language uses between list items.
4. Document the new value in both READMEs under *Report language*.
5. Run `npm run check`.

Keep widely used framework terms (Route Handler, Server Actions, lockfile, App Router) in their original form. A translated report that no longer matches the Next.js documentation is harder to act on, not easier.

### Changing a context field

The seven human-evidence fields are fixed by design — please do not propose an eighth scored question; extra facts belong in the free-form `note`. If you change an *option value*, note that values are locale-independent keys and are matched against every locale's display label as an alias, so previously written context files keep working. Update the tables in both READMEs; `npm run validate:docs` enforces that.

## Pull requests

- Branch from `main` and keep the change focused on one concern.
- Write the commit subject in the imperative mood (`feat: detect ...`, `fix: ...`, `docs: ...`).
- Run `npm run check` before pushing.
- Fill in the pull request template; explain what evidence the change rests on.
- A pull request that changes prose in one language should change it in all of them, or say explicitly why not.

## Releasing

Only maintainers publish. Releases are driven by a tag, so nothing reaches npm
without the full check suite and a tarball smoke test passing first.

1. Make sure `main` is green and has everything the release should contain.
2. Update `CHANGELOG.md`: move the `Unreleased` entries under a new version
   heading with today's date, and add the comparison links at the bottom.
3. Bump `version` in `package.json` to match. The workflow refuses to publish
   when the tag and `package.json` disagree.
4. Run `npm run check` locally one more time.
5. Commit, open a pull request, and merge it.
6. Tag the merge commit and push the tag:

   ```bash
   git checkout main && git pull
   git tag -a v0.7.1 -m "v0.7.1"
   git push origin v0.7.1
   ```

The `Release` workflow then runs the full check suite, verifies the tag against
`package.json`, installs the packed tarball into a clean project and runs the
CLI through its `bin` symlink in both locales, publishes with npm provenance,
and opens a GitHub release.

To rehearse without publishing, run the workflow manually from the Actions tab
with **Pack and verify without publishing** left on; it stops after the verify
job.

### One-time setup

- An npm automation token with publish rights on `next-or-not`, stored as the
  `NPM_TOKEN` repository secret.
- A repository environment named `npm-publish`. Add required reviewers to it if
  you want a human approval step before anything is sent to the registry.

Provenance requires the workflow's `id-token: write` permission, which is
already set. A published version cannot be replaced, only deprecated — so a
mistake costs a new patch version, never an overwrite.

## Reporting a bug

Open an issue with the bug template. A minimal repository layout that reproduces the wrong detection is worth more than a description of it — the analyzer is entirely deterministic on file contents, so a fixture is usually enough to diagnose.

For anything security-related, read [SECURITY.md](SECURITY.md) and report privately instead.

## Code of Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
