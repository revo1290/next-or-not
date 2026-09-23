# next-or-not へのコントリビュート

[English](CONTRIBUTING.md) · [日本語](CONTRIBUTING.ja.md)

コントリビュートを検討いただきありがとうございます。**issueもpull requestも、日本語・英語どちらでも歓迎します。** 書きやすいほうでお願いします。メンテナは両方読みます。

## このプロジェクトの位置づけ

`next-or-not` は、**既存の** Next.jsアプリケーションについて、Next.jsを継続するか、整理するか、先に更新するか、移行調査に入るかを判断します。フレームワークのベンチマークでも、新規プロジェクトの選定ツールでもありません。

レビューのほとんどは、次の2つの原則に沿います。

1. **意見より証拠。** 検出はファイル・行・検出方法まで辿れること。推奨は検出まで辿れること。
2. **このツールは書き換えを承認しない。** `migrate` を出力することはありません。提案するのは可逆的なspikeと計測です。

## 開発を始める

```bash
git clone https://github.com/revo1290/next-or-not.git
cd next-or-not
npm install
npm run check
```

Node.js 20以降が必要です。CIはNode 20・22・24で実行するため、Node 20で使えないAPIは避けてください。

作業中は、適当なプロジェクトに対してCLIを実行しながら確認すると早いです。

```bash
node scripts/assess.mjs /path/to/some-next-app
node scripts/assess.mjs /path/to/some-next-app --json --lang ja
```

## チェックパイプライン

`npm run check` は、CIがpull requestで実行するものと同じ内容を実行します。

| コマンド | 守るもの |
|---|---|
| `npm run lint` | 全ソースへのESLint |
| `npm test` | ユニット・CLI・i18nのテスト |
| `npm run validate:skill` | `SKILL.md` のfront matter |
| `npm run validate:docs` | READMEとSKILLの記述がコードの契約と一致しているか |
| `npm run dataset:validate` | 固定されたキャリブレーションmanifest（オフライン） |

`npm run dataset:smoke` は固定された7つの公開リポジトリを取得するためネットワークが必要です。CIはpull requestで実行します。

## 検出や判断を変更する場合

検出・判断の変更には、次を含めてください。

- `test/` への現実的な回帰用fixture（1行の人工的な例ではなく）
- 根拠の記録。導出が変わる場合は `references/decision-model.md` を更新してください
- 根拠となるフレームワークの事実が時間依存の場合は、`references/framework-evidence.md` の証拠の日付を更新してください

変更は、**危険な誤りのゲートをゼロに保つ**必要があります。危険な誤りとは、

- 継続価値が高いケースに `migration-candidate` を出すこと
- サポート対象外またはpre-releaseのバージョンで保守リスクを過小評価すること
- スキャンの確信度が低いまま、実行可能な推奨を出すこと

観点のバンドが動く変更の場合は `npm run dataset:full` を実行し、ベースラインレポートの差分を含めてください。

## 翻訳まわりの作業

ユーザーに見える文章はすべて `scripts/i18n/` 配下のメッセージカタログにあります。解析側のコードは文章を組み立てず、メッセージ記述子を返します。

```js
import { msg } from './i18n/index.mjs';

maintenanceEvidence.push(msg('maintenance.mixedRouter'));
findings.push(msg('finding.router', { router: msg(`router.${signals.router}`), count: routeFiles }));
```

翻訳は出力時にまとめて行われます。`--json` が安定した `id` と翻訳済みの `text` を同時に持てるのも、言語の追加に解析側の変更が要らないのも、この仕組みのためです。

### メッセージを追加する

1. `scripts/i18n/` の**すべての**カタログにキーを追加します。カタログにキーが欠けている、値が空、`{placeholder}` が未解決のまま残る、のいずれでも `test/i18n.test.mjs` が失敗します。
2. 文字列連結ではなく `{name}` のプレースホルダを使ってください。言語によって語順が変わるためです。
3. メッセージの中に別のメッセージを埋め込む場合は、パラメータとして記述子を渡してください。翻訳器が再帰的に解決します。
4. キーは公開APIです（`--json` の `id` として出ます）。名前の変更は破壊的変更になります。

