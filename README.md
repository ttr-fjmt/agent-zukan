# 転職エージェント図鑑

転職エージェント比較サイト。厚生労働省委託「職業紹介優良事業者認定制度」（jesra.or.jp）に掲載された
人材紹介事業者の公開情報を定期的にクロールし、比較用データ（`agents.json`）として提供します。

## 構成

```
index.html                   フロントエンド（agents.json を fetch して描画）
agents.json                 構造化済みの掲載データ（自動生成・コミットされる）
data/raw-agents.json        スクレイパーが取得した生データ（自動生成・コミットされる）
scraper/
  scrape.js                 jesra.or.jp のクロール（一覧のページネーション追跡→詳細ページ抽出）
  structure.js               生データを agents.json のスキーマに構造化（Claude Haiku 4.5 使用）
  lib/robots.js              robots.txt の取得・判定
  lib/http.js                 UA・リクエスト間隔（ポライトネス）
  lib/schema.js               カテゴリ一覧・共通定数
.github/workflows/
  scrape-agents.yml           毎日深夜(JST)に自動実行するワークフロー
```

## データパイプライン

1. **`scraper/scrape.js`** — jesra.or.jp の認定事業者一覧（`/yuryoshokai/certification/`）を
   ページネーションを辿って全件発見し、各詳細ページから企業名・サービス名・サービスURL・
   対応エリア・対応業界・対応職種・許可番号・手数料公表サイトURLなどの事実情報を抽出します。
   手数料公表サイトが判明した場合は、そのページを追加で取得します（HTMLはテキスト抽出、
   PDFは `pdf-parse` でテキスト抽出）。
   - リクエスト間隔は既定で3〜5秒（`SCRAPER_MIN_DELAY_MS` / `SCRAPER_JITTER_MS` で調整可）
   - `robots.txt` を毎回確認し、Disallow に該当するパスはスキップ／クロール中断します
   - 手数料公表サイトの取得に失敗した場合（404・タイムアウト・robots.txt禁止等）はスキップし、
     後段の構造化ステップで `非公開（お問い合わせで確認）` が維持されます
   - 出力: `data/raw-agents.json`

2. **`scraper/structure.js`** — 生データと既存の `agents.json` を比較し、内容に差分がある
   事業者のみ Claude Haiku 4.5（`ANTHROPIC_API_KEY`）に投げて `agents.json` のスキーマに
   構造化します（差分のない事業者は前回の結果を再利用し、APIコストを抑えます。差分判定には
   手数料公表サイトのテキストも含まれます）。
   事業者コメント等の本文はそのまま転載せず、事実の要約にとどめるよう指示しています。
   手数料公表サイトのテキストが「職業安定法の届出制手数料表の上限額」なのか「実際の相場」
   なのかをAIが文脈から判断し、上限額しか読み取れない場合は業界相場の推定値を主に、届出上限を
   括弧内に併記します（例:「理論年収の30〜35%程度（業界相場からの推定値。公式の届出上限は
   賃金の150%）」）。返戻金制度（返金保証）の記載があれば `companyDetail.refundPolicy` に反映します。
   取得できなかった項目は `非公開（お問い合わせで確認）` として埋められます。
   - `ANTHROPIC_API_KEY` が未設定の場合はオフラインフォールバックで動作し、生データから
     直接組み立てます（次回キーがある実行時に自動で再構造化されます）。
   - 出力: `agents.json`

3. **`.github/workflows/scrape-agents.yml`** — 毎日 18:30 UTC（JST 3:30、深夜帯）に上記2つを
   実行し、差分があれば `agents.json` / `data/raw-agents.json` をコミット・pushします。
   `workflow_dispatch` にも対応しているので、GitHub の Actions タブから手動実行もできます。

## セットアップ

1. リポジトリの Settings → Secrets and variables → Actions で `ANTHROPIC_API_KEY` を登録する
2. Settings → Pages で Source を「Deploy from a branch」→ `main` / `/ (root)` に設定する
   （`index.html` がルートにあるため、追加設定なしでトップページとして公開されます）
3. Actions タブから `Scrape agents and update agents.json` を手動実行し、初回データを生成する

## ローカルでの動作確認

```bash
cd scraper
npm install
node scrape.js                          # data/raw-agents.json を生成
ANTHROPIC_API_KEY=sk-ant-... node structure.js   # agents.json を生成（キー無しならオフラインモード）
```
