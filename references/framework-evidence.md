# Evidence report: deciding whether an existing Next.js application should remain

## Executive assessment

For an existing application, “Would this greenfield project choose Next.js today?” is the wrong migration question. The responsible comparison is whether a verified capability, reliability, cost, or delivery improvement exceeds the cost and risk of replacing the behavior already implemented.

Current official documentation supports two conclusions that can coexist. First, Next.js is not uniquely required for React, static HTML, SSR, or SPA delivery; React itself lists both Next.js and React Router among recommended frameworks.[^1] Second, an existing Next.js application may contain substantial framework-owned behavior—routing, React Server Components, Server Actions, request APIs, caching, Route Handlers, image optimization, proxying, and self-hosted cache coordination—that a migration must explicitly reproduce.[^2][^3][^4]

The evidence therefore supports a conservative continuation audit:

1. detect actual Next.js runtime value;
2. measure framework-specific conversion surface separately;
3. remove upgrade and configuration debt before blaming the architecture;
4. permit migration discovery only when the repository is demonstrably static/client-leaning or a measured production problem justifies it;
5. never infer rewrite value from source code alone.

This report was reviewed on **2026-09-14**. Support, security, and deprecation claims are time-sensitive.

## What source inspection can establish

### Router and server surface are concrete migration inputs

Next.js defines file-system conventions for pages, layouts, Route Handlers, proxy, instrumentation, metadata, error/loading boundaries, parallel routes, and intercepting routes.[^2] These files are observable and provide a repeatable inventory. Their presence establishes conversion work, but not necessarily business value.

Route Handlers are custom request handlers in the App Router.[^5] Pages API routes provide server-side API endpoints in the Pages Router.[^6] `getServerSideProps` renders a page using request-time data, including personalized information such as authorization or geolocation.[^7] `getStaticProps` instead executes at build time and may include server-only data access not shipped to the browser.[^8]

Analytical implication: Route Handlers, API routes, request-time data functions, and server-only imports increase keep value because replacement architecture needs an explicit server boundary. Static data functions mainly increase conversion scope; they may remain portable to another prerendering system.

### RSC and client directives require cautious interpretation

React documents that Server Components can run at build or request time, access server-side data, and avoid shipping their own implementation dependencies to the browser.[^9] React's framework guidance describes Next.js App Router as the most complete implementation of the official RSC architecture.[^1]

However, App Router files are Server Components by default, so source scanning cannot infer RSC value merely from the absence of `use client`. Conversely, a high concentration of `use client` boundaries can support a client-leaning hypothesis but cannot prove that removing Next.js improves bundle size, latency, or productivity.

Analytical implication: App Router alone produces medium—not high—keep value. High keep value requires stronger runtime evidence such as Server Actions, request APIs, cache semantics, or integrated handlers.

### Cache usage is valuable and costly to replace

The current caching guide covers Cache Components enabled by `cacheComponents: true`, with `use cache`, cache lifetimes, tags, revalidation, Suspense boundaries, and runtime APIs.[^3] The self-hosting guide separately documents automatic caching, multi-server coordination, shared cache behavior, Server Function encryption keys, deployment identifiers, version skew, and streaming.[^4]

Analytical implication: imports from `next/cache`, cache directives, route revalidation settings, and custom cache configuration are meaningful keep-value signals. They also raise operational questions. A migration comparison must reproduce invalidation, keying, consistency, multi-instance behavior, and observability—not merely page rendering.

## Modernization must precede architecture comparison

### Support policy is a dated fact, not a permanent rule

Next.js's LTS policy states that the current major receives Active LTS and the previous major receives Maintenance LTS for two years. On the review date, 16.x is Active LTS and 15.x is Maintenance LTS; 14.x and earlier appear in the unsupported table.[^10]

Maintenance LTS receives critical fixes and essential security updates. The policy also states that Maintenance LTS updates may arrive as semver-minor releases even when breaking. A declared dependency range does not establish which patch is installed, so a scanner needs a lockfile or package-manager resolution before making patch claims.

