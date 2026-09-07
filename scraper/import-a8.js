'use strict';

/**
 * A8.net アフィリエイト提携エージェントのExcel（data/a8-import/ 配下、固定ファイル名）を
 * 読み込み、agents.json に featured エージェントとして取り込む。
 *
 * - 対象ファイルは data/a8-import/{A8_FILE_NAME} 固定（都度この同じファイル名で上書き
 *   更新される運用）。B列「サイト」による絞り込みは行わない（このファイル自体が
 *   転職エージェント図鑑専用の運用に切り替わったため）。対象行は C・D・E列
 *   （広告主名・リンク・特徴）が全て埋まっている行のみ。
 * - 既存agents.jsonと会社名で突き合わせる:
 *   - マッチした場合 → 既存エントリを「マージ更新」する。category/region/targetAge/
 *     oneLiner/appeal等の紹介文まわりはExcel側（AI構造化結果）で上書きするが、
 *     website/feeRate/companyDetail等、Excelには元々情報が無い項目は既存の値を
 *     壊さないよう温存する（既存エントリが持つ厚みのある実データを失わないため）。
 *     id・source は変更しない。
 *   - マッチしない場合 → 新規エントリとして追加する（source: "a8"、id: "a8-NNN"）。
 * - F/G列（対応エリア・対象年代）が空欄の場合は、AI構造化結果（structure.jsの
 *   buildWithAIが返す region/targetAge）で補完する。値がある場合は従来通りExcel側を
 *   優先する。H列（特化領域）はAIプロンプトへの入力としてのみ使う（専用の出力項目は無い）。
 * - AI構造化には structure.js の buildWithAI（source: "a8" 分岐）をそのまま再利用する。
 * - ANTHROPIC_API_KEY が無い環境では、buildOfflineA8() による簡易フォールバックで動作する
 *   （データマッピング・重複除去・突き合わせの検証はAPIキー無しでも行える。ただし
 *   region/targetAgeのAI補完は行われない）。
 * - 処理（追加/更新）に成功した行は、元Excelファイルの A列「反映」をTRUEに更新して
 *   上書き保存する（次回実行時に同じ行を無駄に再処理しないための記録。実際には
 *   既に反映済みの行が混在しても、再処理自体は無害なマージ更新になるだけなので、
 *   古いTRUE行を除外するための必須条件ではない）。処理に失敗した行はA列を更新せず
 *   警告を出力する。書き込みには、既存の書式・列幅等をxlsxパッケージより確実に
 *   保持できるexceljsを使う。
 *
 * 使い方:
 *   node import-a8.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const { NOT_DISCLOSED } = require('./lib/schema');
const { buildWithAI, topCategoryHints } = require('./structure');

const AGENTS_PATH = path.join(__dirname, '..', 'agents.json');
const A8_IMPORT_DIR = path.join(__dirname, '..', 'data', 'a8-import');
const A8_FILE_NAME = 'アフィリエイト案件_転職エージェント図鑑.xlsx';
const A8_FILE_PATH = path.join(A8_IMPORT_DIR, A8_FILE_NAME);
const REFLECTED_COLUMN = '反映';

const TALENT_RANGE_NOT_DISCLOSED = '非公開（具体的なレンジの記載なし）';

const A8_COMPANY_DETAIL_DEFAULTS = {
  permitNumber: NOT_DISCLOSED,
  placementRate: NOT_DISCLOSED,
  avgDays: NOT_DISCLOSED,
  trackRecord: NOT_DISCLOSED,
  refundPolicy: NOT_DISCLOSED,
  upfrontFee: NOT_DISCLOSED,
  minContract: NOT_DISCLOSED,
  exclusivity: NOT_DISCLOSED,
  capacity: NOT_DISCLOSED,
  sourcingMethod: NOT_DISCLOSED,
  reportingFreq: NOT_DISCLOSED,
  handoverPolicy: NOT_DISCLOSED,
  onboardingSupport: NOT_DISCLOSED,
  confidentiality: NOT_DISCLOSED,
};

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
  }
  return args;
}

function todayJst() {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
}

function buildA8SourceNote(fileBaseName) {
  return (
    `A8.netアフィリエイト提携情報（${fileBaseName}）をもとに作成。取得日: ${todayJst()}。` +
    `掲載情報は提携先の申告内容に基づきます。手数料・実績等の数値情報は今回のデータには含まれていません。`
  );
}

/** <a href="...">...</a> の href 部分のみを抽出する（1x1トラッキング画像タグは無視）。 */
function extractAffiliateUrl(linkHtml) {
  if (!linkHtml) return null;
  const match = /<a\s+[^>]*href="([^"]+)"/i.exec(String(linkHtml));
  return match ? match[1] : null;
}

