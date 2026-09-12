'use strict';

/**
 * agents.json の各求職者向け詳細ページを、Puppeteerで index.html?ssg=1#/agent/{id} を
 * レンダリングして agent/{id}/index.html として静的出力する（企業モードは対象外）。
 *
 * - data/ssg-manifest.json に { [agentId]: 生成時点のエージェントデータのハッシュ } を保存し、
 *   前回生成時からデータが変化していないエージェントは再生成をスキップする
 *   （structure.js の _rawHash 差分検知と同じ「ハッシュ比較で再生成要否を判定する」設計を踏襲）。
 * - 出力ファイルが明らかに大きい場合（一覧・フィルターのDOMが誤って混入した場合など）は
 *   処理を停止しエラーとして原因を報告する。
 * - agents.json から削除されたエージェントの静的ページ・マニフェストエントリは掃除する。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isIndexableAgent, withRobotsNoindex } = require('./lib/indexing');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const AGENTS_PATH = path.join(ROOT, 'agents.json');
const MANIFEST_PATH = path.join(ROOT, 'data', 'ssg-manifest.json');
const OUT_DIR = path.join(ROOT, 'agent');

const PORT = 8935;
const SIZE_TARGET_BYTES = 60 * 1024; // 目安60KB
const SIZE_ERROR_THRESHOLD_BYTES = 200 * 1024; // これを超えたら明らかに異常としてエラー停止

const MIME = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  // 記録ファイルの書き込みも、Windowsで一時的に失敗することがある
  // （3400件目で落ちた）。ページ本体と同じ再試行を通す。
  writeFileWithRetry(path.dirname(filePath), filePath, JSON.stringify(data, null, 2) + '\n');
}

/** エージェントの構造化データ全体をハッシュ化する（表示内容が変わればハッシュも変わる）。 */
function computeAgentHash(agent) {
  return crypto.createHash('sha256').update(JSON.stringify(agent)).digest('hex');
}

/**
 * ファイル書き込みを数回まで再試行する。
 *
 * Windows では、ウイルス対策ソフトや検索インデックスが直前に作ったファイルを
 * 掴んでいて、書き込みが一時的に EBUSY / UNKNOWN で落ちることがある
 * （並列で3500件書いたときに実際に発生した）。1件の失敗で全体を止めたくないので、
 * 少し待って数回やり直す。
 */
function writeFileWithRetry(dirPath, filePath, data, attempts = 8) {
  for (let i = 1; ; i += 1) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(filePath, data, 'utf8');
      return;
    } catch (err) {
      const transient = err.code === 'EBUSY' || err.code === 'UNKNOWN' || err.code === 'EPERM' || err.code === 'ENOENT';
      if (!transient || i >= attempts) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * i);
    }
  }
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(ROOT, urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

// テスト用: 設定すると先頭 N 件のみ処理する（CI上での小規模動作確認向け）。未設定なら全件処理する。
const LIMIT = process.env.PRERENDER_LIMIT ? parseInt(process.env.PRERENDER_LIMIT, 10) : null;

// 同時に開くページ数。1件ずつだと3500件超の作り直しに5時間以上かかるため、
// 既定で4ページを並行して処理する（PRERENDER_CONCURRENCY で変更できる）。
const CONCURRENCY = Math.max(1, parseInt(process.env.PRERENDER_CONCURRENCY || "4", 10));

/**
 * 静的化のあいだ読み込ませないホスト。
 * 広告配信スクリプトを実行させると、AdSense 自身が ins や iframe をページに差し込み、
 * それが保存されたHTMLに残り続ける。アクセス解析も静的化中に動かす必要がない。
 */
const BLOCKED_HOST_PATTERN = /googlesyndication\.com|doubleclick\.net|googleadservices\.com|googletagmanager\.com|google\.com\/recaptcha/;

async function blockAdRequests(page) {
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (BLOCKED_HOST_PATTERN.test(req.url())) req.abort().catch(() => {});
    else req.continue().catch(() => {});
  });
}

/**
 * index.html（＝ページの見た目そのもの）のハッシュ。
 *
 * これまで、生成をとばすかどうかはエージェントのデータだけで決めていた。
 * そのため index.html のデザインを変えても「変更なし」と判断され、静的ページが
 * 古い見た目のまま残ってしまう。テンプレートが変わったときは全ページを作り直す。
 */
const TEMPLATE_KEY = '__template';

function computeTemplateHash() {
  return crypto.createHash('sha1')
    .update(fs.readFileSync(path.join(ROOT, 'index.html')))
    .digest('hex');
}