The same policy says canary builds are pre-release outputs and are not recommended for serving production traffic.[^10] An exactly resolved prerelease therefore raises maintenance risk rather than being treated as “newer than Active LTS.”

### The August 2026 security release creates a useful patch floor

The official August 2026 security release asks applications to update to 16.3.3 or 15.5.24 and describes two critical issues, including an image-optimization issue and a conditional issue involving mixed App/Pages Router applications on Windows.[^11]

Analytical implication: an exactly resolved version below those releases deserves `modernize-first`. It should not automatically be labeled vulnerable because feature and platform applicability differ. The correct output is “below the documented patched release; verify the advisory and update.”

### Next 16 leaves machine-detectable migration residue

The Next 16 upgrade guide documents automated migrations for Turbopack configuration, replacing `next lint` with the ESLint CLI, renaming middleware to proxy, and removing older experimental PPR configuration.[^12] It also notes that the general upgrade command does not run every codemod and calls out asynchronous request API migration separately.

The proxy documentation says `middleware` was deprecated and renamed in v16. It further recommends avoiding dependence on this boundary when better APIs exist.[^13]

Analytical implication: `middleware` in a Next 16 repository, `next lint` scripts, or removed PPR configuration are not evidence that another framework is superior. They are modernization debt. Resolve them before benchmarking architecture or estimating migration benefit.

## Static export is strong but conditional portability evidence

Next.js can emit static HTML/CSS/JavaScript that can be hosted by any static web server.[^14] The same official guide lists unsupported runtime-dependent features, including dynamic routes without complete static params, Request-dependent Route Handlers, cookies, rewrites, redirects, headers, proxy, ISR, default image optimization, Draft Mode, Server Actions, and intercepting routes.[^14]

Self-hosting documentation reinforces two important boundaries: runtime image optimization can work with `next start`, while static export requires a custom image loader; proxy is not supported by static export because it requires the incoming request.[^4]

Analytical implication: a clean `output: 'export'` application with no detected incompatible feature is a strong portability signal. A contradictory configuration is a correctness/modernization problem, not an immediate migration argument. The audit should recommend building in CI and resolving each contradiction.

Static analysis still cannot prove full exportability. Aliased wrappers, generated routes, dynamic route coverage, imported but unused APIs, and configuration composition can defeat regex-level inspection. A successful production-equivalent build is stronger evidence.

## Mixed routers are a complexity and upgrade signal

Next.js supports both App Router and Pages Router, and official documentation continues to document Pages data fetching and API routes.[^6][^7][^8] Coexistence can be a valid incremental migration strategy. It also means two rendering/data models and can widen upgrade testing.

The August 2026 security release demonstrates why topology matters: one issue specifically describes applications using both routers without Cache Components on Windows-hosted servers.[^11] That does not make every mixed-router application unsafe, but it shows that the condition is operationally material.

Analytical implication: mixed routers should raise maintenance attention and trigger a route-owner inventory. They should not alone trigger a framework migration.

## Next.js is not synonymous with Vercel

Official self-hosting guidance covers reverse proxies, image optimization, runtime environment variables, caching, multi-server deployments, version skew, streaming, and CDN use.[^4] Next.js can also produce a standalone output or a static export. Thus, “using Next.js means mandatory Vercel lock-in” is factually too broad.

The narrower concern is operational ownership. A provider may manage behavior that a self-hosted team must configure and validate. The scanner can detect `output: 'standalone'`, custom cache settings, adapters, or static export, but it cannot determine whether the operating burden is acceptable.

## A Next.js server is a BFF, not automatically the domain backend

Next.js officially supports the Backend for Frontend pattern through public endpoints and server-side features, while explicitly stating that these capabilities are not a full backend replacement.[^15]

