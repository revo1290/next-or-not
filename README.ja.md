# next-or-not

[![CI](https://github.com/revo1290/next-or-not/actions/workflows/ci.yml/badge.svg)](https://github.com/revo1290/next-or-not/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

[English](README.md) · **日本語**

`next-or-not` は**既存のNext.jsリポジトリ**を監査し、フレームワークの人気比較よりも狭く安全な問いに答えます。

> このアプリケーションはNext.jsを継続すべきか、Next.js固有の面を整理すべきか、先に更新すべきか、それとも計測に基づく移行調査の候補か？

読み取り専用のAST解析ツールと、インストール可能なagent skillで構成されています。プロジェクトのコードやpackage scriptを実行せず、ソースを外部送信せず、書き換えを承認することもありません。

レポートは**英語と日本語**に対応しています（`--lang en` / `--lang ja`）。詳しくは [レポートの言語](#レポートの言語) を参照してください。

## クイックスタート

```bash
git clone https://github.com/revo1290/next-or-not.git
cd next-or-not
npm install
node scripts/assess.mjs /path/to/existing-next-app --lang ja
```

cloneせずに使う場合:

```bash
npx next-or-not /path/to/existing-next-app --lang ja
```

> npmでの公開は **v0.7.1** からです。そのタグが公開されるまでは
> `npx github:revo1290/next-or-not` を使ってください。既定ブランチから同じものがビルドされます。

<details>
<summary>出力例</summary>

```text
推奨: keep（継続）
確信度: high（高）
router: app

判断の4観点:
  継続価値:      medium（中）
  移行結合度:    medium（中）
  保守リスク:    low（低）
  可搬性の余地:  low（低）

観測された事実:
  - 2 件のroute関連ファイルから app routerの利用を検出しました。
  - .: 16.3.5（lockfile: package-lock.json）— 16.x は証拠スナップショット上 Active LTS です。
  - Route Handler: 1 件（app/api/items/route.ts）
  - リクエスト依存API: 1 件（app/page.tsx）

次に確認すること:
  - 検出されたどのserver機能がNext.jsを正当化するかを文書化し、そのcache・runtime挙動に回帰テストを追加してください。
  - 書き換えを承認する前に、hosting制約・運用上の痛み・移行予算についてプロジェクト固有の証拠を追加してください。

これは移行トリアージであり、書き換えの承認ではありません。ファイル単位の根拠は --json で確認してください。
```

</details>

機械可読な根拠が必要な場合:

```bash
npx next-or-not /path/to/existing-next-app --json --lang ja
```

### 必要環境

Node.js 20以降。スキャンはファイルを読むだけで、依存のインストール、package scriptの実行、ソースの外部送信は一切行いません。

## レポートの言語

| 指定方法 | 例 | 優先度 |
|---|---|---|
| `--lang` | `--lang ja` | 1（最優先） |
| `NEXT_OR_NOT_LANG` | `NEXT_OR_NOT_LANG=ja` | 2 |
| `LC_ALL`、`LC_MESSAGES`、`LANG` | `LANG=ja_JP.UTF-8` | 3 |
| 既定値 | — | `en` |

指定できる値は `en` と `ja` です。**環境変数**が未対応の値だった場合は黙って英語にフォールバックしますが、`--lang` に未対応の値を渡した場合はエラーになります。打ち間違いで気付かないうちにレポートの言語が変わることはありません。

言語が変わるのは文章だけです。推奨状態、観点のレベル、router名、フィールド名、contextの値は、ロケールに依存しない識別子で、言語によって変化しません。`--json` では、各メッセージが安定した `id` と翻訳済みの `text` の両方を持ちます。

```json
{
  "id": "finding.router",
  "params": { "router": "app", "count": 2 },
  "text": "2 件のroute関連ファイルから app routerの利用を検出しました。"
}
```

そのため、読み手のロケールに関係なくJSON出力をCIで検証できます。言語を追加する場合は `scripts/i18n/en.mjs` をコピーして値を翻訳し、`scripts/i18n/index.mjs` に登録してください。いずれかのカタログにキーが欠けているとテストが失敗します。

## 人的証拠の補足（7つの質問）

コードからは分からない7つの事実は、リポジトリの証拠を置き換えることなく、推奨アクションを変えることがあります。

```bash
npx next-or-not /path/to/existing-next-app --context context.json --lang ja
npx next-or-not /path/to/existing-next-app --interactive --lang ja
```

`--interactive` はTTYがあるときだけ質問し、`--context` で既に与えられた項目は飛ばします。contextファイルは、フィールドを直接書いても `answers` の下に書いても構いません。

```json
{
  "answers": {
    "reviewDriver": "delivery-speed",
    "evidenceStrength": "continuous-measurement",
    "productionRouteProfile": "mixed",
    "deploymentConstraint": "node-container",
    "serverCapabilityCriticality": "important-but-replaceable",
    "roadmapDirection": "status-quo",
    "changeCapacity": "small-spike-only"
  },
  "note": "補足事項は、この自由記述のnoteに書いてください。"
}
```

### 指定できる値

| フィールド | 値 | 意味 |
|---|---|---|
| `reviewDriver` | `no-clear-problem` / `delivery-speed` / `reliability-incidents` / `hosting-compliance` / `infrastructure-cost` / `unknown` | 見直しの主目的 |
| `evidenceStrength` | `none` / `anecdotal` / `continuous-measurement` / `repeated-incidents` / `unknown` | その問題を裏付ける証拠 |
| `productionRouteProfile` | `mostly-static-public` / `mostly-authenticated-client` / `mostly-request-time-dynamic` / `mixed` / `unknown` | 本番routeの実際の性質 |
| `deploymentConstraint` | `static-only` / `node-container` / `edge-runtime` / `vercel-managed` / `flexible` / `unknown` | deployment上の必須制約 |
| `serverCapabilityCriticality` | `unused` / `easily-replaceable` / `important-but-replaceable` / `essential` / `unknown` | 検出されたserver機能の置換可能性 |
| `roadmapDirection` | `simplify-to-static-client` / `status-quo` / `more-server-integration` / `undecided` / `unknown` | 12–18か月のroadmapの向き |
| `changeCapacity` | `no-budget` / `small-spike-only` / `incremental-migration` / `full-migration` / `unknown` | 変更に投入できる能力 |

すべてのフィールドが `unknown` を受け付けます。対話モードで空欄のままEnterを押した場合も `unknown` になります。不正な値も `unknown` に変換され、推奨には影響せず、構造化された入力エラーとして報告されます。

同梱されているどの言語の表示ラベルも別名として受け付けます。そのため、v0.7より前に書かれた `開発速度` のような日本語の値を持つcontextファイルも、そのまま動きます。JSON出力では `rawAnswers` に正規化後のキーが入り、`suppliedAnswers` には入力したままの値が保持されます。

7つのフィールドは固定です。見直しの動機、証拠の強さ、本番routeの性質、deployment制約、server機能の重要度、12–18か月のroadmap、変更能力。それ以外の情報は8つ目の採点項目ではなく `note` に書いてください。

生の回答、そこから導かれる含意、コードとcontextの矛盾、入力エラー、統合前後の推奨は、JSON上でそれぞれ別の項目として出力されます。回答がコードの証拠を消すことはなく、回答だけで `migration-candidate` を生み出すこともできません。証拠の弱い痛みは計測タスクのまま残り、static-onlyのdeploymentがrequest-timeのコードと矛盾する場合は設定調査になり、移行能力がない場合はアクションが可逆的な整理に限定されます。

## 監査が測るもの

初期バージョンは、ユーザーの回答と加点方式でフレームワークを順位付けしていました。説明はできましたが、主観的な入力と恣意的な重み付けに影響されすぎました。現在は、独立した4つの観点を監査します。

| 観点 | 問い |
|---|---|
| 継続価値 | 検出されたNext.jsのserver/runtime機能のうち、明示的な置き換えが必要になるものは何か |
| 移行結合度 | routing、import、server挙動、設定がどれだけ広くNext.jsに依存しているか |
| 保守リスク | 現行のサポート方針スナップショットから遅れていないか、アップグレードの残骸を抱えていないか |
| 可搬性の余地 | server結合が小さく、static/client寄りであるという具体的な証拠があるか |

結果は確率に見えるスコアではなく、`low` / `medium` / `high` の帯で示されます。確信度は**スキャンの網羅性**を表すものであり、推奨がビジネス上正しいことの確からしさではありません。

## 自動で検出される証拠

- monorepo内のNext.js workspace
- npm、pnpm、Yarn、Bunプロジェクトにおける宣言バージョンと、インストール済み/lockfile上の正確なバージョン
- App Router、Pages Router、および両者が混在するアプリケーション
- page、layout、Route Handler、Pages API route
- `use client`、`use server`、`use cache` の境界
- `next/headers`、`next/cache`、`next/server`、`next/navigation`、`next/image`、`next/font`、`next/link`、`next/script` から実際に使われているbindingと再export（別名、複数行宣言、動的import、CommonJSの `require` を含む）
- `getServerSideProps`、`getStaticProps`、`getStaticPaths`、`getInitialProps`
- proxy、非推奨のmiddleware、instrumentation、カスタムserver、routeのruntime/revalidation設定
- static export、standalone出力、Cache Components、image loaderの選択、rewrites、redirects、headers、カスタムwebpack、削除済みのexperimental PPR設定
- `middleware` や `next lint` といったNext 16アップグレードの残骸
- Next.jsが公式に文書化しているstatic exportの矛盾

static exportの解析には、Requestに依存するRoute Handlerや、`generateStaticParams` の実装が検出されない動的App Router routeも含まれます。これらは保守的なソース上の検査であり、実際のビルドのほうが強い証拠になります。

JavaScript、TypeScript、JSX、TSXはBabelで解析します。コメント、通常の文字列、型のみのimport、未使用のimport、無関係な同名関数は、runtimeの証拠として扱いません。Route HandlerのRequestパラメータは、そのbindingが参照されている場合のみ計上します。各シグナルは件数の集計を保持し、JSON出力にはファイル・行・`detectionMethod` を含む限定的な根拠が入ります。解析失敗は明示され、限定的なフォールバックのみを使い、確信度を下げます。生成物、依存、巨大ファイルは除外され、確信度の制約として報告されます。パーサの選定理由は [`references/adr-001-javascript-parser.md`](references/adr-001-javascript-parser.md) に記録されています。

バージョン解決は読み取り専用で、workspace単位です。優先順位は、workspaceのインストール済みパッケージ、rootにhoistされたインストール済みパッケージ、workspaceに一致するlockエントリ、rootのlockエントリ、`package.json` の厳密な宣言、そして明示的な未解決状態の順です。JSON出力には、採用した供給元、lockfileとそのスキーマバージョン、代替候補、警告、解析失敗が記録されます。対応する入力は `package-lock.json` v1–v3、`npm-shrinkwrap.json`、現行および主要な旧 `pnpm-lock.yaml` 構造、Yarn ClassicとBerryの `yarn.lock`、Bunのテキスト形式 `bun.lock` です。インストール済みパッケージとlockfileは、どちらかを黙って採用するのではなく比較されます。

## 推奨状態の意味

| 推奨 | 意味 |
|---|---|
| `keep` | 検出されたserver/runtimeの価値が実質的であるか、Next.jsの継続が最も投機的でない選択である。 |
| `keep-and-simplify` | 書き換えの根拠は立っていないが、新規コードでは不要なNext.js固有の面を避けるべきである。 |
| `modernize-first` | パッチ・サポート・非推奨、あるいは設定の矛盾が、移行の比較を汚染してしまう。 |
| `migration-candidate` | static/client寄りの証拠と低い結合度が、可逆的な比較spikeを正当化する（移行そのものではない）。 |
| `insufficient-evidence` | リポジトリの網羅性が低すぎて、責任ある推奨ができない。 |
| `not-applicable` | `next` への依存が見つからなかった。 |

導出の詳細と既知の盲点は [`references/decision-model.md`](references/decision-model.md) にあります。

## Agent skill

このリポジトリをskillとしてインストールまたはリンクし、`$next-or-not` を呼び出してください。skillは監査を実行し、重要な検出をソース上で確認し、コードから導けないビジネス上の事実だけを質問し、ロールバック可能な検証計画とともに継続判断を提示します。

## 調査の基準

同梱の調査レポートは、機能とサポート状況についてNext.jsとReactの公式ドキュメントを典拠としています。ソースから検出できる事実、推論、検出できないビジネス上の証拠を区別しています。[`references/framework-evidence.md`](references/framework-evidence.md) を参照してください（レビュー日: **2026-09-14**）。

このプロジェクトのきっかけは [そのプロジェクト、本当にNext.js必要？](https://ashunar0.dev/posts/does-your-project-need-nextjs/) という記事です。その主張は採点ルールではなく仮説として扱っています。

## 実プロジェクトによるキャリブレーション

`dataset/real-world.json` は、公開されている30のNext.jsリポジトリを完全なcommit SHAで固定しています。App Router、Pages Router、混在、コンテンツ中心のアプリケーション、server route、単一パッケージとmonorepo、npm・pnpm・Yarn・Bun、サポート対象/対象外/pre-releaseのバージョンを網羅しています。各レコードには、ライセンスの出所、workspace、期待されるバージョン/router/機能、独立に付与された4つの専門家ラベル、許容される推奨の集合、根拠、レビュー状況、既知の曖昧さが含まれます。

ラベルはこのツールを実行する前に記録されました。評価器は不一致をそのまま保持し、シグナルのprecision/recall、パーサとlockfileの失敗、router・観点・推奨の一致率、危険な誤りの発生率、確信度のキャリブレーション、そしてrouter・パッケージマネージャ・プロジェクト規模・サポート区分ごとのスライスを報告します。固定されたGitオブジェクトを取得してソースを読むだけで、依存のインストールやリポジトリのコード実行は行いません。

```bash
npm run dataset:validate              # オフラインでのmanifestと網羅性チェック
npm run dataset:smoke                 # CI用の7リポジトリのサブセット
npm run dataset:full                  # 全30件。JSONとベースラインレポートを出力
```

pull requestでは固定のsmokeセットを実行します。完全なセットは、スケジュール実行または手動ディスパッチのworkflowで実行します。初期結果とラベル不一致の扱いは [`references/calibration-baseline.md`](references/calibration-baseline.md) に記録されています。

## 限界

静的解析では、本番のレイテンシ、トラフィックの形、キャッシュヒット率、インフラ費用、障害、チームの生産性、roadmap、移行予算を明らかにできません。ビルドとruntimeを観測しない限りデプロイ後の描画挙動も証明できず、ラッパーモジュールをまたぐプログラム全体のデータフロー解析も行いません。したがってこのツールが `migrate` を出力することはありません。

旧来のバイナリ形式 `bun.lockb` は識別しますが、内容を推測しません。安全なインストール済みパッケージのフォールバックがない場合、バージョンは `unsupported-binary-lockfile` という出所とともに未解決のまま残ります。壊れた、大きすぎる、あるいは未対応のlockfileも、明示的な確信度の制約として残ります。スキャン対象リポジトリの外を指すインストール済みパッケージのsymlinkは辿りません。

## コントリビュート

英語でも日本語でも歓迎します。[CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)（[English](CONTRIBUTING.md)）と [行動規範](CODE_OF_CONDUCT.md) を参照してください。セキュリティ上の問題を報告する場合は、先に [SECURITY.md](SECURITY.md) を読んでください。

pull requestを出す前に、一通りのチェックを実行してください。

```bash
npm run check
```

検出や判断を変更する場合は、現実的な回帰テスト用のfixture、根拠の記録、そして根拠となるフレームワークの事実が時間依存である場合は証拠の日付の更新を含めてください。

変更は、危険な誤りのゲートをゼロに保つ必要があります。危険な誤りとは、継続価値が高いケースに `migration-candidate` を出すこと、サポート対象外やpre-releaseの保守リスクを過小評価すること、スキャンの確信度が低いまま実行可能な推奨を出すことです。

## ライセンス

MIT — [LICENSE](LICENSE) を参照してください。
