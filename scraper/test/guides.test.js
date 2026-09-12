'use strict';

/**
 * 解説記事（/guide/）のガード。
 *
 * AdSense で「有用性の低いコンテンツ」と判定されたため、Google に評価してもらう中心として
 * 独自の解説記事を置いた。記事が事実を誤ると、比較サイトとしての信頼を損なうので、
 * 「公式情報で確認できたことだけを書く」約束を機械的に確かめる。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { GUIDES, SOURCES } = require('../generate-guide-pages');
const { buildEntries } = require('../generate-sitemap');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('記事が3本以上あり、すべて書き出されている', () => {
  assert.ok(GUIDES.length >= 3, '記事が少なすぎる');
  assert.ok(fs.existsSync(path.join(ROOT, 'guide', 'index.html')), 'guide/index.html が無い（node generate-guide-pages.js を実行）');
  for (const g of GUIDES) {
    assert.ok(fs.existsSync(path.join(ROOT, 'guide', g.slug, 'index.html')), `guide/${g.slug}/ が書き出されていない`);
  }
});

test('記事ページは検索対象で、AdSense のタグと正しい canonical を持つ', () => {
  const pages = [['guide/index.html', 'https://agent-zukan.net/guide/']]
    .concat(GUIDES.map(g => [`guide/${g.slug}/index.html`, `https://agent-zukan.net/guide/${g.slug}/`]));
  for (const [rel, url] of pages) {
    const html = read(rel);
    assert.ok(html.includes('adsbygoogle.js?client=ca-pub-'), `${rel} に AdSense のタグが無い`);
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), `${rel} の canonical が違う`);
    assert.ok(!/name=["']robots["']/.test(html), `${rel} が検索対象外になっている`);
    assert.ok(html.includes("gtag('config', 'G-WBGS0QRR5M')"), `${rel} にアクセス解析のタグが無い`);
  }
});

test('すべての記事に、公式情報の出典が付いている', () => {
  for (const g of GUIDES) {
    assert.ok(g.sources.length > 0, `${g.slug} に出典が無い`);
    for (const key of g.sources) {
      const s = SOURCES[key];
      assert.ok(s, `${g.slug} の出典 ${key} が未定義`);
      assert.match(s.url, /^https:\/\/([a-z0-9-]+\.)*(mhlw\.go\.jp|jesra\.or\.jp)\//, `${key} が公式のページではない`);
    }
    const html = read(`guide/${g.slug}/index.html`);
    assert.ok(html.includes('出典・参考にした公式情報'), `${g.slug} に出典欄が出ていない`);
  }
});

test('記事に割合（％）の数字を書いていない（公式情報で料率を確認できていないため）', () => {
  for (const g of GUIDES) {
    const text = g.body.replace(/<[^>]+>/g, '');
    assert.ok(!/\d+(\.\d+)?\s*[%％]/.test(text), `${g.slug} に割合の数字がある`);
  }
});

test('記事の本文にある金額・日付は、確認済みのものだけ', () => {
  // 公式情報で確認した数字だけを許す。新しい数字を書くときは、出典を確認してからここに足す。
  const allowed = new Set(['710円', '660円', '700万円', '令和6年4月1日', '第4条第1項']);
  for (const g of GUIDES) {
    const text = g.body.replace(/<[^>]+>/g, '');
    const found = text.match(/\d[\d,]*\s*(円|万円)|令和\d+年\d+月\d+日|第\d+条第\d+項/g) || [];
    for (const v of found) {
      assert.ok(allowed.has(v.replace(/\s/g, '')), `${g.slug} に未確認の数字「${v}」がある`);
    }
  }
});

test('記事どうし・トップからのリンクがつながっている', () => {
  for (const g of GUIDES) {
    const html = read(`guide/${g.slug}/index.html`);
    for (const other of GUIDES.filter(o => o.slug !== g.slug)) {
      assert.ok(html.includes(`/guide/${other.slug}/`), `${g.slug} から ${other.slug} へのリンクが無い`);
    }
  }
  assert.ok(read('index.html').includes('href="/guide/"'), 'トップページから転職ガイドへのリンクが無い');
  assert.ok(read('faq.html').includes('href="/guide/"'), 'よくある質問から転職ガイドへのリンクが無い');
});

test('サイトマップに記事が載っている', () => {
  const agents = JSON.parse(read('agents.json'));
  const categories = JSON.parse(read('categories.json'));
  const locs = buildEntries(agents, categories).map(e => e.loc);
  assert.ok(locs.includes('https://agent-zukan.net/guide/'));
  for (const g of GUIDES) {
    assert.ok(locs.includes(`https://agent-zukan.net/guide/${g.slug}/`), `${g.slug} がサイトマップに無い`);
  }
});

test('AdSense のタグが、主要な固定ページすべてにある', () => {
  for (const rel of ['index.html', 'faq.html', 'privacy.html']) {
    assert.ok(read(rel).includes('adsbygoogle.js?client=ca-pub-'), `${rel} に AdSense のタグが無い`);
  }
});
