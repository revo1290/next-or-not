# Real-world calibration baseline

Generated from 30/30 pinned repositories. No repository source is redistributed.

| Metric | Result |
| --- | ---: |
| Signal precision | 1 (58 TP / 0 FP) |
| Signal recall | 0.9831 (58 TP / 1 FN) |
| Router accuracy | 1 |
| Four-dimension label accuracy | 0.8417 |
| Recommendation within allowed set | 0.8667 |
| Parser failure rate | 0.0019 |
| Lockfile failure rate | 0.0333 |
| Dangerous error rate | 0 |

Dangerous-error gate: **PASS** (0).

Disagreements: 24. Clone/scan failures: 0.

## Confidence calibration

| Confidence | Cases | Recommendation agreement |
| --- | ---: | ---: |
| high | 15 | 0.8667 |
| medium | 14 | 0.9286 |
| low | 1 | 0 |

## Slice summary

| Slice | Cases | Recommendation agreement | Dangerous errors |
| --- | ---: | ---: | ---: |
| router: app | 22 | 0.8636 | 0 |
| router: pages | 5 | 0.8 | 0 |
| router: mixed | 3 | 1 | 0 |
| packageManager: npm | 4 | 0.75 | 0 |
| packageManager: pnpm | 17 | 0.8235 | 0 |
| packageManager: yarn | 6 | 1 | 0 |
| packageManager: bun | 3 | 1 | 0 |
| projectSize: small | 9 | 1 | 0 |
| projectSize: medium | 8 | 0.75 | 0 |
| projectSize: large | 13 | 0.8462 | 0 |
| supportClass: supported | 25 | 0.84 | 0 |
| supportClass: unsupported | 3 | 1 | 0 |
| supportClass: pre-release | 2 | 1 | 0 |

## Disagreement log

- `calcom-web` dimension `maintenanceRisk`: expected `"medium"`, actual `"high"`.
- `documenso-docs` dimension `migrationCoupling`: expected `"medium"`, actual `"high"`.
- `formbricks-web` recommendation `recommendation`: expected `["keep"]`, actual `"insufficient-evidence"`.
- `supabase-www` dimension `maintenanceRisk`: expected `"medium"`, actual `"high"`.
- `shadcn-v4` dimension `keepValue`: expected `"medium"`, actual `"high"`.
- `openstatus-web` dimension `maintenanceRisk`: expected `"low"`, actual `"medium"`.
- `dokploy-app` dimension `maintenanceRisk`: expected `"medium"`, actual `"low"`.
- `ixartz-boilerplate` dimension `keepValue`: expected `"medium"`, actual `"high"`.
- `ixartz-boilerplate` dimension `migrationCoupling`: expected `"medium"`, actual `"high"`.
- `precedent` dimension `portabilityOpportunity`: expected `"low"`, actual `"high"`.
- `babylon-documentation` signal `config.staticExport`: expected `true`, actual `false`.
- `babylon-documentation` dimension `keepValue`: expected `"low"`, actual `"medium"`.
- `babylon-documentation` dimension `migrationCoupling`: expected `"medium"`, actual `"high"`.
- `babylon-documentation` dimension `portabilityOpportunity`: expected `"high"`, actual `"low"`.
- `babylon-documentation` recommendation `recommendation`: expected `["migration-candidate","keep-and-simplify"]`, actual `"keep"`.
- `react-email-web` dimension `keepValue`: expected `"high"`, actual `"medium"`.
- `saleor-storefront` dimension `maintenanceRisk`: expected `"low"`, actual `"high"`.
- `saleor-storefront` recommendation `recommendation`: expected `["keep"]`, actual `"modernize-first"`.
- `builder-shopify` dimension `portabilityOpportunity`: expected `"medium"`, actual `"low"`.
- `umami` dimension `keepValue`: expected `"high"`, actual `"medium"`.
- `nextchat` dimension `keepValue`: expected `"high"`, actual `"medium"`.
- `typebot-builder` dimension `maintenanceRisk`: expected `"medium"`, actual `"high"`.
- `open-next-aws-app-router` dimension `maintenanceRisk`: expected `"low"`, actual `"high"`.
- `open-next-aws-app-router` recommendation `recommendation`: expected `["keep"]`, actual `"modernize-first"`.

The manifest labels were frozen before running the tool. Disagreements are retained here and in `dataset/results-full.json` for adjudication; they were not silently relabeled.
