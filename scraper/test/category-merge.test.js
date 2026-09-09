'use strict';

/**
 * カテゴリーのまとめ方のガード。
 *
 * 以前は「その他」の補足メモを自動昇格させ続けた結果、同じ意味のカテゴリーが
 * 46種類に増え、トップの「職種から探す」に出せる社数が4,084社中144社まで減っていた。
 * 同じことが起きないよう、まとめ先の判定と入口に出す条件を固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { mergeCategory, navigableCategories } = require('../lib/category-merge');
const { CATEGORIES, SPECIALIZED_CATEGORIES, GENERAL_CATEGORY, FALLBACK_CATEGORY } = require('../lib/schema');

const ROOT = path.join(__dirname, '..', '..');
const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'categories.json'), 'utf8'));

test('職業紹介の言い換えは「全職種対応」にまとめる', () => {
  // 実際に46種類まで増えていた名前の代表例。どれも特化を表していない。
  const generic = [
    '職業紹介・人材紹介', '職業紹介事業一般', '職業紹介', '職業紹介（一般）',
    '職業紹介事業者（全職種対応）', '人材紹介サービス', '人材派遣・紹介業', '全職種対応',
  ];
  for (const name of generic) {
    assert.strictEqual(mergeCategory(name), GENERAL_CATEGORY, `${name} のまとめ先が違う`);
  }
});

test('特化を表す語は、一般的な職業紹介より優先してまとめる', () => {
  // 「職業紹介（医療・介護）」のように両方の語を含む名前があるため、順番が効いている。
  const cases = [
    ['職業紹介（医療・介護）', '医療・介護・福祉'],
    ['医療・医師', '医療・介護・福祉'],
    ['福祉・ひとり親支援', '医療・介護・福祉'],
    ['職業紹介（農業）', '農業'],
    ['農業・農協', '農業'],
    ['職業紹介（特定技能外国人向け）', '外国人・特定技能'],
    ['国際人材紹介', '外国人・特定技能'],
    ['職業紹介（外国人技能実習）', '外国人・特定技能'],
    ['運輸・物流', '運輸・物流'],
  ];
  for (const [from, to] of cases) assert.strictEqual(mergeCategory(from), to, `${from} のまとめ先が違う`);
});

test('もとから正式なカテゴリーの名前は付け替えない', () => {
  for (const name of CATEGORIES) assert.strictEqual(mergeCategory(name), name);
});

test('どのルールにも当たらない名前は「その他」にする（勝手に決めつけない）', () => {
  assert.strictEqual(mergeCategory('よく分からない分類'), FALLBACK_CATEGORY);
  assert.strictEqual(mergeCategory(''), FALLBACK_CATEGORY);
  assert.strictEqual(mergeCategory(null), FALLBACK_CATEGORY);
});

test('掲載中の全レコードが、正式な14カテゴリーのいずれかに入っている', () => {
  const stray = [...new Set(agents.map(a => a.category))].filter(c => !CATEGORIES.includes(c));
  assert.deepStrictEqual(stray, [], `正式でないカテゴリー: ${stray.join('、')}`);
});

test('categories.json が正式な14カテゴリーと一致している', () => {
  assert.deepStrictEqual(categories.map(c => c.name), CATEGORIES);
  // 自動採番のslugは、入口に出せないカテゴリーを生む原因だった。二度と作らない。
  const auto = categories.filter(c => /^category-\d+$/.test(c.slug));
  assert.deepStrictEqual(auto, [], `自動採番のslugが残っている: ${auto.map(c => c.name).join('、')}`);
  for (const c of categories) {
    assert.ok(c.slug && c.from && c.to && c.icon, `${c.name} の見た目が欠けている`);
  }
});

test('トップの入口には特化カテゴリーだけを、掲載数の多い順に出す', () => {
  const nav = navigableCategories(agents, categories);
  assert.ok(nav.length > 0);
  for (const c of nav) {
    assert.ok(SPECIALIZED_CATEGORIES.includes(c.name), `${c.name} は入口に出すカテゴリーではない`);
  }
  assert.ok(!nav.some(c => c.name === GENERAL_CATEGORY || c.name === FALLBACK_CATEGORY),
    '「全職種対応」「その他」が入口に出ている');
  const counts = nav.map(c => c.count);
  assert.deepStrictEqual(counts, [...counts].sort((a, b) => b - a), '掲載数の多い順になっていない');
});

test('index.html の特化カテゴリーが lib/schema.js と一致している', () => {
  // index.html 側に書き写しているため、片方だけ直すと入口から消えるカテゴリーが出る。
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const block = html.match(/const SPECIALIZED_CATEGORIES = \[([\s\S]*?)\];/);
  assert.ok(block, 'index.html に SPECIALIZED_CATEGORIES が無い');
  const names = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(names, SPECIALIZED_CATEGORIES);
});

test('カテゴリーを自動で増やす仕組みは残っていない', () => {
  // 46種類まで増えた原因。ワークフローからも消していること。
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'promote-categories.js')),
    'promote-categories.js が残っている');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'scrape-agents.yml'), 'utf8');
  assert.ok(!wf.includes('promote-categories'), 'ワークフローに自動昇格の手順が残っている');
  assert.ok(wf.includes('merge-categories.js'), 'ワークフローにまとめ直しの手順が無い');
});
