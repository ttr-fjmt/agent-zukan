'use strict';

/**
 * agents.json のカテゴリーを、サイトで使う分類にまとめ直し、categories.json を作り直す。
 *
 * 【なぜ promote-categories.js を置き換えたか】
 * 以前は「その他」に付いた補足メモを、5件たまるたびに正式カテゴリーへ自動昇格させていた。
 * 厚労省データを4,000件超取り込んだ結果、補足メモのほとんどが職業紹介の許可区分の
 * 言い換えで、同じ意味のカテゴリーが46種類に増えた（「職業紹介・人材紹介」812件、
 * 「職業紹介事業一般」787件…）。しかも自動採番のslugになるため、トップの
 * 「職種から探す」には1つも出ず、表に出ていたのは4,084社中144社だけだった。
 *
 * 増やす方向をやめ、名前の文字列で機械的にまとめる方向に変えた。
 * まとめ方は lib/category-merge.js にあり、ユニットテストで固定している。
 *
 * 実行: cd scraper && node merge-categories.js
 */

const fs = require('fs');
const path = require('path');

const { mergeCategory } = require('./lib/category-merge');
const { CATEGORIES } = require('./lib/schema');

const ROOT = path.join(__dirname, '..');
const AGENTS_PATH = path.join(ROOT, 'agents.json');
const CATEGORIES_PATH = path.join(ROOT, 'categories.json');

/** カテゴリーの見た目。既存のものは色・アイコンをそのまま引き継ぐ。 */
const APPEARANCE = {
  '医療・介護・福祉': {
    slug: 'medical-care',
    from: '#3F8F8A', to: '#245B57',
    icon: '<path d="M32 18v28M18 32h28" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
  },
  '農業': {
    slug: 'agriculture',
    from: '#6C8F3A', to: '#405721',
    icon: '<path d="M32 48V28" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>'
      + '<path d="M32 30c0-7-6-12-13-12 0 7 6 12 13 12Z" stroke="#fff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>'
      + '<path d="M32 34c0-7 6-12 13-12 0 7-6 12-13 12Z" stroke="#fff" stroke-width="2.2" fill="none" stroke-linejoin="round"/>',
  },
  '外国人・特定技能': {
    slug: 'global-talent',
    from: '#8A6BA8', to: '#553F6B',
    icon: '<circle cx="26" cy="24" r="7" stroke="#fff" stroke-width="2.4" fill="none"/>'
      + '<path d="M14 48c0-7 5-11 12-11s12 4 12 11" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
      + '<circle cx="44" cy="30" r="9" stroke="#fff" stroke-width="2.2" fill="none"/>'
      + '<path d="M35 30h18M44 21c4 5 4 13 0 18M44 21c-4 5-4 13 0 18" stroke="#fff" stroke-width="1.8" fill="none"/>',
  },
  '運輸・物流': {
    slug: 'logistics',
    from: '#4A6C99', to: '#2B4160',
    icon: '<rect x="12" y="24" width="24" height="18" rx="2" stroke="#fff" stroke-width="2.4" fill="none"/>'
      + '<path d="M36 30h9l7 7v5h-16z" stroke="#fff" stroke-width="2.4" fill="none" stroke-linejoin="round"/>'
      + '<circle cx="22" cy="45" r="4" stroke="#fff" stroke-width="2.4" fill="none"/>'
      + '<circle cx="44" cy="45" r="4" stroke="#fff" stroke-width="2.4" fill="none"/>',
  },
  '全職種対応': {
    slug: 'all-jobs',
    from: '#6B7A8F', to: '#3F4A59',
    icon: '<rect x="14" y="14" width="15" height="15" rx="2" stroke="#fff" stroke-width="2.4" fill="none"/>'
      + '<rect x="35" y="14" width="15" height="15" rx="2" stroke="#fff" stroke-width="2.4" fill="none"/>'
      + '<rect x="14" y="35" width="15" height="15" rx="2" stroke="#fff" stroke-width="2.4" fill="none"/>'
      + '<rect x="35" y="35" width="15" height="15" rx="2" stroke="#fff" stroke-width="2.4" fill="none"/>',
  },
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** 正式な14カテゴリーぶんの categories.json を作る。既存の色・アイコン・slugは活かす。 */
function buildCategories(existing) {
  const byName = new Map((existing || []).map(c => [c.name, c]));
  return CATEGORIES.map(name => {
    const prev = byName.get(name);
    if (prev && prev.slug && !/^category-\d+$/.test(prev.slug)) return { ...prev, name };
    const look = APPEARANCE[name];
    if (!look) throw new Error(`カテゴリー「${name}」の見た目（色・アイコン・slug）が未定義です`);
    return { name, from: look.from, to: look.to, icon: look.icon, slug: look.slug };
  });
}

function main() {
  const agents = readJson(AGENTS_PATH, []);
  if (agents.length === 0) {
    console.log(`No agents found at ${AGENTS_PATH} — skipping category merge.`);
    return;
  }

  const before = new Map();
  const moves = new Map();
  let changed = 0;

  for (const agent of agents) {
    const from = agent.category;
    before.set(from, (before.get(from) || 0) + 1);
    const to = mergeCategory(from);
    if (to !== from) {
      changed += 1;
      const key = `${from} → ${to}`;
      moves.set(key, (moves.get(key) || 0) + 1);
      agent.category = to;
    }
    // categoryHint は「その他」のときの補足メモ。まとめ先が決まった行では残さない。
    if (agent.category !== 'その他') agent.categoryHint = null;
  }

  const categories = buildCategories(readJson(CATEGORIES_PATH, []));

  writeJson(AGENTS_PATH, agents);
  writeJson(CATEGORIES_PATH, categories);

  console.log(`カテゴリーを ${before.size} 種類 → ${categories.length} 種類にまとめました（${changed}件を付け替え）。`);
  for (const [move, count] of [...moves].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}件  ${move}`);
  }

  const after = new Map();
  for (const a of agents) after.set(a.category, (after.get(a.category) || 0) + 1);
  console.log('\nまとめ後:');
  for (const c of categories) console.log(`  ${c.name.padEnd(22)}${String(after.get(c.name) || 0).padStart(5)}社  (${c.slug})`);
}

if (require.main === module) main();

module.exports = { buildCategories, APPEARANCE };