function cell(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

/**
 * Excelを、A列（反映）がFALSE（または空欄）かつB・C・D列（広告主名・リンク・特徴）が
 * 全て埋まっている行のみに絞り込んで読む。既に反映=TRUEの行はB・C・D列が埋まっていても
 * 処理対象から除外する（日次/都度の実行のたびに既存の全社を毎回AIに再送信するのを防ぎ、
 * 無駄なAPIコストが発生し続けないようにするため）。
 * B列「サイト」による絞り込みは行わない（ファイル自体が転職エージェント図鑑専用のため）。
 * 各行に _rowIndex（sheet_to_jsonのヘッダー除く0始まりインデックス）を持たせ、
 * 後で反映列を更新する際にExcelの実際の行番号（_rowIndex + 2）へ変換できるようにする。
 */
function readRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: null });
  return raw
    .map((r, index) => ({
      _rowIndex: index,
      reflected: !!r[REFLECTED_COLUMN],
      name: cell(r['広告主名']),
      affiliateUrl: extractAffiliateUrl(r['リンク']),
      feature: cell(r['特徴']),
      region: cell(r['対応エリア']),
      targetAge: cell(r['対象年代']),
      specialty: cell(r['なにに特化しているか']),
    }))
    .filter(r => !r.reflected && r.name && r.affiliateUrl && r.feature);
}

/**
 * 処理に成功した行（rowIndexes、sheet_to_jsonの0始まりインデックス）について、
 * 元Excelファイルの反映列（A列）をTRUEに更新して上書き保存する。
 * xlsxパッケージ（読み込み専用として使用）ではなくexceljsを使うことで、
 * 既存の書式・列幅・他のシート内容をできる限り保持したまま特定セルのみ更新する。
 */
async function markRowsReflected(filePath, rowIndexes) {
  if (rowIndexes.length === 0) return;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  const headerRow = worksheet.getRow(1);
  let reflectedColNum = null;
  headerRow.eachCell({ includeEmpty: false }, (c, colNumber) => {
    if (String(c.value).trim() === REFLECTED_COLUMN) reflectedColNum = colNumber;
  });
  if (!reflectedColNum) {
    throw new Error(`"${REFLECTED_COLUMN}" 列がExcelのヘッダー行に見つかりませんでした。反映列の更新をスキップします。`);
  }

  for (const rowIndex of rowIndexes) {
    const excelRowNumber = rowIndex + 2; // +1: 0始まり→1始まり, +1: ヘッダー行分
    worksheet.getRow(excelRowNumber).getCell(reflectedColNum).value = true;
  }

  await workbook.xlsx.writeFile(filePath);
}

/** 広告主名（会社名）だけをキーにした重複除去。1件目（先頭行）を採用し、以降はスキップする。 */
function dedupeByName(rows) {
  const seen = new Map();
  const skipped = [];
  for (const row of rows) {
    if (seen.has(row.name)) {
      skipped.push(row);
      continue;
    }
    seen.set(row.name, row);
  }
  return { unique: [...seen.values()], skipped };
}

