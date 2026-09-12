'use strict';

/**
 * 検索対象（インデックス）の線引きのガード。
 *
 * AdSense で「有用性の低いコンテンツ」と判定された原因は、厚労省データの転載ページ
 * 5,505枚を検索対象として送っていたこと。これが元に戻らないよう、
 * 静的ページ・カテゴリーページ・サイトマップの3か所で同じ線引きになっていることを固定する。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  ROBOTS_NOINDEX,
  isIndexableAgent,
  isIndexableCategory,
  withRobotsNoindex,
} = require('../lib/indexing');
const { buildEntries } = require('../generate-sitemap');

const SCRAPER = path.join(__dirname, '..');

test('厚労省データのエージェントは検索対象にしない', () => {
  assert.strictEqual(isIndexableAgent({ id: '1', source: 'mhlw' }), false);
});

test('独自に情報を集めたエージェントは検索対象にする', () => {
  assert.strictEqual(isIndexableAgent({ id: '2', source: 'jesra' }), true);
  assert.strictEqual(isIndexableAgent({ id: '3', source: 'a8' }), true);
});

test('厚労省データだけのカテゴリーは検索対象にしない', () => {
  const agents = [
    { id: 'a', source: 'mhlw', category: '農業' },
    { id: 'b', source: 'mhlw', category: '医療・介護・福祉' },
    { id: 'c', source: 'jesra', category: '医療・介護・福祉' },
  ];
  assert.strictEqual(isIndexableCategory(agents, '農業'), false);
  assert.strictEqual(isIndexableCategory(agents, '医療・介護・福祉'), true);
  assert.strictEqual(isIndexableCategory(agents, '存在しない'), false);
});

test('noindex は文字コード指定の直後に1つだけ入る', () => {
  const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>x</title></head><body></body></html>';
  const once = withRobotsNoindex(html);
  assert.ok(once.includes(`<meta charset="UTF-8">\n${ROBOTS_NOINDEX}`));
  // 何度通しても増えない（日々の再生成で積み上がらない）。
  assert.strictEqual(withRobotsNoindex(once), once);
  assert.strictEqual((withRobotsNoindex(once).match(/name="robots"/g) || []).length, 1);
});

test('サイトマップに厚労省データのエージェントと、その一覧だけのカテゴリーを載せない', () => {
  const agents = [
    { id: 'm1', source: 'mhlw', category: '農業' },
    { id: 'm2', source: 'mhlw', category: 'IT・Web' },
    { id: 'j1', source: 'jesra', category: 'IT・Web' },
    { id: 'a1', source: 'a8', category: '全職種対応' },
  ];
  const categories = [
    { name: '農業', slug: 'agriculture' },
    { name: 'IT・Web', slug: 'it-web' },
    { name: '全職種対応', slug: 'all-jobs' },
  ];
  const locs = buildEntries(agents, categories).map(e => e.loc);

  assert.ok(!locs.some(l => l.endsWith('/agent/m1/')), '厚労省データのエージェントが載っている');
  assert.ok(!locs.some(l => l.endsWith('/agent/m2/')), '厚労省データのエージェントが載っている');
  assert.ok(locs.some(l => l.endsWith('/agent/j1/')), '独自データのエージェントが載っていない');
  assert.ok(locs.some(l => l.endsWith('/agent/a1/')), '提携エージェントが載っていない');

  assert.ok(!locs.some(l => l.endsWith('/category/agriculture/')), '厚労省データだけのカテゴリーが載っている');
  assert.ok(locs.some(l => l.endsWith('/category/it-web/')));
  assert.ok(locs.some(l => l.endsWith('/category/all-jobs/')));
});

test('静的ページの生成で、検索対象外のエージェントに noindex を入れている', () => {
  const src = fs.readFileSync(path.join(SCRAPER, 'prerender.js'), 'utf8');
  assert.match(src, /isIndexableAgent\(agent\)/, 'prerender.js が線引きを使っていない');
  assert.match(src, /withRobotsNoindex\(/, 'prerender.js が noindex を入れていない');
});

test('カテゴリーページの生成で、同じ線引きを使っている', () => {
  const src = fs.readFileSync(path.join(SCRAPER, 'generate-category-pages.js'), 'utf8');
  assert.match(src, /isIndexableCategory\(agents, c\.name\)/, 'カテゴリーページが線引きを使っていない');
  assert.match(src, /ROBOTS_NOINDEX/, 'カテゴリーページに noindex を入れる箇所が無い');
});

test('実データで、検索対象のページが厚労省データの転載だけになっていない', () => {
  const root = path.join(SCRAPER, '..');
  const agents = JSON.parse(fs.readFileSync(path.join(root, 'agents.json'), 'utf8'));
  const categories = JSON.parse(fs.readFileSync(path.join(root, 'categories.json'), 'utf8'));
  const locs = buildEntries(agents, categories).map(e => e.loc);
  const mhlwIds = new Set(agents.filter(a => a.source === 'mhlw').map(a => String(a.id)));
  const leaked = locs.filter(l => {
    const m = l.match(/\/agent\/([^/]+)\/$/);
    return m && mhlwIds.has(decodeURIComponent(m[1]));
  });
  assert.deepStrictEqual(leaked, [], `サイトマップに厚労省データのページが ${leaked.length} 件載っている`);
});
