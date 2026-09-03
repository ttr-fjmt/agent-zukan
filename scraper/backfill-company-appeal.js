'use strict';

/**
 * 一回限りのバックフィルスクリプト。
 * agents.json のスキーマに companyAppeal を追加した際、既存エントリはこのフィールドを
 * 持たないため、companyAppeal が未設定（null/undefined）の全エントリを対象に、
 * structure.js の通常フロー（_rawHash 差分検知によるAI呼び出しスキップ）を意図的に無視して
 * AIによる再構造化を強制実行し、companyAppeal を後追いで埋める。
 *
 * companyAppeal 以外のAI生成フィールドも同時に最新化されるが、これは意図した副作用であり、
 * 実害はない（元々 _rawHash 一致時に再構造化しないのは「変化していないなら呼び出しコストを
 * 省く」ための最適化であって、再構造化自体は常に安全）。
 *
 * 実行後は不要になるため、削除して構わない。
 *
 * 使い方: ANTHROPIC_API_KEY=... node backfill-company-appeal.js
 */

const fs = require('fs');
const path = require('path');

const {
  computeRawHash,
  assembleEntry,
  topCategoryHints,
  buildWithAI,
} = require('./structure');

const AGENTS_PATH = path.join(__dirname, '..', 'agents.json');
const RAW_PATH = path.join(__dirname, '..', 'data', 'raw-agents.json');
const MHLW_RAW_PATH = path.join(__dirname, '..', 'data', 'mhlw-agents.json');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set. This backfill requires real AI structuring — aborting.');
    process.exit(1);
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey });

  const agents = readJson(AGENTS_PATH, []);
  const rawData = readJson(RAW_PATH, { agents: [] });
  const mhlwRaw = readJson(MHLW_RAW_PATH, []);

  const jesraByUrl = new Map((rawData.agents || []).map(r => [r.detailUrl, r]));
  const mhlwByUrl = new Map(mhlwRaw.map(r => [r.detailUrl, r]));

  const targets = agents
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => !a.companyAppeal);

  if (targets.length === 0) {
    console.log('No agents are missing companyAppeal — nothing to backfill.');
    return;
  }

  console.log(`Backfilling companyAppeal for ${targets.length} / ${agents.length} agents...`);

  const existingHints = topCategoryHints(agents);

  let succeeded = 0;
  let failed = 0;

  for (const { a, index } of targets) {
    const source = a.source;
    const raw = source === 'mhlw' ? mhlwByUrl.get(a._sourceUrl) : jesraByUrl.get(a._sourceUrl);

    if (!raw) {
      console.warn(`[skip] ${a.id} (${a.name}): no matching raw data found for _sourceUrl=${a._sourceUrl}`);
      failed += 1;
      continue;
    }

    try {
      const ai = await buildWithAI(raw, anthropic, source, existingHints);
      const rawHash = computeRawHash(raw, source);
      agents[index] = assembleEntry(raw, ai, rawHash, source);
      succeeded += 1;
      console.log(`[${succeeded + failed}/${targets.length}] ${a.id} ${a.name}: companyAppeal backfilled.`);
    } catch (err) {
      console.warn(`[fail] ${a.id} (${a.name}): ${err.message}`);
      failed += 1;
    }

    // API負荷軽減のための短いポライトディレイ
    await sleep(300);

    // 5件ごとに中間保存しておく（長時間実行が途中で落ちても進捗を失わないため）
    if ((succeeded + failed) % 5 === 0) {
      writeJson(AGENTS_PATH, agents);
    }
  }

  writeJson(AGENTS_PATH, agents);
  console.log(`Backfill finished: succeeded=${succeeded}, failed=${failed}, total=${targets.length}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