/** 既存agents.jsonの "a8-NNN" 形式idの最大値+1から連番を振る（複数回のインポートをまたいでも衝突しない）。 */
function nextA8IdCounter(agents) {
  let max = 0;
  for (const a of agents) {
    const m = /^a8-(\d+)$/.exec(a.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

function guessCategoryOfflineA8(row) {
  const hay = `${row.feature || ''} ${row.specialty || ''}`;
  if (/IT|Web|エンジニア|システム|データサイエンス/i.test(hay)) return 'IT・Web';
  if (/建設|施工|不動産|建築/.test(hay)) return '施工管理・建設';
  if (/営業|マーケ|販売/.test(hay)) return '営業・マーケティング';
  if (/外資|グローバル|海外/.test(hay)) return '外資・グローバル';
  if (/スタートアップ|ベンチャー/.test(hay)) return 'スタートアップ・ベンチャー';
  if (/地方|UIターン|Uターン|Iターン/i.test(hay)) return '地方転職・UIターン';
  if (/新卒|第二新卒|ポテンシャル/.test(hay)) return '第二新卒・ポテンシャル層';
  if (/管理部門|コンサル|経理|人事|バックオフィス/.test(hay)) return '管理部門・コンサル';
  return 'その他';
}

/** ANTHROPIC_API_KEY が無い場合の非AIフォールバック。事実（Excelの原文）の範囲を出ない組み立てのみ行う。 */
function buildOfflineA8(row) {
  const category = guessCategoryOfflineA8(row);
  const features = [row.feature, row.specialty, row.region].filter(Boolean).slice(0, 3);
  while (features.length < 1) features.push(NOT_DISCLOSED);

  return {
    category,
    categoryHint: null,
    oneLiner: row.specialty ? `${row.specialty}に強みを持つ転職支援サービス。` : row.feature || NOT_DISCLOSED,
    companyOneLiner: row.specialty ? `${row.specialty}に特化した採用支援サービス。` : row.feature || NOT_DISCLOSED,
    appeal: row.feature || NOT_DISCLOSED,
    companyAppeal: row.feature || NOT_DISCLOSED,
    features,
    companyFeatures: features,
  };
}

/**
 * 新規エントリを組み立てる（Excelに情報が無い項目は固定値、website/faviconUrlはnull）。
 * targetAge/regionはExcel（F/G列）の値を優先し、空欄の場合はAI構造化結果で補完する。
 */
function buildNewEntry({ id, row, ai, sourceNote }) {
  return {
    id,
    source: 'a8',
    name: row.name,
    category: ai.category,
    categoryHint: ai.category === 'その他' ? (ai.categoryHint || null) : null,
    targetAge: row.targetAge || ai.targetAge || NOT_DISCLOSED,
    region: row.region || ai.region || NOT_DISCLOSED,
    jobCount: NOT_DISCLOSED,
    feeRate: NOT_DISCLOSED,
    talentRange: TALENT_RANGE_NOT_DISCLOSED,
    oneLiner: ai.oneLiner,
    companyOneLiner: ai.companyOneLiner,
    appeal: ai.appeal,
    companyAppeal: ai.companyAppeal || ai.appeal,
    features: ai.features,
    companyFeatures: ai.companyFeatures || ai.features,
    reviews: [],
    reviewNote: null,
    companyReviews: [],
    companyReviewNote: null,
    feeExplanation: NOT_DISCLOSED,
    commitmentExplanation: NOT_DISCLOSED,
    website: null,
    faviconUrl: null,
    affiliateUrl: row.affiliateUrl,
    featured: true,
    real: true,
    sourceNote,
    companyDetail: { ...A8_COMPANY_DETAIL_DEFAULTS },
    _sourceUrl: null,
    _rawHash: null,
  };
}

/**
 * 既存エントリへのマージ更新。category/region/targetAge/紹介文まわり・featured・affiliateUrl
 * のみ上書きし、それ以外（website/feeRate/companyDetail/reviews/sourceNote/_sourceUrl等）は
 * 既存の値をそのまま温存する（Excel側に元々情報が無い項目で、既存の実データを消さないため）。
 */
function mergeIntoExisting(existing, { row, ai }) {
  return {
    ...existing,
    category: ai.category,
    categoryHint: ai.category === 'その他' ? (ai.categoryHint || null) : null,
    targetAge: row.targetAge || ai.targetAge || existing.targetAge,
    region: row.region || ai.region || existing.region,
    oneLiner: ai.oneLiner,
    companyOneLiner: ai.companyOneLiner,
    appeal: ai.appeal,
    companyAppeal: ai.companyAppeal || ai.appeal,
    features: ai.features,
    companyFeatures: ai.companyFeatures || ai.features,
    affiliateUrl: row.affiliateUrl,
    featured: true,
  };
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(A8_FILE_PATH)) {
    console.error(
      `固定のA8インポート用Excelファイルが見つかりません: ${A8_FILE_PATH}\n` +
        `data/a8-import/ 配下に「${A8_FILE_NAME}」という名前でファイルを配置してください。`
    );
    process.exit(1);
  }

  const rows = readRows(A8_FILE_PATH);
  const { unique, skipped } = dedupeByName(rows);

  console.log(`Read ${rows.length} row(s) from ${A8_FILE_NAME}.`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} duplicate row(s) (same 広告主名 — first occurrence wins):`);
    skipped.forEach(r => console.log(`  - ${r.name}`));
  }
  console.log(`${unique.length} unique compan${unique.length === 1 ? 'y' : 'ies'} to process.`);

  const agents = JSON.parse(fs.readFileSync(AGENTS_PATH, 'utf8'));
  const byName = new Map(agents.map(a => [a.name, a]));
  let nextIdNum = nextA8IdCounter(agents);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let anthropic = null;
  if (apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey });
  } else {
    console.warn('ANTHROPIC_API_KEY is not set — running in offline fallback mode (no AI structuring, no region/targetAge inference).');
  }
  const existingHints = topCategoryHints(agents);
  const sourceNote = buildA8SourceNote(A8_FILE_NAME);

  const finalEntriesById = new Map(agents.map(a => [a.id, a]));
  let updated = 0;
  let added = 0;
  let aiCalls = 0;
  let offlineBuilds = 0;
  const processedRowIndexes = [];
  const failedRows = [];

  for (const row of unique) {
    try {
      const existing = byName.get(row.name);
      const rawForAI = {
        companyName: row.name,
        feature: row.feature,
        specialty: row.specialty,
        region: row.region,
        targetAge: row.targetAge,
      };

      let ai;
      if (anthropic) {
        try {
          ai = await buildWithAI(rawForAI, anthropic, 'a8', existingHints);
          aiCalls += 1;
        } catch (err) {
          console.warn(`AI structuring failed for ${row.name}: ${err.message}. Falling back to offline builder.`);
          ai = buildOfflineA8(row);
          offlineBuilds += 1;
        }
      } else {
        ai = buildOfflineA8(row);
        offlineBuilds += 1;
      }

      if (existing) {
        const merged = mergeIntoExisting(existing, { row, ai });
        finalEntriesById.set(existing.id, merged);
        updated += 1;
        console.log(`[update] ${row.name} (id=${existing.id})`);
      } else {
        const id = `a8-${String(nextIdNum++).padStart(3, '0')}`;
        const entry = buildNewEntry({ id, row, ai, sourceNote });
        finalEntriesById.set(id, entry);
        added += 1;
        console.log(`[add]    ${row.name} (id=${id})`);
      }
      processedRowIndexes.push(row._rowIndex);
    } catch (err) {
      failedRows.push(row.name);
      console.warn(`[skip]   ${row.name}: processing failed (${err.message}). 反映列は更新しません。`);
    }
  }

  console.log(
    `\nDone. updated=${updated} added=${added} ai=${aiCalls} offline=${offlineBuilds}` +
      (failedRows.length > 0 ? ` failed=${failedRows.length}` : '')
  );

  if (dryRun) {
    console.log('[dry-run] agents.json および元Excelファイルは変更されていません。');
    return;
  }

  // 既存の並び順を維持しつつ、更新分はその場で差し替え、新規分は末尾に追加する。
  const finalAgents = agents.map(a => finalEntriesById.get(a.id));
  const existingIds = new Set(agents.map(a => a.id));
  for (const [id, entry] of finalEntriesById) {
    if (!existingIds.has(id)) finalAgents.push(entry);
  }

  fs.writeFileSync(AGENTS_PATH, JSON.stringify(finalAgents, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${finalAgents.length} agents to ${AGENTS_PATH}.`);

  if (processedRowIndexes.length > 0) {
    try {
      await markRowsReflected(A8_FILE_PATH, processedRowIndexes);
      console.log(`Marked ${processedRowIndexes.length} row(s) as 反映=TRUE in ${A8_FILE_NAME}.`);
    } catch (err) {
      console.warn(`反映列の更新に失敗しました: ${err.message}`);
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  readRows,
  dedupeByName,
  extractAffiliateUrl,
  nextA8IdCounter,
  buildOfflineA8,
  buildNewEntry,
  mergeIntoExisting,
  buildA8SourceNote,
  markRowsReflected,
  A8_FILE_NAME,
  A8_FILE_PATH,
};
