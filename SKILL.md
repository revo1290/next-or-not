---
name: next-or-not
description: Audit an existing Next.js repository to decide whether to keep it, simplify Next-specific surface, modernize first, or investigate migration. Use for Next.js continuation and migration-feasibility reviews; do not use for new-project framework selection or routine implementation work.
---

# Next or Not

Produce a defensible continuation decision for an existing Next.js system. Repository signals establish architecture facts; they do not establish business value.

## Workflow

1. Resolve this skill's directory and run `node <skill-path>/scripts/assess.mjs <project-path> --json`. The command is read-only and does not execute project code.
2. Confirm material detections in the listed source/configuration evidence. The scanner uses AST bindings and records file, line, and detection method. Confirm each workspace's `resolution.source`, warnings, and errors; then pay particular attention to any `regex-fallback` result, server APIs, mixed routers, static-export conflicts, and deprecated Next 16 patterns.
3. Read [references/decision-model.md](references/decision-model.md) to interpret the four dimensions and recommendation states. Read [references/framework-evidence.md](references/framework-evidence.md) when support policy, feature compatibility, or a framework claim affects the conclusion.
4. Ask only for facts source inspection cannot establish and that could change the action: production pain, hosting constraints, incident/cost evidence, near-term roadmap, team ownership, and migration budget.
5. If the decision is consequential and internet access is available, refresh time-sensitive support/security claims from the linked official sources. State the verification date. A stale bundled snapshot lowers confidence; it does not prove a version is unsupported.
6. Return a continuation decision, not a framework popularity comparison. Include observed facts, inferences, unknowns, risks, and the smallest rollback-safe validation step.

## Decision separation

Keep these conclusions independent:

- **Keep value:** detected Next.js server/runtime capabilities that require an intentional replacement.
- **Migration coupling:** conversion scope created by routing, imports, configuration, and server semantics. Coupling is switching cost, not proof of architectural value.
- **Maintenance risk:** support-policy, patch, deprecation, and mixed-router signals. Resolve avoidable maintenance debt before attributing it to the framework.
- **Portability opportunity:** concrete static/client-leaning evidence with limited server coupling. This creates a migration candidate, not a migration order.

## Guardrails

- Never recommend a rewrite from static analysis, a score, framework sentiment, download counts, or public synthetic benchmarks.
- Never present a fallback detection as equivalent to an AST detection. Name parser failures and reduce confidence.
- Never convert “few server features detected” into “Next.js has no value.” Record possible missed dynamic behavior and verify a production build or representative route.
- Never treat framework coupling as a positive fit signal. It affects change economics only.
- Never label a version vulnerable solely because it is below a bundled patch floor. Say that it is below the documented patched release and verify advisory applicability.
- Never infer a lockfile version when parsing fails. Preserve `unresolved`, `malformed-lockfile`, or `unsupported-binary-lockfile` output and lower confidence.
- Never equate SEO with a Next.js requirement, or Next.js with mandatory Vercel hosting.
- Do not run `next build`, package scripts, codemods, upgrades, or migrations without the user's authorization; these execute or mutate project code.
- Preserve the existing application while testing alternatives. A valid spike uses one representative vertical slice and has an explicit rollback path.

## Output contract

Use exactly one CLI recommendation state:

- `keep`
- `keep-and-simplify`
- `modernize-first`
- `migration-candidate`
- `insufficient-evidence`
- `not-applicable`

Report confidence as scan coverage (`low`, `medium`, or `high`), never as outcome probability. If recommending further migration discovery, name the triggering repository evidence and the business/operational measurement still required. The skill itself must not emit `migrate`.
