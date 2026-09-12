'use strict';

/**
 * 解説記事（/guide/ 以下）を書き出す。
 *
 * 【なぜ作ったか】
 * AdSense で「有用性の低いコンテンツ」と判定された。サイトの98%が厚労省データの転載で、
 * 独自に書いた解説が1本も無かった。転載ページは検索対象から外したので（lib/indexing.js）、
 * Google に評価してもらう中心として、求職者・採用企業が実際に迷う点を解説する記事を置く。
 *
 * 【書き方の約束】
 * 制度・金額・日付など事実に当たる記述は、すべて厚生労働省・労働局・認定制度の公式ページで
 * 確認できたものだけにし、記事末尾に出典を必ず載せる（このリポジトリの
 * 「確認できないことは書かない」原則を記事にも適用する）。
 * 公式ページで数字を確認できなかったもの（上限制手数料の料率など）は書かない。
 * 掲載データの件数や地域分布も載せない。日次の収集が進むにつれて偏りが変わり、
 * 実態を表さないため。
 *
 * 実行: cd scraper && node generate-guide-pages.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GUIDE_DIR = path.join(ROOT, 'guide');
const BASE_URL = 'https://agent-zukan.net';
const SITE_NAME = '転職エージェント図鑑';
const PUBLISHED = '2026-09-12';
const ADSENSE = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5761092657360295" crossorigin="anonymous"></script>';

/** 出典。記事本文で参照する番号と揃える。 */
const SOURCES = {
  mhlwShoukai: {
    label: '厚生労働省「職業紹介事業」',
    url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyou/haken-shoukai/shoukainitsuite.html',
  },
  ishikawa: {
    label: '石川労働局「職業紹介事業とは」',
    url: 'https://jsite.mhlw.go.jp/ishikawa-roudoukyoku/hourei_seido_tetsuzuki/roudousha_haken/syoukai_gaiyou.html',
  },
  r0604: {
    label: '厚生労働省「職業安定法施行規則改正（令和6年4月）｜手数料表等掲示」',
    url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyou/haken-shoukai/r0604anteisokukaisei2.html',
  },
  jinzai: {
    label: '厚生労働省「人材サービス総合サイト」',
    url: 'https://jinzai.hellowork.mhlw.go.jp/JinzaiWeb/',
  },
  jesra: {
    label: '職業紹介優良事業者認定制度（厚生労働省委託事業）',
    url: 'https://www.jesra.or.jp/yuryoshokai/',
  },
  tokyo: {
    label: '東京労働局「有料・無料職業紹介関係」',
    url: 'https://jsite.mhlw.go.jp/tokyo-roudoukyoku/hourei_seido_tetsuzuki/yuryou_muryou_shokugyou.html',
  },
};

