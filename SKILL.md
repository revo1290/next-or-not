---
name: next-or-not
description: Audit a proposed or existing React web project to decide whether Next.js is required, merely suitable, or a poor fit, and compare evidence-based alternatives. Use for framework selection, Next.js adoption reviews, and migration feasibility; do not use for routine Next.js implementation work.
---

# Next or Not

Produce a defensible architecture recommendation, not a framework popularity vote.

## Workflow

1. Establish whether this is a new build or an existing system. For an existing repository, run the bundled `scripts/assess.mjs` resolved from this skill directory as `node <skill-path>/scripts/assess.mjs <project-path> --json`, then inspect the reported evidence. The script is advisory; confirm material findings in source and configuration.
2. Identify only the unanswered constraints that could change the result: audience/indexability, rendering needs by route, backend ownership, hosting/runtime limits, React Server Components (RSC) value, maturity tolerance, and migration cost. Ask concise questions when these cannot be inferred.
3. Read [references/decision-model.md](references/decision-model.md) before comparing candidates. Read [references/framework-evidence.md](references/framework-evidence.md) when a claim about framework capability, status, or portability affects the recommendation.
4. If internet access is available and the decision is consequential, verify time-sensitive claims against the linked official documentation. Record an `as of` date. Do not treat blog opinion, download counts, stars, or synthetic benchmarks as architectural proof.
5. Separate three conclusions:
   - **Necessity:** a hard requirement uniquely or materially favors Next.js.
   - **Fit:** Next.js is a reasonable choice even though alternatives satisfy the requirements.
   - **Change economics:** an existing Next.js application should remain or migrate after accounting for migration and retraining cost.
6. Return a short verdict, observed evidence, assumptions, a candidate comparison, risks, and the smallest validation plan that could resolve remaining uncertainty.

## Guardrails

- Never equate SEO with an automatic Next.js requirement. Static prerendering and SSR are available elsewhere, and Google can render JavaScript with caveats.
- Never claim Next.js requires Vercel. Distinguish core self-hosting support from provider-specific operational parity and convenience.
- Never recommend a rewrite from score alone. Require a material capability, reliability, cost, or delivery advantage that exceeds migration cost.
- Treat RSC and Server Functions as capabilities with boundary and operational costs, not universal upgrades.
- Treat a pre-1.0 or beta candidate's maturity as a material production constraint. Verify current status before relying on the bundled snapshot.
- Do not publish performance, bundle-size, cost, or productivity rankings without project-specific measurement.
- Prefer the simplest architecture that satisfies known requirements, but include likely near-term requirements when there is concrete roadmap evidence.

## Output contract

Use one of these verdicts: `Next.js required`, `Next.js strong fit`, `Next.js viable but not required`, `Next.js not justified`, or `Insufficient evidence`.

For existing Next.js systems, append a separate action: `keep`, `reduce Next-specific surface`, `run migration spike`, or `migrate`. A migration recommendation must name the triggering evidence and a rollback-safe proof-of-concept.

Include the CLI's scores only as an explainable heuristic, never as probabilities or benchmark results.
