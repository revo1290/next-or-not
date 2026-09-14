# Decision model

The model distinguishes capability, suitability, and switching economics. It is intentionally inspectable and conservative: the CLI never emits an automatic `migrate` action.

## Inputs

| Field | Values | Decision represented |
|---|---|---|
| `audience` | `public`, `authenticated`, `mixed`, `unknown` | Whether routes need to work for anonymous users and crawlers |
| `content` | `content`, `app`, `mixed`, `unknown` | Content-first pages versus interaction-heavy application UI |
| `seo` | `low`, `medium`, `high`, `unknown` | Importance of initial HTML, crawl discovery, metadata, and non-JS bots |
| `rendering` | `csr`, `static`, `ssr`, `hybrid`, `unknown` | The required deployment-time/request-time rendering behavior |
| `serverData` | `none`, `simple`, `complex`, `unknown` | Need to compose server-only data during page rendering |
| `rsc` | `none`, `useful`, `required`, `unknown` | Whether RSC solves a measured requirement rather than being preferred by default |
| `backend` | `separate`, `bff`, `none`, `unknown` | Whether backend capabilities live elsewhere or with the UI |
| `hosting` | `static`, `node`, `edge`, `vercel`, `flexible`, `unknown` | Hard runtime and provider constraints |
| `maturity` | `strict`, `balanced`, `experimental`, `unknown` | Tolerance for beta/pre-1.0 framework risk |
| `migration` | `new`, `existing-next`, `existing-other`, `unknown` | Whether switching cost must be considered |

An answers file is a flat JSON object:

```json
{
  "audience": "authenticated",
  "content": "app",
  "seo": "low",
  "rendering": "csr",
  "serverData": "none",
  "rsc": "none",
  "backend": "separate",
  "hosting": "static",
  "maturity": "strict",
  "migration": "new"
}
```

## Hard constraints before scoring

Scores rank plausible fit; they do not repair contradictory requirements.

- Static-only hosting conflicts with request-time SSR and runtime server functions. Build-time RSC and prerendering can still produce static output.
- A stated RSC requirement strongly favors Next.js today, but first verify that the requirement is about the RSC execution model rather than ordinary SSR, route loaders, or server-only API access.
- A strictly authenticated application has little search-indexing value, but public login, help, marketing, and shared-link routes can still justify mixed rendering.
- An external backend does not make SSR useless. It does reduce the value of colocating a broad application backend inside the UI framework.

## Candidate boundaries

### Next.js App Router

Favor when a React application has a concrete need for the most complete RSC integration, per-route hybrid rendering, Server Functions coupled to UI mutations, or first-party Vercel operations. Do not mark it required merely because the project needs React, SEO, SSR, static output, routing, image handling, or a BFF: alternatives cover each of those capabilities.

### React Router Framework Mode

Favor when the team wants React, stable framework primitives, loaders/actions, Web API-oriented request handling, and a choice of CSR, SSR, or prerendering without making RSC central. React Router's official RSC APIs are currently marked unstable; do not treat them as equivalent to Next.js for a strict-maturity project without rechecking.

### TanStack Start

Favor when route-level type safety, TanStack ecosystem integration, and selective SSR (`true`, `false`, or `data-only`) materially simplify the application. Its current official status is beta/pre-1.0 in the evidence snapshot. A strict-maturity organization needs an explicit exception, upgrade strategy, and production spike.

### Astro

Favor content-first sites whose default output should be static HTML, with isolated interactive islands and selected on-demand routes. Validate carefully for application-first products with dense shared client state or continuous interaction across most of the page.

### Vite SPA

Favor authenticated/internal application UIs backed by an independently owned API when client rendering and static asset deployment meet the requirements. Select a router and data layer deliberately. Vite is a build tool, not an application framework; the team owns conventions for routing, data, mutations, error boundaries, authentication integration, and SSR if later added.

## Verdict semantics

| Verdict | Meaning |
|---|---|
| `Next.js required` | A verified hard requirement currently makes Next.js materially unique, normally the most complete stable RSC integration |
| `Next.js strong fit` | Next.js leads the heuristic by a meaningful margin, but alternatives may still work |
| `Next.js viable but not required` | Next.js satisfies the constraints but has no decisive advantage |
| `Next.js not justified` | At least one alternative fits materially better and no verified hard requirement offsets the extra surface |
| `Insufficient evidence` | Too few project constraints are known to make a responsible recommendation |

## Existing-system actions

The fit decision and action decision are separate.

- `keep`: Next.js remains the leading or near-leading fit after switching cost.
- `reduce Next-specific surface`: the target architecture may be simpler, but existing coupling makes an immediate rewrite poor economics. New code should stop deepening unnecessary coupling while a seam is established.
- `run migration spike`: an alternative leads materially and detected Next-specific coupling is low. Rebuild one representative vertical slice and measure build, runtime, operability, and delivery impact.
- `migrate`: reserved for a human/agent conclusion after the spike demonstrates material value. The deterministic CLI does not emit it.

## Required report evidence

For a high-confidence recommendation, record:

1. A route inventory: public/indexed, public/non-indexed, authenticated, static, request-time dynamic.
2. The actual need behind SSR or RSC, including what users or systems fail without it.
3. Backend ownership and deployment topology.
4. Required response semantics: status codes, headers, cookies, streaming, caching, invalidation, and personalization.
5. Provider constraints and whether platform-specific behavior is acceptable.
6. Framework maturity and upgrade policy.
7. Existing framework-specific surface and a migration estimate for representative routes.
8. Project-specific measurements where performance or cost is part of the decision.

## Score interpretation

Every candidate starts at 50 and receives documented positive or negative adjustments. The JSON output lists each adjustment. Scores are capped at 0–100 only for readability; they are ordinal heuristics, not probabilities, benchmarks, market data, or evidence of business value.

Change weights only when a test captures the intended before/after decision and the rationale is documented. Avoid tuning weights to force a preferred framework to win a single example.