/** 記事本体。body は <h2> から始まる本文HTML。 */
const GUIDES = [
  {
    slug: 'check-before-choosing',
    title: '転職エージェントを選ぶ前に確認したい3つのこと',
    description: '転職エージェント（有料職業紹介事業者）を選ぶ前に、公的な情報で確認できる3つのポイント（厚生労働大臣の許可・手数料表と返戻金制度・優良事業者認定）を、厚生労働省の公開情報をもとに解説します。',
    sources: ['ishikawa', 'mhlwShoukai', 'jinzai', 'r0604', 'jesra'],
    body: `
<p class="lead">転職エージェントは数が多く、広告や評判だけで選ぶと判断が難しくなります。サービスの相性を比べる前に、まず<strong>公的な情報で確認できること</strong>を押さえておくと、選択肢を安心して絞り込めます。この記事では、その代表的な3つを紹介します。</p>

<h2>1. 厚生労働大臣の許可を受けているか</h2>
<p>転職エージェントが行っている「職業紹介」は、法律で次のように定義されています。</p>
<blockquote>求人及び求職の申し込みを受け、求人者と求職者との間における雇用関係の成立をあっせんすること（職業安定法第4条第1項）</blockquote>
<p>このうち、手数料や報酬を受け取って行うものを<strong>有料職業紹介事業</strong>といい、事業を行うには<strong>厚生労働大臣の許可</strong>が必要です。転職エージェントの多くは、企業から紹介手数料を受け取るこの形で運営されています。</p>
<p>許可を受けた事業所は、厚生労働省の<strong>「人材サービス総合サイト」</strong>で検索できます。聞き慣れない会社から連絡があったときや、はじめて利用するエージェントを選ぶときは、会社名で検索して許可を受けているかを確かめておくと安心です。</p>

<h3>有料職業紹介で扱えない仕事がある</h3>
<p>有料職業紹介事業では、<strong>港湾運送業務</strong>と<strong>建設業務</strong>（土木・建築などの作業）の職業紹介は認められていません。これらの分野で仕事を探す場合は、紹介を受けられる職種かどうかを、事前に各社へ確認してください。</p>

<h2>2. 手数料表と返戻金制度を確認できるか</h2>
<p>有料職業紹介事業者は、<strong>手数料表</strong>と<strong>返戻金制度に関する事項</strong>を明らかにすることが求められています。以前は事業所内への掲示が必要でしたが、<strong>令和6年4月1日</strong>からは、自社のホームページなど適切な方法で情報を提供できるようになりました。</p>
<p>そのため、公式サイトで手数料表や返戻金制度を公開しているエージェントもあります。</p>
<ul>
  <li><strong>求職者の方</strong>：一般的な転職で、求職者が手数料を支払う場面は法律で限られています。詳しくは<a href="/guide/fee-rules/">人材紹介の手数料のしくみ</a>で解説しています。</li>
  <li><strong>採用企業の方</strong>：手数料の料率だけでなく、採用した人が早期に退職した場合の返戻金の条件もあわせて比べると、実際の負担を見積もりやすくなります。</li>
</ul>

<h2>3. 優良事業者の認定を受けているか</h2>
<p><strong>職業紹介優良事業者認定制度</strong>は、厚生労働省の委託事業として、一般社団法人日本人材紹介事業協会が運営している制度です。制度の目的は、次のように説明されています。</p>
<blockquote>法令遵守及び採用・定着/マッチングについて一定の基準を満たした事業者を認定することにより、求職者が安心・安全な事業者を選択し、求人者が取引先選定の基準とすることによって、職業紹介事業の健全な競争と求人者と求職者の適切なマッチングの促進を目的としています</blockquote>
<p>認定を受けていることは、事業者を選ぶときのひとつの目安になります。一方で、認定は申請して審査を受けるものなので、<strong>認定を受けていないことが、ただちに問題があることを意味するわけではありません</strong>。許可の有無や手数料表とあわせて、判断材料のひとつとして使うのがよいでしょう。</p>

<h2>このサイトでの確認のしかた</h2>
<p>転職エージェント図鑑では、各エージェントのページの末尾に、掲載情報の<strong>出典</strong>（厚生労働省の公開データ、優良事業者認定制度の掲載情報など）を表示しています。公開情報から確認できなかった項目は、推測で埋めずに「非公開（お問い合わせで確認）」と表示しています。</p>
<p>気になるエージェントが見つかったら、出典のページや公式サイトで最新の情報をあわせて確認してください。</p>
`,
  },
  {
    slug: 'fee-rules',
    title: '人材紹介の手数料のしくみ ― 求職者は本当に無料？',
    description: '転職エージェント（有料職業紹介事業者）が受け取れる手数料は、法律で種類が限られています。求職者が手数料を支払うのはどんな場合か、企業が支払う手数料にはどんな種類があるかを、労働局の公開情報をもとに解説します。',
    sources: ['ishikawa', 'r0604', 'tokyo', 'mhlwShoukai'],
    body: `
<p class="lead">「転職エージェントは無料で使える」とよく言われます。これは各社のサービス方針というより、<strong>法律で手数料のルールが決まっている</strong>ことが背景にあります。この記事では、そのしくみを整理します。</p>

<h2>受け取れる手数料は4種類だけ</h2>
<p>有料職業紹介事業者が受け取ることのできる手数料は、職業安定法にもとづき、次の<strong>4種類に限られています</strong>。これ以外の名目で手数料を受け取ることはできません。</p>
<ol>
  <li><strong>求人受付手数料</strong>：企業から求人の申し込みを受けたときの手数料</li>
  <li><strong>上限制手数料・届出制手数料</strong>：紹介について企業などから受け取る手数料</li>
  <li><strong>求職者手数料</strong>：一部の職業に限り、求職者から受け取れる手数料</li>
  <li><strong>求職受付手数料（経過措置）</strong>：一部の職業に限り、求職の申し込みを受けたときの手数料</li>
</ol>

<h2>求職者が手数料を支払うのは、限られた場合だけ</h2>
<p>求職者から手数料を受け取れるのは、法令で決められた職業に限られます。</p>

<h3>求職者手数料を受け取れる職業</h3>
<ul>
  <li>芸能家</li>
  <li>モデル</li>
  <li>経営管理者、科学技術者、熟練技能者（紹介で就職した仕事の年収が<strong>700万円</strong>またはこれに相当する額を超える場合に限る）</li>
</ul>

<h3>求職受付手数料（経過措置）を受け取れる職業</h3>
<p>芸能家、家政婦（夫）、配ぜん人、調理士、モデル、マネキンの職業について求職の申し込みを受けたときは、当分の間、<strong>1件につき710円</strong>（免税事業者は660円）を限度として受け取ることができます。</p>

<p>裏を返すと、<strong>これらの職業・条件に当てはまらない一般的な転職では、求職者から手数料を受け取ることは認められていません</strong>。「登録料」「サポート料」などの名目で費用を求められた場合は、その内容と根拠を確認し、必要に応じて各都道府県の労働局に相談してください。</p>

<h2>企業が支払う手数料の種類</h2>

<h3>求人受付手数料</h3>
<p>求人の申し込み<strong>1件につき710円</strong>（免税事業者は660円）が上限です。</p>

<h3>上限制手数料と届出制手数料</h3>
<p>紹介にかかる手数料には、法令で上限が決められている<strong>上限制手数料</strong>と、事業者が手数料表を<strong>厚生労働大臣に届け出て</strong>、その内容にもとづいて受け取る<strong>届出制手数料</strong>があります。</p>
<p>ひとつの事業者が、取り扱う分野によって上限制手数料と届出制手数料を使い分けることはできますが、<strong>同じ相手から両方をあわせて受け取ることはできません</strong>。</p>
<p>転職エージェントの紹介手数料の料率は、この届出制手数料として各社が定めています。実際の料率は事業者ごとに異なるため、契約前に手数料表で確認してください。</p>

<h2>手数料表はどこで見られる？</h2>
<p>有料職業紹介事業者には、<strong>手数料表</strong>と<strong>返戻金制度に関する事項</strong>を明らかにすることが求められています。<strong>令和6年4月1日</strong>からは、事業所内への掲示に代えて、自社のホームページなど適切な方法で情報提供できるようになりました。</p>
<p>このため、公式サイトで手数料表を公開している事業者もあります。見当たらない場合は、問い合わせて確認するとよいでしょう。</p>

<h2>まとめ</h2>
<ul>
  <li>転職エージェントが受け取れる手数料は、法律で4種類に限られている</li>
  <li>求職者から手数料を受け取れるのは、芸能家・モデルなど一部の職業と、年収700万円超の経営管理者・科学技術者・熟練技能者に限られる</li>
  <li>企業が支払う紹介手数料の料率は、事業者が届け出た手数料表で確認できる</li>
</ul>
<p>エージェントの選び方全般は、<a href="/guide/check-before-choosing/">転職エージェントを選ぶ前に確認したい3つのこと</a>もあわせてご覧ください。</p>
`,
  },
  {
    slug: 'general-vs-specialized',
    title: '全職種対応型と特化型、どちらの転職エージェントを使うべき？',
    description: '転職エージェントには、幅広い職種を扱う「全職種対応型」と、特定の業界・職種・人材層に絞った「特化型」があります。それぞれの向き不向きと、組み合わせ方の考え方を解説します。',
    sources: ['mhlwShoukai', 'jinzai'],
    body: `
<p class="lead">転職エージェントを探していると、「全職種に対応」とうたう会社と、「医療・介護専門」「IT・Web特化」のように分野を絞った会社があることに気づきます。どちらが良いというより、<strong>転職の状況によって向き不向きがある</strong>と考えると選びやすくなります。</p>

<h2>全職種対応型と特化型の違い</h2>

<h3>全職種対応型</h3>
<p>業界や職種を限定せず、幅広い求人を扱うタイプです。地域に根ざして、その地域の企業の求人をまとめて扱っている事業者も少なくありません。</p>
<ul>
  <li><strong>向いている人</strong>：まだ職種を決めきれていない人、異業種への転職も視野に入れている人、住んでいる地域で仕事を探したい人</li>
  <li><strong>注意したい点</strong>：専門的な職種の場合、担当者がその分野にどれだけ詳しいかは事業者によって差があります</li>
</ul>

<h3>特化型</h3>
<p>特定の業界・職種、または「第二新卒」「外国人材」のように特定の人材層に絞って紹介するタイプです。</p>
<ul>
  <li><strong>向いている人</strong>：経験を活かして同じ分野で転職したい人、資格や専門知識が求められる仕事を探している人</li>
  <li><strong>注意したい点</strong>：扱う求人がその分野に限られるため、方向性を広げたい場合は選択肢が狭くなります</li>
</ul>

<h2>どう選べばいい？</h2>
<p>迷ったときは、次の2つの問いから考えると整理しやすくなります。</p>

<h3>① 次の仕事の方向性は決まっているか</h3>
<p>職種や業界がはっきり決まっているなら、その分野の<strong>特化型</strong>から探すと、話が早く進みやすくなります。まだ決まっていない、あるいは複数の方向を比べたいなら、<strong>全職種対応型</strong>で幅広く相談するのがよいでしょう。</p>

<h3>② 働く地域にこだわりがあるか</h3>
<p>地元で働きたい、UIターンをしたいなど、地域の条件が優先なら、<strong>その地域に拠点を持つエージェント</strong>を探すのがおすすめです。全職種対応型であっても、地域の求人に強い事業者があります。</p>

<h3>組み合わせて使うのも一つの方法</h3>
<p>特化型と全職種対応型を<strong>1社ずつ組み合わせる</strong>と、専門分野の求人と幅広い選択肢の両方を見比べられます。登録する社数が増えるほど連絡や日程の管理は大変になるので、自分が無理なくやり取りできる範囲で選びましょう。</p>

<h2>このサイトの分類について</h2>
<p>転職エージェント図鑑では、エージェントを次のように分けて掲載しています。</p>
<ul>
  <li><strong>特化カテゴリー</strong>：IT・Web、医療・介護・福祉、外国人・特定技能、施工管理・建設、農業 など、特定の分野に強みがあることを確認できたもの</li>
  <li><strong>全職種対応</strong>：特定の分野に絞らず、幅広い職種を扱うことを確認できたもの</li>
  <li><strong>その他</strong>：公開情報から、特化の有無まで確認できなかったもの</li>
</ul>
<p>トップページの「職種から探す」には特化カテゴリーを並べています。全職種対応のエージェントは、一覧や「特化職種」の絞り込みから探せます。</p>

<h2>どちらを選ぶ場合も確認したいこと</h2>
<p>全職種対応型・特化型のどちらでも、転職エージェントとして職業紹介を行うには厚生労働大臣の許可が必要です。許可の確認方法や手数料表のチェックポイントは、<a href="/guide/check-before-choosing/">転職エージェントを選ぶ前に確認したい3つのこと</a>で解説しています。</p>
`,
  },
];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * faq.html から、アクセス解析（運営者の除外スイッチ＋gtag）のまとまりをそのまま借りる。
 * 書き写すと、測定IDや除外の仕組みを直したときに記事だけ古いまま残るため。
 */
