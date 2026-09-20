# Security Policy

*[日本語は末尾にあります。](#日本語)*

## Supported versions

Security fixes are applied to the latest released version on the `main` branch.
Older versions are not patched.

## What this tool does and does not do

`next-or-not` is a read-only static analyzer. Understanding its boundaries helps
in judging what is, and is not, a security issue:

- It **reads** `package.json`, lockfiles, `next.config.*`, and source files
  under the directory you point it at.
- It **never** executes project code, package scripts, codemods, or `next build`.
- It **never** installs dependencies.
- It **never** sends source code, file paths, or analysis results over the
  network. The only network access in this repository is in
  `scripts/evaluate-dataset.mjs`, which fetches pinned public Git objects for
  calibration and is not part of the CLI you run against your own project.
- It does not follow installed-package symlinks that resolve outside the
  scanned repository.

Because the tool reads whatever you point it at, treat its `--json` output the
way you would treat any file listing: it contains repository-relative paths,
line numbers, and short source-derived identifiers.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately through
[GitHub Security Advisories](https://github.com/revo1290/next-or-not/security/advisories/new).

Please include:

- the version or commit you tested,
- your Node.js version and operating system,
- a minimal repository layout that reproduces the problem,
- what you expected to happen and what happened instead.

You can expect an acknowledgement within 7 days and, for a confirmed issue, an
assessment of severity and a remediation plan. Please give us a reasonable
opportunity to release a fix before public disclosure. Reports are welcome in
English or Japanese.

## Issues that are in scope

- Path traversal, symlink escape, or any read outside the directory you passed
  to the CLI.
- Any code path that executes repository content.
- Unexpected network access from the CLI.
- A denial of service triggered by a crafted lockfile, source file, or
  directory layout (beyond the documented size and file-count limits).
- Leaking file contents into output where only counts or bounded excerpts are
  documented.

## Issues that are out of scope

- Vulnerabilities in the audited project itself. This tool reports Next.js
  version support status from a bundled snapshot; that is architectural triage,
  not a vulnerability scanner. Use an advisory database for that.
- A recommendation you disagree with. Open a normal issue instead.
- Vulnerabilities in transitive development dependencies that are not reachable
  from the CLI entry points.

---

## 日本語

### 対応バージョン

セキュリティ修正は `main` ブランチ上の最新リリースに対して行います。過去バージョンへのバックポートは行いません。

### このツールがすること・しないこと

`next-or-not` は読み取り専用の静的解析ツールです。

- 指定されたディレクトリ配下の `package.json`、lockfile、`next.config.*`、ソースファイルを**読みます**。
- プロジェクトのコード、package script、codemod、`next build` を**実行しません**。
- 依存を**インストールしません**。
- ソースコード、ファイルパス、解析結果を**外部送信しません**。ネットワークアクセスがあるのはキャリブレーション用の `scripts/evaluate-dataset.mjs` のみで、自分のプロジェクトに対して実行するCLIには含まれません。
- スキャン対象リポジトリの外を指すインストール済みパッケージのsymlinkは辿りません。

`--json` 出力にはリポジトリ相対のパス、行番号、ソース由来の短い識別子が含まれます。ファイル一覧と同程度の機密性があるものとして扱ってください。

### 脆弱性の報告

**セキュリティ上の問題を公開issueに書かないでください。**

[GitHub Security Advisories](https://github.com/revo1290/next-or-not/security/advisories/new) から非公開で報告してください。次の情報があると助かります。

- 試したバージョンまたはcommit
- Node.jsのバージョンとOS
- 再現する最小のリポジトリ構成
- 期待した挙動と実際の挙動

7日以内に受領の連絡をします。確認できた問題については、深刻度の評価と修正方針をお伝えします。公表の前に修正をリリースする時間をいただけると助かります。報告は日本語でも英語でも構いません。

### 対象となるもの

- パストラバーサル、symlinkによる脱出、CLIに渡したディレクトリ外の読み取り
- リポジトリの内容を実行してしまうコードパス
- CLIからの想定外のネットワークアクセス
- 細工されたlockfile・ソース・ディレクトリ構成によるサービス妨害（文書化されたサイズ・件数の上限を超えるもの）
- 件数や限定的な抜粋のみを出力するはずの箇所での、ファイル内容の漏洩

### 対象外となるもの

- 監査対象プロジェクト自体の脆弱性。このツールは同梱スナップショットからNext.jsのサポート状況を報告しますが、これはアーキテクチャのトリアージであり脆弱性スキャナではありません。その用途にはadvisoryデータベースを使ってください。
- 推奨内容への不同意。通常のissueでお願いします。
- CLIのエントリポイントから到達しない開発用依存の脆弱性。
