# ADR-001: JavaScript and TypeScript parser

- Status: accepted
- Date: 2026-09-14
- Decision owners: `next-or-not` maintainers

## Context

The v0.2 scanner inferred imports, exports, directives, and function use with regular expressions. That approach cannot reliably distinguish comments and strings from executable syntax, follow an aliased import binding, or decide whether an imported value or Route Handler parameter is actually referenced.

The scanner needs JS, JSX, TS, and TSX syntax; source locations; scope-aware binding traversal; ESM, dynamic import, and CommonJS support; and no execution of project code. The repository scan is capped at 10,000 files, so parser throughput matters, but correctness, portable installation, and maintainability are the primary constraints.

## Options considered

| Option | Syntax and traversal | Distribution | Performance and operational trade-off |
|---|---|---|---|
| Babel (`@babel/parser` + `@babel/traverse`) | First-party JSX and TypeScript parser plugins; mature scope/binding traversal; source locations enabled by default | Pure JavaScript packages and transitive helpers. At the reviewed 8.0.5 release, npm registry metadata reports about 1.86 MB unpacked for the parser and 1.23 MB for traverse, before shared helpers. | Slower than native Rust parsers in their published positioning, but predictable on every Node 20+ platform and adequate under the bounded scan. `attachComment: false` is available if profiling later identifies comment attachment as material. |
| Oxc (`oxc-parser`) | JS/TS/JSX/TSX parsing and ESTree-oriented output; scope/semantic analysis would require another Oxc package or custom binding work | JavaScript wrapper plus platform-specific native packages. Registry metadata for 0.149.0 reports about 1.42 MB for the wrapper; installed native payload varies by platform. | Strong throughput focus, but native-binding availability and a less direct scope-binding integration add packaging and maintenance risk for an installable skill. |
| SWC (`@swc/core`) | JS/TS/JSX/TSX parser and transform APIs; scope-aware reference tracking would be custom for this scanner | JavaScript wrapper plus platform-specific native binary package; wrapper size alone is not representative | Strong native performance and broad production use, but the binary matrix and custom traversal/binding layer are unnecessary for the current bounded workload. |

Published package sizes are comparison hints, not installed-size guarantees. They were read from npm registry metadata on 2026-09-14. No parser benchmark is presented because a fair benchmark must include binding analysis and representative repositories, not parsing alone.

Primary documentation reviewed:

- <https://babeljs.io/docs/babel-parser>
- <https://babeljs.io/docs/babel-traverse>
- <https://oxc.rs/docs/guide/usage/parser.html>
- <https://swc.rs/docs/usage/core>

## Decision

Use `@babel/parser` and `@babel/traverse`.

Parse with `sourceType: "unambiguous"`, TypeScript and JSX support, import-expression nodes, locations, and no error recovery. A successful AST is the authoritative detector. Scope bindings determine whether an import or Request parameter is referenced; comments, strings, type-only imports, unreferenced imports, and unrelated local names are not promoted to runtime evidence.

If parsing fails, do not use a broad regex detector. Record the failure and retain only a bounded, line-anchored import/export fallback. Every fallback result carries `detectionMethod: "regex-fallback"`, and any parse failure lowers audit confidence.

## Consequences

- `next-or-not` is no longer zero-dependency.
- JSON evidence now includes file, line, and detection method while retaining the v0.2 `count`, `files`, and `examples` fields.
- Parser failures and unused/type-only Next.js imports are auditable rather than silently ignored.
- A future switch to Oxc or SWC is possible behind `analyzeSourceAst`; it requires parity fixtures for bindings, directives, exports, configuration, and failure reporting.
