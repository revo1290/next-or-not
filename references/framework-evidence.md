# Framework evidence and analytical assessment

## Executive finding

Next.js is rarely *strictly required*. It is, however, a defensible default for some React products and currently the strongest documented choice when the most complete React Server Components integration is a real requirement. SSR, prerendering, SPA delivery, hybrid routes, metadata, and backend-for-frontend endpoints do not individually make Next.js unique.

The strongest decision rule is therefore not “public pages use Next.js; private pages use Vite.” The defensible rule is to inventory route-level delivery requirements, server/UI coupling, operating constraints, maturity tolerance, and the economics of changing an existing system.

This evidence snapshot was reviewed on **2026-09-13**. Framework versions and maturity labels are time-sensitive and must be rechecked for consequential decisions.

## Findings by question

### Does React itself require Next.js?

No. React's official guidance recommends starting new React apps and sites with a framework. It lists Next.js App Router and React Router v7 as recommended full-stack frameworks. The same guidance says these frameworks can support CSR, SPA, SSG, and per-route server rendering, and it identifies TanStack Start as an up-and-coming beta framework.[^1]

Analytical implication: “React recommends a framework” supports choosing an integrated framework over assembling infrastructure casually, but it does not establish Next.js as the only production path. A Vite SPA remains reasonable when a project's constraints are intentionally not served by a full-stack framework, provided the team explicitly owns routing, data, error, and deployment conventions.

### Are SEO and initial HTML unique to Next.js?

No. React Router Framework Mode documents CSR, SSR, and static prerendering; server rendering is global while individual routes can still be prerendered.[^2] Astro prerenders pages by default and can opt selected routes into on-demand rendering.[^3] TanStack Start documents route-level SSR, client-only rendering, and a `data-only` option.[^4]

Google Search runs JavaScript, but its own documentation describes separate crawling, rendering, and indexing stages. It says server-side rendering or prerendering remains a good idea for users and crawlers and notes that not all bots execute JavaScript.[^5]

Analytical implication: a requirement for reliable initial HTML should increase the value of SSR/SSG, not automatically select Next.js. The selection then turns on route model, framework maturity, hosting, caching, server-data composition, and team constraints.

### Does Next.js require Vercel?

No. React's official framework guide states that Next.js can deploy to providers supporting Node.js or Docker, to a self-hosted server, or as a static export.[^1] Next.js documents self-hosting, including reverse-proxy guidance, image optimization, runtime environment variables, caching, multi-server deployments, and version-skew considerations.[^6] Its static export documentation says generated HTML/CSS/JS can be served by any static web server.[^7]

Analytical implication: “Vercel lock-in” is too broad as a factual claim. A narrower risk is valid: provider-managed behavior can reduce operational work, while self-hosted or adapter-based deployments require the team to own reverse proxying, cache coordination, version skew, image optimization, and validation of feature parity. That is an operational coupling question, not a binary deployment restriction.

### Is the complexity concern still current?

Yes, but it should be stated precisely. The current Next.js caching guide documents an opt-in Cache Components model using `use cache`, `cacheLife`, Suspense boundaries, runtime APIs, static shells, and several storage behaviors. The same documentation routes applications not using Cache Components to a separate “previous model” guide.[^12] These are valuable capabilities, but their correctness depends on deliberate cache keys, lifetimes, invalidation, request-time boundaries, and multi-instance coordination.

Next.js also has an explicit LTS policy. As of this review, 16.x is Active LTS and 15.x is Maintenance LTS; the policy notes that Maintenance LTS updates may land as semver-minor releases even when breaking.[^13]

Analytical implication: complexity is not proof that Next.js is a bad choice. It is a cost that should be accepted only when its rendering and caching features remove a larger application or platform problem. Existing teams should keep supported versions current and budget for framework-specific upgrade testing.

### Is Next.js a full backend replacement?

Not according to Next.js documentation. It supports the Backend for Frontend pattern through Route Handlers and related features, but the official guide explicitly says those capabilities are not a full backend replacement.[^8]

Analytical implication: choosing Next.js because “we need a backend” is underspecified. A UI-specific BFF can fit well. Long-running jobs, complex domain workflows, independently scaled APIs, or backend ownership outside the frontend team can favor a separate service regardless of the rendering framework.

### When is RSC material?

React documents that Server Components can run at build time or request time, access server-side data without shipping their implementation dependencies to the browser, and pass results into interactive Client Components.[^9] React's framework guidance says Next.js App Router is currently the most complete implementation of the official RSC architecture.[^1]

React also distinguishes stable Server Components from the underlying bundler/framework integration APIs, which do not follow semver and may break between React 19 minor versions.[^9]

Analytical implication: RSC can be decisive when server-only rendering logic and dependency removal materially affect the application. It should not be inferred from the mere presence of async data fetching. Route loaders, SSR, SSG, and a separate API can solve related but different problems with different boundaries.

### How do the leading alternatives differ?