function readAnalyticsBlock() {
  const faq = fs.readFileSync(path.join(ROOT, 'faq.html'), 'utf8');
  const start = faq.indexOf('<!-- 運営者自身のアクセスを計測しないためのスイッチ。');
  const configAt = faq.indexOf("gtag('config', 'G-WBGS0QRR5M');");
  const end = configAt < 0 ? -1 : faq.indexOf('</script>', configAt);
  if (start < 0 || configAt < 0 || end < 0) {
    throw new Error('faq.html からアクセス解析のタグを取り出せませんでした');
  }
  return faq.slice(start, end + '</script>'.length);
}

const STYLE = `<style>
  :root{
    --ink:#17211D; --paper:#F8F5EE; --surface:#FFFFFF; --line:#E4DFD1;
    --accent:#1F6F63; --accent-deep:#123F38; --accent-soft:#DCEAE7;
    --gold:#B8863B; --gold-soft:#F1E4CC; --ink-soft:#5B6660; --ink-faint:#8B9490;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--paper);color:var(--ink);
    font-family:'Zen Kaku Gothic New', sans-serif;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:720px;margin:0 auto;padding:56px 16px 100px;}
  .back-btn{background:var(--surface);border:1px solid var(--line);border-radius:999px;
    color:var(--ink-soft);font-size:13px;font-weight:500;padding:9px 16px 9px 12px;margin-bottom:28px;
    display:inline-flex;align-items:center;gap:6px;text-decoration:none;transition:border-color .12s,color .12s;}
  .back-btn:hover{border-color:var(--accent);color:var(--ink);}
  .back-btn svg{width:16px;height:16px;flex-shrink:0;}
  .crumbs{font-size:12.5px;color:var(--ink-faint);margin:0 0 10px;}
  .crumbs a{color:var(--ink-faint);text-decoration:none;}
  .crumbs a:hover{color:var(--accent);text-decoration:underline;}
  h1{font-family:'Shippori Mincho', serif;font-weight:600;font-size:clamp(24px,3.6vw,31px);
    line-height:1.45;margin:0 0 10px;letter-spacing:.01em;}
  .meta{font-size:12.5px;color:var(--ink-faint);margin:0 0 32px;}
  h2{font-size:18px;font-weight:700;color:var(--ink);margin:40px 0 14px;
    padding-left:12px;border-left:3px solid var(--gold);line-height:1.5;}
  h3{font-size:15.5px;font-weight:700;color:var(--ink);margin:26px 0 8px;line-height:1.6;}
  p,li{font-size:15px;line-height:1.95;color:var(--ink-soft);}
  p{margin:0 0 14px;}
  p.lead{color:var(--ink);font-size:15.5px;}
  strong{color:var(--ink);}
  ul,ol{margin:0 0 16px;padding-left:1.4em;}
  li{margin:0 0 6px;}
  a{color:var(--accent);}
  blockquote{margin:0 0 16px;padding:14px 18px;background:var(--surface);border:1px solid var(--line);
    border-left:3px solid var(--accent);border-radius:8px;font-size:14.5px;line-height:1.9;color:var(--ink);}
  .sources{margin-top:48px;padding:18px 20px;background:var(--surface);border:1px solid var(--line);border-radius:12px;}
  .sources h2{margin:0 0 10px;font-size:15px;border-left:none;padding-left:0;}
  .sources li{font-size:13px;line-height:1.8;}
  .sources .note{font-size:12.5px;color:var(--ink-faint);margin:10px 0 0;}
  .guide-list{list-style:none;padding:0;margin:0;display:grid;gap:12px;}
  .guide-list a{display:block;padding:18px 20px;background:var(--surface);border:1px solid var(--line);
    border-radius:12px;text-decoration:none;transition:border-color .12s,box-shadow .12s;}
  .guide-list a:hover{border-color:var(--accent);box-shadow:0 4px 16px rgba(23,33,29,.06);}
  .guide-list .t{display:block;font-size:16px;font-weight:700;color:var(--ink);line-height:1.6;margin-bottom:4px;}
  .guide-list .d{display:block;font-size:13.5px;line-height:1.8;color:var(--ink-soft);}
  .related{margin-top:36px;}
  .related h2{font-size:15px;}
  .footer-links{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;}
  .footer-links a{color:var(--accent);text-decoration:none;font-weight:500;}
  .footer-links a:hover{text-decoration:underline;}
</style>`;

const BACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

const FOOTER = `<div class="footer-links"><a href="/">トップページ</a> / <a href="/guide/">転職ガイド</a> / <a href="/faq.html">よくある質問</a> / <a href="/privacy.html">プライバシーポリシー</a></div>`;

function head({ title, description, url, jsonLd, analytics }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${BASE_URL}/ogp-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
${ADSENSE}
${analytics}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@600&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${STYLE}
</head>`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function buildArticle(guide, analytics) {
  const url = `${BASE_URL}/guide/${guide.slug}/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${BASE_URL}/` },
          { '@type': 'ListItem', position: 2, name: '転職ガイド', item: `${BASE_URL}/guide/` },
          { '@type': 'ListItem', position: 3, name: guide.title, item: url },
        ],
      },
      {
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        inLanguage: 'ja',
        datePublished: PUBLISHED,
        dateModified: PUBLISHED,
        mainEntityOfPage: url,
        author: { '@type': 'Organization', name: SITE_NAME, url: `${BASE_URL}/` },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: `${BASE_URL}/` },
      },
    ],
  };

  const sources = guide.sources.map(key => {
    const s = SOURCES[key];
    if (!s) throw new Error(`記事「${guide.slug}」の出典 ${key} が未定義です`);
    return `    <li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.label)}</a></li>`;
  }).join('\n');

  const related = GUIDES.filter(g => g.slug !== guide.slug).map(g =>
    `    <li><a href="/guide/${g.slug}/"><span class="t">${escapeHtml(g.title)}</span><span class="d">${escapeHtml(g.description)}</span></a></li>`
  ).join('\n');

  return `${head({ title: `${guide.title}｜${SITE_NAME}`, description: guide.description, url, jsonLd, analytics })}
