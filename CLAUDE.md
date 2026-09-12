# CLAUDE.md

このリポジトリ（agent-zukan.net / 転職エージェント図鑑）で作業するときは、
**まず次の2つを読むこと。**

1. **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** — 図鑑シリーズ3サイト共通の背景、運営者（Tatsuroさん）について、
   確認すべきこと／不要なこと、データ品質の原則
2. **[DECISIONS.md](DECISIONS.md)** — Tatsuroさんがこれまでに決めたことと、現在の状況（AdSense など）。
   **ここにある判断を覆す提案をする前に、理由と「見直す条件」を必ず読むこと**

ディレクトリ構成・パイプラインの細部は [README.md](README.md) にある。

## 特に外してはいけない点

- **Tatsuroさんはエンジニアではない。** 報告・質問は平易な言葉で。「何のための変更か」を一言でまとめてから、
  判断に必要な範囲だけ説明する
- **確認を求めるのは PROJECT_CONTEXT.md の「確認すべき」項目に該当するときだけ。**
  既存ルールの適用、既知パターンの修正、テスト・ガードの追加、明らかなバグ修正は自律的に進める
- **ページ本文・公開データに書かれていないことは、AIに絶対に作らせない。** プロンプトに書いたルールは、
  必ず機械的なチェックとしても実装する
- **確認できない情報は埋めない。** 「非公開（お問い合わせで確認）」のまま残す

## 毎日動いている処理

`.github/workflows/scrape-agents.yml` が毎日 JST 3:30 に実行される。

1. `scrape.js` — 職業紹介優良事業者認定制度（jesra）の認定事業者を取得
2. `scrape-mhlw.js` — 厚労省『人材サービス総合サイト』から職業紹介事業者を段階的に取得
3. `structure.js` — 生データを `agents.json` の形に構造化（`ANTHROPIC_API_KEY` を使用）
4. `merge-categories.js` — カテゴリーを14分類にまとめ直す
5. `enrich-mhlw-websites.js` — 厚労省データの事業者の公式サイトを推定・照合（`ANTHROPIC_API_KEY` を使用）
6. `prerender.js` → `generate-category-pages.js` → `generate-sitemap.js`

A8 提携エージェントの取り込みは `import-a8.yml`（手動実行。Claude Code では `/import-a8`）。

## このリポジトリで決めている線引き（変えるときは理由ごと README と DECISIONS.md に残す）

- **検索対象（インデックス）**：[scraper/lib/indexing.js](scraper/lib/indexing.js) の1か所で決める。
  厚労省データ（`source: "mhlw"`）のページは noindex・サイトマップ除外（サイトには残す）。
  AdSense で「有用性の低いコンテンツ」と判定されたための対策。`prerender.js`・`generate-category-pages.js`・
  `generate-sitemap.js` の3か所で同じ線引きを使う
- **カテゴリー**：[scraper/lib/schema.js](scraper/lib/schema.js) の14分類だけ（特化12＋「全職種対応」「その他」）。
  カテゴリーを自動で増やす仕組みは言い換えが46種類に増えたため廃止した。まとめ方は
  [scraper/lib/category-merge.js](scraper/lib/category-merge.js)。トップの入口に出すのは特化カテゴリーだけ
- **解説記事（/guide/）**：[scraper/generate-guide-pages.js](scraper/generate-guide-pages.js) から書き出す。
  制度・金額・日付は厚労省・労働局・認定制度の公式ページで確認できたものだけを書き、出典を載せる。
  新しい数字を書くときは `test/guides.test.js` の許可リストにも足す
- **AdSense のタグ**は、固定ページ（index / faq / privacy / 404）と記事ページの `<head>` に静的に置く

## よく使うコマンド

```bash
cd scraper
npm test                          # ユニットテスト
node generate-guide-pages.js      # 解説記事を書き出す
node generate-category-pages.js   # カテゴリーページを作り直す
node generate-sitemap.js          # サイトマップを作り直す
node merge-categories.js          # カテゴリーを14分類にまとめ直す
node prerender.js                 # 静的ページ（約5,600件）。index.html を変えると全件作り直しになり数時間かかる
npm run verify-live               # 公開サイトがリポジトリどおりか確認（main への反映が終わったあと）
```

Windows で `prerender.js` のブラウザがアプリケーション制御にブロックされたときの対処は README の末尾にある。

## クラウド（Claude Code on the web）で作業するとき

パソコンを起動していなくても、スマホや claude.ai/code からクラウドのセッションで作業できる。
パソコンでの作業とは次の点が違う。

- **読めるのは、このリポジトリにコミットされているファイルだけ。** パソコン側の設定・メモは引き継がれない。
  方針と判断は `CLAUDE.md`・`PROJECT_CONTEXT.md`・`DECISIONS.md` に書いてあるものがすべて
- **`git push` はセッションの作業ブランチにしかできない。** 変更は PR にまとめ、Tatsuroさんがマージして初めて公開される。
  PR には「何のための変更か」を平易な言葉で一言書く
- **通信できるのは、クラウド環境の設定で許可したドメインだけ。** 公開サイトや公式ページを確認できなかったときは、
  推測で埋めずに「許可リストに無いため確認できなかった」と報告する（許可しているドメインは DECISIONS.md に記載）
- **`ANTHROPIC_API_KEY` を使う処理は GitHub Actions で動かす。** 必要なら `gh workflow run scrape-agents.yml` などで起動し、
  結果は `gh run view` で確認する
- 静的ページ約5,600件の作り直しは重いので、クラウドでは行わず日次ワークフローに任せる

## 作業を終えるときの確認

- `npm test` が通っているか
- index.html・カテゴリー・線引きを変えたなら、静的ページ・カテゴリーページ・サイトマップを作り直したか
- 新しいフィールドや記事の数字を足したなら、本文・公式情報と照合するガードとテストも足したか
- main に反映したら、`npm run verify-live` で公開サイトを確認したか（反映直後に失敗したら数分おいて再実行）
- Tatsuroさんが新しく判断したことがあれば、`DECISIONS.md` に日付つきで追記したか