| Candidate | Officially documented rendering model | Strongest fit | Material caution |
|---|---|---|---|
| Next.js App Router | CSR/SPA, static export, SSR, RSC, hybrid caching/rendering | React products benefiting from mature RSC integration and integrated full-stack conventions | Next-specific server/client and cache semantics; self-hosted operations need deliberate design |
| React Router Framework Mode | CSR, SSR, static prerendering | React apps wanting loaders/actions and Web API-oriented framework behavior without requiring RSC | RSC APIs are marked unstable in current docs; global SSR configuration is less granular than TanStack Start |
| TanStack Start | SSR by default, per-route `true`/`false`/`data-only`, SPA, static prerendering | Type-safe routed applications that benefit from selective SSR and the TanStack ecosystem | React officially labels it beta and its docs snapshot is pre-1.0; recheck before production selection |
| Astro | Static by default, per-route on-demand rendering, server mode | Content-heavy sites with localized islands of interactivity | Application-wide client state and continuously interactive screens may be less natural |
| Vite SPA | Client-rendered static assets; low-level SSR APIs exist | Authenticated/internal UIs consuming a separate API | Vite is not an application framework; the team owns routing/data/auth/error conventions and any SSR architecture |

Vite's SSR guide describes its SSR API as low-level and demonstrates that the application owns server integration and HTML injection.[^10] Hono is a separate backend/BFF option built on Web Standards and documents support across multiple JavaScript runtimes.[^11] Neither fact proves lower cost for a specific project; that needs a deployment and maintenance estimate.

## Corrections to common shortcuts

| Shortcut | Evidence-based correction |
|---|---|
| “All authenticated apps should be SPAs.” | Authentication reduces SEO value for protected routes, but public routes, link previews, initial performance, server-only personalization, and security boundaries can still justify server rendering. |
| “SEO means Next.js.” | SEO favors reliable HTML and response semantics. React Router, TanStack Start, Astro, and other frameworks can provide SSR or prerendering. |
| “Using Next.js means Vercel lock-in.” | Next.js supports Node.js, Docker, self-hosting, and static export. The real question is operational parity and ownership for the exact features used. |
| “RSC is just SSR.” | RSC changes the component/module execution boundary and client bundle contents; SSR produces HTML for a request. They can be used together but solve different problems. |
| “Vite is a simpler framework.” | Vite is a build tool. It can yield a simpler system when the missing framework responsibilities are unnecessary or deliberately supplied elsewhere. |
| “A higher score proves the winner.” | The score is a traceable prompt for review. Hard constraints, migration cost, measurements, and organizational fit remain primary evidence. |

## Validation plan before a consequential selection

Build one representative route in the top two candidates. Use the same data source, authentication boundary, UI, hosting class, and cache policy. Compare observed build time, cold and warm response behavior, client JavaScript, failure handling, logs/traces, deployment steps, rollback, and developer changes required. Do not generalize public benchmark results to the project.

For an existing application, include one route with the median level of Next-specific coupling and one worst-case route. A migration recommendation is credible only if the spike exposes a repeatable conversion pattern and the measured operational or delivery improvement exceeds rewrite and retraining costs.

## Limitations

- This is a React-centered comparison, with Astro included for content-first cases. It does not rank Nuxt, SvelteKit, Angular, Qwik, RedwoodSDK, or platform-specific meta-frameworks.
- Official documentation establishes supported capabilities, not comparative productivity, reliability, performance, or total cost.
- Maturity labels and deployment adapters can change faster than this repository. The review date is evidence metadata, not a guarantee of freshness.
- The motivating article is a useful practitioner argument but is not a primary specification source and is not used to establish framework capabilities.

## Sources

[^1]: React. [“Creating a React App.”](https://react.dev/learn/creating-a-react-app) Accessed 2026-09-13.
[^2]: React Router. [“Rendering Strategies.”](https://reactrouter.com/start/framework/rendering) Accessed 2026-09-13.
[^3]: Astro. [“On-demand rendering.”](https://docs.astro.build/en/guides/on-demand-rendering/) Accessed 2026-09-13.
[^4]: TanStack. [“Selective Server-Side Rendering (SSR).”](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr) Accessed 2026-09-13.
[^5]: Google Search Central. [“Understand JavaScript SEO Basics.”](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) Accessed 2026-09-13.
[^6]: Next.js. [“How to self-host your Next.js application.”](https://nextjs.org/docs/app/guides/self-hosting) Updated 2026-08-25; accessed 2026-09-13.
[^7]: Next.js. [“How to create a static export of your Next.js application.”](https://nextjs.org/docs/app/guides/static-exports) Updated 2026-08-25; accessed 2026-09-13.
[^8]: Next.js. [“How to use Next.js as a backend for your frontend.”](https://nextjs.org/docs/app/guides/backend-for-frontend) Updated 2026-06-25; accessed 2026-09-13.
[^9]: React. [“Server Components.”](https://react.dev/reference/rsc/server-components) Accessed 2026-09-13.
[^10]: Vite. [“Server-Side Rendering (SSR).”](https://vite.dev/guide/ssr) Accessed 2026-09-13.
[^11]: Hono. [“Hono documentation.”](https://hono.dev/docs/) Accessed 2026-09-13.
[^12]: Next.js. [“Caching.”](https://nextjs.org/docs/app/getting-started/caching) Updated 2026-08-25; accessed 2026-09-13.
[^13]: Next.js. [“Support Policy.”](https://nextjs.org/support-policy) Accessed 2026-09-13.

### Practitioner source

Ashunar0. [“そのプロジェクト、本当にNext.js必要？”](https://ashunar0.dev/posts/does-your-project-need-nextjs/) 2026-09-13. Used to frame hypotheses about default selection, complexity, and alternatives; not used as sole support for capability claims.