<body>
<div class="wrap">
  <a class="back-btn" href="/guide/">${BACK_ICON}転職ガイド一覧へ</a>
  <p class="crumbs"><a href="/">ホーム</a> ／ <a href="/guide/">転職ガイド</a></p>
  <h1>${escapeHtml(guide.title)}</h1>
  <p class="meta">公開日：${formatDate(PUBLISHED)}　／　${SITE_NAME}編集部</p>
${guide.body.trim()}

  <div class="sources">
    <h2>出典・参考にした公式情報</h2>
    <ul>
${sources}
    </ul>
    <p class="note">制度の内容は改正されることがあります。最新の情報は、上記の公式ページや各都道府県の労働局でご確認ください。</p>
  </div>

  <div class="related">
    <h2>あわせて読みたい</h2>
    <ul class="guide-list">
${related}
    </ul>
  </div>

  ${FOOTER}
</div>
</body>
</html>
`;
}

function buildIndex(analytics) {
  const url = `${BASE_URL}/guide/`;
  const title = `転職ガイド｜${SITE_NAME}`;
  const description = '転職エージェントの選び方、手数料のしくみ、全職種対応型と特化型の違いなど、転職エージェントを使う前に知っておきたいことを、厚生労働省などの公式情報をもとに解説します。';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'ホーム', item: `${BASE_URL}/` },
          { '@type': 'ListItem', position: 2, name: '転職ガイド', item: url },
        ],
      },
      {
        '@type': 'CollectionPage',
        name: '転職ガイド',
        url,
        inLanguage: 'ja',
        hasPart: GUIDES.map(g => ({ '@type': 'Article', headline: g.title, url: `${BASE_URL}/guide/${g.slug}/` })),
      },
    ],
  };
  const items = GUIDES.map(g =>
    `    <li><a href="/guide/${g.slug}/"><span class="t">${escapeHtml(g.title)}</span><span class="d">${escapeHtml(g.description)}</span></a></li>`
  ).join('\n');

  return `${head({ title, description, url, jsonLd, analytics })}
