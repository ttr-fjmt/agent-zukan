'use strict';

/**
 * 公開中の agent-zukan.net が、リポジトリの状態どおりになっているかを確かめる。
 * 変更を main にマージして GitHub Pages の反映が終わったあとに実行する。
 *
 * 確かめること
 *   - サイトマップに、検索対象外（厚労省データ）のページが混ざっていない
 *   - 検索対象外のページには noindex、独自データのページには無い
 *   - 検索対象外・検索対象のカテゴリーページが、それぞれ正しい
 *   - 解説記事が開け、AdSense のタグがある
 *   - 固定ページに AdSense のタグと、解説記事へのリンクがある
 *
 * 確認対象は毎回 agents.json と lib/indexing.js から選ぶので、掲載が増えてもそのまま使える。
 * 反映直後は古いキャッシュが返ることがあるので、失敗したら数分おいて再実行する。
 *
 * 実行: cd scraper && npm run verify-live   （問題があれば終了コード1）
 */

const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = 'https://agent-zukan.net';
const agents = require(path.join(ROOT, 'agents.json'));
const categories = require(path.join(ROOT, 'categories.json'));
const { isIndexableAgent, isIndexableCategory } = require('./lib/indexing');
const { GUIDES } = require('./generate-guide-pages');

function get(url) {
  const sep = url.includes('?') ? '&' : '?';
  return new Promise((resolve, reject) => {
    https.get(`${url}${sep}nocache=${Date.now()}`, { headers: { 'user-agent': 'zukan-verify-live' } }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  let ok = true;
  const check = (label, cond, detail = '') => {
    console.log(`${cond ? '✔' : '✖'} ${label}${detail ? `  ${detail}` : ''}`);
    if (!cond) ok = false;
  };
  const NOINDEX = /<meta name="robots" content="noindex,follow">/;

  const excluded = agents.filter(a => !isIndexableAgent(a));
  const indexable = agents.filter(a => isIndexableAgent(a));

  const sitemap = await get(`${BASE}/sitemap.xml`);
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const excludedUrls = new Set(excluded.map(a => `${BASE}/agent/${encodeURIComponent(a.id)}/`));
  const leaked = locs.filter(l => excludedUrls.has(l));
  check('サイトマップに検索対象外のページが無い', sitemap.status === 200 && leaked.length === 0, `${locs.length} URL / 混入 ${leaked.length}`);
  check('サイトマップに解説記事がある', GUIDES.every(g => locs.includes(`${BASE}/guide/${g.slug}/`)));

  if (excluded.length) {
    const r = await get(`${BASE}/agent/${encodeURIComponent(excluded[0].id)}/`);
    check('検索対象外のページに noindex', r.status === 200 && NOINDEX.test(r.body), `/agent/${excluded[0].id}/`);
  }
  if (indexable.length) {
    const r = await get(`${BASE}/agent/${encodeURIComponent(indexable[0].id)}/`);
    check('検索対象のページに noindex が無い', r.status === 200 && !/name="robots"/.test(r.body), `/agent/${indexable[0].id}/`);
  }

  const withAgents = categories.filter(c => c.slug && agents.some(a => a.category === c.name));
  const catOut = withAgents.find(c => !isIndexableCategory(agents, c.name));
  const catIn = withAgents.find(c => isIndexableCategory(agents, c.name));
  if (catOut) {
    const r = await get(`${BASE}/category/${catOut.slug}/`);
    check(`検索対象外のカテゴリーに noindex（${catOut.name}）`, r.status === 200 && /name="robots"/.test(r.body));
  }
  if (catIn) {
    const r = await get(`${BASE}/category/${catIn.slug}/`);
    check(`検索対象のカテゴリーに noindex が無い（${catIn.name}）`, r.status === 200 && !/name="robots"/.test(r.body));
  }

  for (const p of ['/guide/'].concat(GUIDES.map(g => `/guide/${g.slug}/`))) {
    const r = await get(BASE + p);
    check(`記事 ${p}`, r.status === 200 && r.body.includes('adsbygoogle.js') && !/name="robots"/.test(r.body), String(r.status));
  }
  for (const p of ['/', '/faq.html', '/privacy.html']) {
    const r = await get(BASE + p);
    check(`${p} に AdSense のタグと記事へのリンク`, r.status === 200 && r.body.includes('adsbygoogle.js') && r.body.includes('href="/guide/"'), String(r.status));
  }

  console.log(ok ? 'ALL OK' : 'NG あり（反映直後なら数分おいて再実行）');
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error(`確認できませんでした: ${err.message}`);
  process.exit(1);
});