async function main() {
  const agents = readJson(AGENTS_PATH, []);
  if (agents.length === 0) {
    console.log(`No agents found at ${AGENTS_PATH} — skipping prerender.`);
    return;
  }

  const manifest = readJson(MANIFEST_PATH, {});
  const templateHash = computeTemplateHash();
  const templateChanged = manifest[TEMPLATE_KEY] !== templateHash;
  if (templateChanged) {
    console.log("index.html が変わっているため、全ページを作り直します。");
    // 全件を対象にするときだけ、記録を先に更新する。
    // こうしておくと、途中で落ちても「済んだ分」が残り、次の実行は続きから始まる。
    if (!LIMIT) {
      for (const id of Object.keys(manifest)) { if (id !== TEMPLATE_KEY) delete manifest[id]; }
      manifest[TEMPLATE_KEY] = templateHash;
      writeJson(MANIFEST_PATH, manifest);
    }
  }
  const currentIds = new Set(agents.map(a => String(a.id)));

  // agents.json から削除された（廃業等で消えた）エージェントの静的ページを掃除する。
  let pruned = 0;
  for (const id of Object.keys(manifest)) {
    if (id === TEMPLATE_KEY) continue;
    if (!currentIds.has(id)) {
      const dir = path.join(OUT_DIR, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      delete manifest[id];
      pruned += 1;
    }
  }

  const puppeteer = require('puppeteer');
  const server = await startStaticServer();

  let browser;
  try {
    // GitHub Actionsのrunnerはrootで実行されるため、Chromeのデフォルトサンドボックスは
    // 権限不足で起動直後にネイティブクラッシュする。--no-sandbox 系フラグで回避する。
    // --disable-dev-shm-usage は /dev/shm の容量不足によるクラッシュ対策。
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err) {
    await new Promise(resolve => server.close(resolve));
    throw new Error(`puppeteer.launch() failed (browser could not start): ${err.message}`);
  }

  let generated = 0;
  let skipped = 0;

  const targets = LIMIT ? agents.slice(0, LIMIT) : agents;
  if (LIMIT) console.log(`PRERENDER_LIMIT=${LIMIT} set — processing only the first ${targets.length} agent(s).`);

  let nextIndex = 0;
  /** 共有のカウンタから1件ずつ取り出して処理する。JSは1スレッドなので、
      manifest や集計値への書き込みが競合することはない。 */
  async function worker() {
    for (;;) {
      const agent = targets[nextIndex];
      nextIndex += 1;
      if (!agent) return;

      const id = String(agent.id);
      const hash = computeAgentHash(agent);
      if (manifest[id] === hash) {
        skipped += 1;
        continue;
      }

      const page = await browser.newPage();
      await blockAdRequests(page);
      try {
        const url = `http://localhost:${PORT}/index.html?ssg=1#/agent/${encodeURIComponent(id)}`;
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.waitForSelector('#detailView.show', { timeout: 10000 });
        const rendered = (await page.content()).replace(
          /<meta http-equiv="origin-trial" content="[^"]*">/g,
          ''
        );
        // 厚労省データの転載ページは検索対象から外す（lib/indexing.js）。
        // サイトには残すので利用者は見られるが、Google には評価対象として送らない。
        const html = isIndexableAgent(agent) ? rendered : withRobotsNoindex(rendered);

        const sizeBytes = Buffer.byteLength(html, 'utf8');
        if (sizeBytes > SIZE_ERROR_THRESHOLD_BYTES) {
          throw new Error(
            `Prerendered page for agent "${id}" is ${(sizeBytes / 1024).toFixed(1)}KB, ` +
              `far larger than the ~${SIZE_TARGET_BYTES / 1024}KB target ` +
              `(error threshold ${(SIZE_ERROR_THRESHOLD_BYTES / 1024).toFixed(0)}KB). ` +
              `This likely means list/filter markup leaked into the SSG output again (the ~730KB bug) — ` +
              `investigate ?ssg=1 handling in index.html before continuing.`
          );
        }

        const outDir = path.join(OUT_DIR, id);
        writeFileWithRetry(outDir, path.join(outDir, 'index.html'), html);

        manifest[id] = hash;
        generated += 1;
        // 100件ごとに記録を保存する（途中で落ちたときの取り戻しを小さくする）。
        if (generated % 100 === 0) writeJson(MANIFEST_PATH, manifest);
        console.log(`[prerender] ${id}: ${(sizeBytes / 1024).toFixed(1)}KB -> agent/${id}/index.html`);
      } finally {
        await page.close();
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  // 一部だけを処理した回（PRERENDER_LIMIT）では記録しない。
  // ここで記録してしまうと、次の実行で「テンプレートは処理済み」と判断され、
  // 残りのページが古い見た目のまま二度と作り直されなくなる。
  if (!LIMIT) manifest[TEMPLATE_KEY] = templateHash;
  writeJson(MANIFEST_PATH, manifest);
  console.log(
    `Prerender finished: generated=${generated}, skipped(unchanged)=${skipped}, pruned=${pruned}, ` +
      `processed=${targets.length}, totalAgents=${agents.length}`
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { computeAgentHash };