### 言語を追加する

1. `scripts/i18n/en.mjs` を `scripts/i18n/<tag>.mjs` にコピーし、値を翻訳します。
2. `scripts/i18n/index.mjs` の `CATALOGS` に登録します。
3. `_listSeparator` を、その言語で列挙に使う区切り文字に設定します。
4. 両方のREADMEの「レポートの言語」に新しい値を記載します。
5. `npm run check` を実行します。

広く使われているフレームワーク用語（Route Handler、Server Actions、lockfile、App Router など）は、原語のまま残してください。翻訳した結果、Next.jsのドキュメントと突き合わせられなくなると、かえって動きにくくなります。

### contextのフィールドを変更する場合

人的証拠の7フィールドは設計上固定です。8つ目の採点項目の追加は提案しないでください。追加の事実は自由記述の `note` に入れる想定です。**選択肢の値**を変更する場合、値はロケール非依存のキーであり、各ロケールの表示ラベルが別名として照合される点に注意してください。これにより、以前に書かれたcontextファイルが動き続けます。両方のREADMEの表を更新してください。`npm run validate:docs` がこれを検査します。

## Pull request

- `main` から分岐し、1つの関心事に絞ってください。
- コミットの件名は命令形で書いてください（`feat: detect ...`、`fix: ...`、`docs: ...`）。
- pushの前に `npm run check` を実行してください。
- pull requestテンプレートを埋め、その変更がどの証拠に基づくかを説明してください。
- 片方の言語の文章を変更するpull requestは、他の言語も併せて変更するか、変更しない理由を明示してください。

## リリース

公開はメンテナのみが行います。リリースはタグ駆動で、チェック一式とtarballのスモークテストが通らない限りnpmには何も届きません。

1. `main` が緑で、リリースに含めたいものが全部入っていることを確認します。
2. `CHANGELOG.md` を更新します。`Unreleased` の項目を新しいバージョン見出し（当日の日付つき）へ移し、末尾の比較リンクを追加します。
3. `package.json` の `version` を合わせます。タグと `package.json` が食い違うとworkflowが公開を拒否します。
4. ローカルでもう一度 `npm run check` を実行します。
5. コミットし、pull requestを出してマージします。
6. マージコミットにタグを打ってpushします。

   ```bash
   git checkout main && git pull
   git tag -a v0.7.1 -m "v0.7.1"
   git push origin v0.7.1
   ```

`Release` workflowが、チェック一式の実行、タグと `package.json` の照合、packしたtarballをクリーンなプロジェクトへインストールして `bin` のシンボリックリンク経由で両言語のCLIを実行、npm provenance付きでの公開、GitHub releaseの作成まで行います。

公開せずに予行演習したい場合は、Actionsタブから手動実行し、**Pack and verify without publishing** をオンのままにしてください。verifyジョブで止まります。

### 初回のみ必要な設定

- `next-or-not` への公開権限を持つnpm automation tokenを、リポジトリsecretの `NPM_TOKEN` として登録します。
- `npm-publish` という名前のリポジトリenvironmentを作成します。レジストリへ送る前に人間の承認を挟みたい場合は、required reviewersを設定してください。

provenanceにはworkflowの `id-token: write` 権限が必要ですが、これは設定済みです。公開済みバージョンは差し替えられず、deprecateしかできません。ミスの代償はパッチバージョンを1つ消費することで、上書きではありません。

## バグ報告

バグ用のテンプレートでissueを作成してください。誤検出を再現する最小のリポジトリ構成があると、説明文よりもずっと助かります。解析はファイル内容に対して完全に決定的なので、たいていfixtureだけで原因を特定できます。

セキュリティに関わるものは [SECURITY.md](SECURITY.md) を読み、非公開で報告してください。

## 行動規範

参加にあたっては [行動規範](CODE_OF_CONDUCT.md) が適用されます。
