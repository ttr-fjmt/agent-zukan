---
description: A8アフィリエイト案件のExcel(data/a8-import/アフィリエイト案件_転職エージェント図鑑.xlsx)の更新をコミット・push・ワークフロー実行・結果確認まで自動化する
---

data/a8-import/アフィリエイト案件_転職エージェント図鑑.xlsx の
更新を、以下の手順で完全自動処理してください。

【重要】このマシンでは gh CLI が PATH に登録されていません。すべての
gh コマンドは "C:\Program Files\GitHub CLI\gh.exe" のフルパスで
実行してください。

1. `git fetch origin && git status` で、リモートに新規コミットが
   無いか確認する(あれば `git pull --ff-only` で最新化する)。

2. 対象のExcelファイルに変更があるか `git status` で確認する。
   変更が無ければ、その旨を伝えて終了する(以降の手順は不要)。

3. 変更があれば、以下でステージング・コミットする。

   ```
   git add "data/a8-import/アフィリエイト案件_転職エージェント図鑑.xlsx"
   git commit -m "chore: A8アフィリエイト案件のExcelを更新"
   ```

4. `git push -u origin main` でリモートにpushする。

5. `"C:\Program Files\GitHub CLI\gh.exe" workflow run import-a8.yml`
   でワークフローを起動する。

6. 起動直後はrun IDがすぐに取得できない場合があるため、数秒待って
   から `"C:\Program Files\GitHub CLI\gh.exe" run list
   --workflow=import-a8.yml --limit=1` で最新のrun IDを取得する。

7. `"C:\Program Files\GitHub CLI\gh.exe" run watch <run-id>
   --exit-status` で完了を待つ。

8. 完了後、`"C:\Program Files\GitHub CLI\gh.exe" run view <run-id>
   --log` で実行ログを取得し、以下のパターンでログを解析する
   (scraper/import-a8.js の実際のconsole.log出力形式に基づく。
   フリーランス案件図鑑側と出力形式が異なる可能性があるため、
   このコマンドを使う前に必ず一致しているか確認すること)。

   - サマリー行: `Done. updated=X added=Y ai=Z offline=W` という形式
     の行(処理失敗があれば末尾に ` failed=N` も付く)。
     正規表現例: `/Done\. updated=(\d+) added=(\d+) ai=(\d+) offline=(\d+)(?: failed=(\d+))?/`
   - 新規追加された会社名: `[add]    会社名 (id=xxx)` という形式の行
     (`[add]` の後に空白4つ、`[update]` との桁揃え)。
     正規表現例: `/\[add\]\s+(.+?) \(id=/`
   - 既存更新された会社名: `[update] 会社名 (id=xxx)` という形式の行。
     正規表現例: `/\[update\]\s+(.+?) \(id=/`
   - 処理に失敗した会社名(あれば): `[skip]   会社名: processing
     failed (...)` という形式の行。
     正規表現例: `/\[skip\]\s+(.+?): processing failed/`

9. 以下の形式でユーザーに結果を報告する。
   - 新規追加: X件(会社名一覧)
   - 既存更新: Y件(会社名一覧)
   - AI構造化 Z件 / オフラインフォールバック W件
   - ワークフローの成功/失敗ステータス
   - もしワークフローが失敗した場合は、ログから読み取れるエラー
     内容も報告する
   - もし [skip] 行(処理失敗)があれば、その会社名も報告する

gh CLI が何らかの理由で使えない場合のみ、フォールバックとして以下を
ユーザーに案内する。

「GitHubの Actions タブから『Import A8 affiliate agents』
ワークフローを手動実行してください」