Analytical implication: Route Handlers or Pages API routes prove an integrated server surface, but not that all domain logic belongs there. A continuation review should identify whether these endpoints are UI-specific adapters or a growing domain backend. The latter may justify service extraction without requiring the UI to leave Next.js.

## What repository analysis cannot determine

No static scanner can establish:

- user-visible latency or Core Web Vitals in production;
- cache hit ratio, invalidation correctness, or multi-region consistency;
- hosting and engineering cost;
- incident frequency and operational burden;
- team familiarity, delivery throughput, or hiring constraints;
- roadmap probability;
- the cost of rewriting authentication, routing, observability, deployment, and failure handling;
- whether an alternative improves those measures.

These are not optional details for a migration decision. Repository analysis can identify a low-risk candidate for further study, but authorization should depend on measured outcomes.

## Recommended validation protocol

For `migration-candidate`, select one vertical slice representative of the median application route. Preserve its data source, authentication boundary, UI behavior, response codes/headers, hosting class, and observability. Implement it outside Next.js without modifying the production route.

Measure:

- build time and deploy steps;
- server and client output;
- cold/warm response behavior where a server exists;
- cache and invalidation behavior;
- failure handling and logs/traces;
- developer changes required;
- rollback time.

Then repeat the estimate for the most coupled route. Migration is justified only if the measured operational or delivery advantage exceeds conversion, retraining, dual-running, and opportunity costs.

## Sources

[^1]: React. [“Creating a React App.”](https://react.dev/learn/creating-a-react-app) Accessed 2026-09-14.
[^2]: Next.js. [“File-system conventions.”](https://nextjs.org/docs/app/api-reference/file-conventions) Last updated 2025-06-16; accessed 2026-09-14.
[^3]: Next.js. [“Caching.”](https://nextjs.org/docs/app/getting-started/caching) Last updated 2026-08-25; accessed 2026-09-14.
[^4]: Next.js. [“How to self-host your Next.js application.”](https://nextjs.org/docs/app/guides/self-hosting) Last updated 2026-08-25; accessed 2026-09-14.
[^5]: Next.js. [“route.js.”](https://nextjs.org/docs/app/api-reference/file-conventions/route) Accessed 2026-09-14.
[^6]: Next.js. [“API Routes.”](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) Accessed 2026-09-14.
[^7]: Next.js. [“getServerSideProps.”](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-server-side-props) Last updated 2026-03-03; accessed 2026-09-14.
[^8]: Next.js. [“getStaticProps.”](https://nextjs.org/docs/pages/building-your-application/data-fetching/get-static-props) Last updated 2026-03-03; accessed 2026-09-14.
[^9]: React. [“Server Components.”](https://react.dev/reference/rsc/server-components) Accessed 2026-09-14.
[^10]: Next.js. [“Support Policy.”](https://nextjs.org/support-policy) Accessed 2026-09-14.
[^11]: Next.js. [“August 2026 Security Release.”](https://nextjs.org/blog/august-2026-security-release) 2026-08-25.
[^12]: Next.js. [“Upgrading: Version 16.”](https://nextjs.org/docs/app/guides/upgrading/version-16) Last updated 2026-08-25; accessed 2026-09-14.
[^13]: Next.js. [“proxy.js.”](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) Accessed 2026-09-14.
[^14]: Next.js. [“Static Exports.”](https://nextjs.org/docs/app/guides/static-exports) Last updated 2026-08-25; accessed 2026-09-14.
[^15]: Next.js. [“How to use Next.js as a backend for your frontend.”](https://nextjs.org/docs/app/guides/backend-for-frontend) Last updated 2026-06-25; accessed 2026-09-14.

### Practitioner source

Ashunar0. [“そのプロジェクト、本当にNext.js必要？”](https://ashunar0.dev/posts/does-your-project-need-nextjs/) 2026-09-13. Used to frame hypotheses about default selection, complexity, and alternatives; not used as sole support for capability or support claims.