<body>
<div class="wrap">
  <a class="back-btn" href="/">${BACK_ICON}トップに戻る</a>
  <p class="crumbs"><a href="/">ホーム</a></p>
  <h1>転職ガイド</h1>
  <p class="meta">転職エージェントを使う前に知っておきたいこと</p>
  <p class="lead">転職エージェントの選び方や手数料のルールなど、利用する前に押さえておきたいポイントを解説しています。制度に関する記述は、厚生労働省・労働局などの公式情報をもとにしています。</p>
  <ul class="guide-list">
${items}
  </ul>
  ${FOOTER}
</div>
</body>
</html>
`;
}

function main() {
  const analytics = readAnalyticsBlock();
  fs.mkdirSync(GUIDE_DIR, { recursive: true });

  const keep = new Set(GUIDES.map(g => g.slug));
  for (const name of fs.readdirSync(GUIDE_DIR)) {
    const target = path.join(GUIDE_DIR, name);
    if (keep.has(name) || !fs.statSync(target).isDirectory()) continue;
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[guide] removed stale page: guide/${name}/`);
  }

  for (const guide of GUIDES) {
    const dir = path.join(GUIDE_DIR, guide.slug);
    fs.mkdirSync(dir, { recursive: true });
    const html = buildArticle(guide, analytics);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    const text = guide.body.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    console.log(`[guide] ${guide.slug}: 本文 ${text.length}字`);
  }
  fs.writeFileSync(path.join(GUIDE_DIR, 'index.html'), buildIndex(analytics), 'utf8');
  console.log(`Generated ${GUIDES.length} guide page(s) + guide/index.html.`);
}

if (require.main === module) main();

module.exports = { GUIDES, SOURCES, buildArticle, buildIndex };
