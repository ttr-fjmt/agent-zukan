'use strict';

/**
 * 厚生労働省「人材サービス総合サイト」から、全国の職業紹介事業者を段階的に取り込む。
 *
 * - 47都道府県を順に検索し、1回の実行につき新規に取得する詳細ページ数は
 *   lib/mhlw.js の DAILY_DETAIL_LIMIT 件まで（1箇所で調整可能）。
 * - どの都道府県の何ページ目まで処理したかを data/mhlw-cursor.json に保存し、
 *   次回実行時はそこから再開する（同ファイルはリポジトリにコミットして永続化）。
 * - 取得した生データは data/mhlw-agents.json に累積で追記していく
 *   （jesra側の data/raw-agents.json のように毎回まるごと上書きするのではなく、
 *   全国分を何日もかけて積み上げていく前提のため）。
 * - 既存 agents.json / data/mhlw-agents.json の許可番号（permitNumber）と突合し、
 *   すでに掲載済みの事業者（jesra由来57社を含む）はスキップする。
 * - 手数料・返戻金制度は今回取得しない（agents.json化の際は非公開のまま）。
 * - 日曜22:00〜月曜08:00 (JST) のメンテナンス時間帯は処理をスキップする
 *   （jesra側のスクレイピングには影響しない・このスクリプトのみ対象）。
 */

const fs = require('fs');
const path = require('path');

const mhlw = require('./lib/mhlw');
const { politeDelayMhlw } = mhlw;

const AGENTS_PATH = path.join(__dirname, '..', 'agents.json');
const MHLW_RAW_PATH = path.join(__dirname, '..', 'data', 'mhlw-agents.json');
const CURSOR_PATH = path.join(__dirname, '..', 'data', 'mhlw-cursor.json');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function loadCursor() {
  return readJson(CURSOR_PATH, { prefectureIndex: 0, page: 1, totalProcessed: 0, completed: false });
}

function loadExistingPermitNumbers() {
  const set = new Set();
  const agents = readJson(AGENTS_PATH, []);
  for (const a of agents) {
    const p = a.companyDetail && a.companyDetail.permitNumber;
    if (p) set.add(p);
  }
  const mhlwRaw = readJson(MHLW_RAW_PATH, []);
  for (const r of mhlwRaw) {
    if (r.permitNumber) set.add(r.permitNumber);
  }
  return set;
}

async function main() {
  if (mhlw.isInMhlwMaintenanceWindow()) {
    console.log(
      'Current time is within the MHLW weekly maintenance window (Sun 22:00 - Mon 08:00 JST). ' +
        'Skipping MHLW ingestion this run (jesra scraping is unaffected).'
    );
    return;
  }

  const cursor = loadCursor();
  if (cursor.completed) {
    console.log('MHLW ingestion already completed for all 47 prefectures. Nothing to do.');
    return;
  }

  const existingPermitNumbers = loadExistingPermitNumbers();
  const seenThisRun = new Set();
  const newRecords = [];
  let skippedBranchCount = 0;
  let skippedAlreadyKnownCount = 0;

  const session = mhlw.createSession();
  let prefIndex = cursor.prefectureIndex;
  let resumePage = cursor.page;

  console.log(
    `Starting MHLW ingestion: prefectureIndex=${prefIndex} (${mhlw.PREFECTURES[prefIndex]?.name}), ` +
      `page=${resumePage}, dailyLimit=${mhlw.DAILY_DETAIL_LIMIT}, totalProcessedSoFar=${cursor.totalProcessed}`
  );

  outer: while (prefIndex < mhlw.PREFECTURES.length) {
    const pref = mhlw.PREFECTURES[prefIndex];
    console.log(`[${pref.name}] searching...`);
    let { $, totalCount } = await mhlw.searchPrefecture(session, pref.field);
    const totalPages = Math.ceil(totalCount / mhlw.RESULTS_PER_PAGE);
    console.log(`[${pref.name}] totalCount=${totalCount} totalPages=${totalPages} startingAtPage=${resumePage}`);

    if (resumePage > 1) {
      await politeDelayMhlw();
      $ = await mhlw.gotoResultPage(session, $, resumePage);
    }

    for (let page = resumePage; page <= totalPages; page++) {
      if (page > resumePage) {
        await politeDelayMhlw();
        $ = await mhlw.gotoResultPage(session, $, page);
      }

      const rows = mhlw.extractResultRows($);
      for (const row of rows) {
        if (!row.permitNumber) continue;

        if (existingPermitNumbers.has(row.permitNumber)) {
          skippedAlreadyKnownCount += 1;
          continue;
        }
        if (seenThisRun.has(row.permitNumber)) {
          skippedBranchCount += 1;
          continue;
        }

        if (newRecords.length >= mhlw.DAILY_DETAIL_LIMIT) {
          // 今日の上限に達した。このページの途中で止まった場合、次回はこのページから
          // 再開する（既に取り込んだ許可番号は dedup で自動的にスキップされる）。
          resumePage = page;
          break outer;
        }

        await politeDelayMhlw();
        try {
          const html = await session.get(row.detailUrl);
          const fields = mhlw.extractDetailFields(html);
          seenThisRun.add(row.permitNumber);
          newRecords.push({
            ...fields,
            prefecture: pref.name,
            detailUrl: row.detailUrl,
            fetchedAt: new Date().toISOString(),
          });
          console.log(`  [${newRecords.length}/${mhlw.DAILY_DETAIL_LIMIT}] ${fields.permitNumber} ${fields.businessOwnerName}`);
        } catch (err) {
          console.warn(`  fetch failed for ${row.detailUrl}: ${err.message}`);
        }
      }
    }

    // この都道府県を最後まで処理し終えた（上限に達さず outer を抜けずに来た）
    console.log(`[${pref.name}] done.`);
    prefIndex += 1;
    resumePage = 1;
  }

  const completed = prefIndex >= mhlw.PREFECTURES.length;
  const nextCursor = {
    prefectureIndex: completed ? mhlw.PREFECTURES.length - 1 : prefIndex,
    page: completed ? 1 : resumePage,
    totalProcessed: cursor.totalProcessed + newRecords.length,
    completed,
  };

  if (newRecords.length > 0) {
    const existingMhlwRaw = readJson(MHLW_RAW_PATH, []);
    writeJson(MHLW_RAW_PATH, existingMhlwRaw.concat(newRecords));
  }
  writeJson(CURSOR_PATH, nextCursor);

  console.log(
    `MHLW ingestion finished this run: newRecords=${newRecords.length}, ` +
      `skippedBranchDuplicates=${skippedBranchCount}, skippedAlreadyKnown=${skippedAlreadyKnownCount}, ` +
      `cursor=${JSON.stringify(nextCursor)}`
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { loadCursor, loadExistingPermitNumbers };
