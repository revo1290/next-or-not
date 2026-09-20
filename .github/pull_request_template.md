## Summary / 概要

<!-- What does this change and why? English or Japanese is fine. -->
<!-- 何を、なぜ変えるのか。日本語・英語どちらでも構いません。 -->

## Type of change / 変更の種類

- [ ] Bug fix / バグ修正
- [ ] New detection or decision change / 検出・判断の変更
- [ ] Translation or i18n / 翻訳・多言語対応
- [ ] Documentation / ドキュメント
- [ ] Build, CI, or tooling / ビルド・CI・ツール

## Evidence / 根拠

<!--
For a detection or decision change, name the source pattern and the official documentation behind it.
検出・判断の変更の場合は、対象のソースパターンと、その裏付けとなる公式ドキュメントを書いてください。
-->

## Checklist / チェックリスト

- [ ] `npm run check` passes locally / ローカルで `npm run check` が通る
- [ ] A regression fixture covers the change, if it affects detection or decisions / 検出・判断に影響する場合、回帰用fixtureを追加した
- [ ] `references/decision-model.md` updated, if the derivation changed / 導出が変わる場合、`references/decision-model.md` を更新した
- [ ] The evidence date in `references/framework-evidence.md` is current, if a time-sensitive framework fact is involved / 時間依存のフレームワークの事実に触れる場合、証拠の日付を更新した
- [ ] Message keys added to every catalog in `scripts/i18n/`, if user-facing text changed / ユーザーに見える文言を変えた場合、`scripts/i18n/` の全カタログにキーを追加した
- [ ] Both `README.md` and `README.ja.md` updated, if documented behavior changed / 文書化された挙動が変わる場合、両方のREADMEを更新した
- [ ] The dangerous-error gate stays at zero / 危険な誤りのゲートがゼロのまま

## Notes for reviewers / レビュアーへの補足

<!-- Anything you are unsure about, or deliberately left out of scope. -->
<!-- 判断に迷った点や、意図的にスコープ外にした点があれば。 -->
