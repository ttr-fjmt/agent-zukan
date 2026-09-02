'use strict';

/**
 * data/raw-agents.json（スクレイパーの生データ）を、フロントエンドの AGENTS 配列と
 * 同じスキーマに構造化して agents.json に出力する。
 *
 * - 既存の agents.json と生データのハッシュを比較し、差分がある事業者のみ
 *   Claude Haiku 4.5 (ANTHROPIC_API_KEY) に投げて再構造化する（コスト抑制）。
 * - ANTHROPIC_API_KEY が無い環境（ローカル動作確認など）では、生データから
 *   直接組み立てる非AIフォールバックで動作する（次回 API キーがある実行時に
 *   自動的に再構造化されるよう、そのエントリのハッシュは保存しない）。
 * - 事業者コメント等の本文をそのまま転載せず、事実情報の抽出・要約にとどめる。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CATEGORIES, NOT_DISCLOSED } = require('./lib/schema');

const RAW_PATH = path.join(__dirname, '..', 'data', 'raw-agents.json');
const OUT_PATH = path.join(__dirname, '..', 'agents.json');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function computeRawHash(raw) {
  const relevant = {
    companyName: raw.companyName,
    certificationNumber: raw.certificationNumber,
    certificationPeriod: raw.certificationPeriod,
    permitNumber: raw.permitNumber,
    region: raw.region,
    industries: raw.industries,
    jobTypes: raw.jobTypes,
    serviceName: raw.serviceName,
    serviceUrl: raw.serviceUrl,
    feeDisclosureUrl: raw.feeDisclosureUrl,
    feeVariationNote: raw.feeVariationNote,
    operatorComment: raw.operatorComment,
    feePageExcerpt: raw.feePageExcerpt,
  };
  return crypto.createHash('sha256').update(stableStringify(relevant)).digest('hex');
}

function stripProtocol(url) {
  if (!url) return null;
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/#$/, '');
}

/** serviceUrl のドメインから Google の favicon 取得サービスの URL を組み立てる。 */
function buildFaviconUrl(serviceUrl) {
  if (!serviceUrl) return null;
  let domain;
  try {
    domain = new URL(serviceUrl).hostname;
  } catch {
    return null;
  }
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function formatRegion(regionRaw) {
  if (!regionRaw) return NOT_DISCLOSED;
  const list = regionRaw.split('｜').map(s => s.trim()).filter(Boolean);
  if (list.length >= 47) return '全国47都道府県';
  if (list.length > 8) return `${list.slice(0, 6).join('、')} など${list.length}エリア対応`;
  return list.join('、');
}

function formatPipeList(text) {
  if (!text) return null;
  return text.split('｜').map(s => s.trim()).filter(Boolean).join('、');
}

function todayJst() {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
}

function buildSourceNote(raw) {
  return (
    `厚生労働省委託「職業紹介優良事業者認定制度」掲載情報（${raw.detailUrl}）` +
    `${raw.feeDisclosureUrl ? 'および手数料公表サイト' : ''}をもとに作成。` +
    `取得日: ${todayJst()}。取得できなかった項目は「${NOT_DISCLOSED}」と表示しています。`
  );
}

const REVIEW_NOTE = '口コミデータは未収集です（今後のアップデートで追加予定）。';
const COMPANY_REVIEW_NOTE = '企業からの口コミデータは未収集です（今後のアップデートで追加予定）。';

/** ANTHROPIC_API_KEY が無い場合の非AIフォールバック。事実の範囲を出ない組み立てのみ行う。 */
function buildOffline(raw) {
  const industriesJa = formatPipeList(raw.industries);
  const jobTypesJa = formatPipeList(raw.jobTypes);

  const features = [];
  if (industriesJa) features.push(`対応業界: ${industriesJa}`);
  if (jobTypesJa) features.push(`対応職種: ${jobTypesJa}`);
  if (raw.feeVariationNote) features.push(`手数料設定について: ${raw.feeVariationNote}`);
  while (features.length < 1) features.push(NOT_DISCLOSED);

  return {
    category: guessCategoryOffline(raw),
    targetAge: NOT_DISCLOSED,
    jobCount: NOT_DISCLOSED,
    feeRate: NOT_DISCLOSED,
    talentRange: NOT_DISCLOSED,
    oneLiner: raw.serviceName ? `${raw.serviceName}が提供する人材紹介サービス。` : NOT_DISCLOSED,
    companyOneLiner: raw.serviceName ? `${raw.serviceName}による採用支援。` : NOT_DISCLOSED,
    appeal: [industriesJa && `対応業界: ${industriesJa}`, jobTypesJa && `対応職種: ${jobTypesJa}`]
      .filter(Boolean)
      .join('。') || NOT_DISCLOSED,
    features,
    feeExplanation: raw.feeVariationNote || NOT_DISCLOSED,
    commitmentExplanation: NOT_DISCLOSED,
    companyDetail: {
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
    },
  };
}

function guessCategoryOffline(raw) {
  const hay = `${raw.industries || ''} ${raw.jobTypes || ''} ${raw.serviceName || ''}`;
  if (/IT|Web|エンジニア|システム/i.test(hay)) return 'IT・Web';
  if (/建設|施工|不動産/.test(hay)) return '施工管理・建設';
  if (/営業|マーケ|販売/.test(hay)) return '営業・マーケティング';
  if (/外資|グローバル|海外/.test(hay)) return '外資・グローバル';
  if (/管理部門|コンサル|経理|人事|バックオフィス/.test(hay)) return '管理部門・コンサル';
  return '管理部門・コンサル';
}

async function buildWithAI(raw, anthropic) {
  const tool = {
    name: 'structure_agent',
    description: '転職エージェント図鑑サイトのスキーマに沿って、与えられた事実情報のみから項目を構造化する。',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: CATEGORIES, description: '対応業界・職種から最も近い1カテゴリを選ぶ' },
        targetAge: { type: 'string', description: '対象年代。根拠となる事実が無ければ「' + NOT_DISCLOSED + '」' },
        jobCount: { type: 'string', description: '求人数の目安。根拠が無ければ「' + NOT_DISCLOSED + '」' },
        feeRate: {
          type: 'string',
          description:
            '成功報酬フィー（料率）。手数料公表サイトの抜粋に「業界の実勢相場」として読める具体的な料率（例:35%等の一律料率）があればそれをそのまま使う。' +
            '一方、抜粋にあるのが職業安定法の届出制手数料表としての「上限額」（例: 就職後1年間の賃金の150%等）のみで、実際の請求料率が読み取れない場合は、' +
            '「理論年収の30〜35%程度（業界相場からの推定値。公式の届出上限は賃金の◯%）」のように、業界相場の推定値を主として提示しつつ、届出上限の数値も括弧内に併記する。' +
            'いずれの情報も無ければ「' + NOT_DISCLOSED + '」とする。',
        },
        talentRange: { type: 'string', description: '候補者の年齢・年収レンジ。根拠が無ければ「' + NOT_DISCLOSED + '」' },
        oneLiner: { type: 'string', description: '求職者向けの一言キャッチコピー（30字前後、誇張・断定は避ける）' },
        companyOneLiner: { type: 'string', description: '採用企業向けの一言キャッチコピー（30字前後）' },
        appeal: { type: 'string', description: '2〜3文程度の特徴説明。事実情報のみに基づき、事業者コメントの丸写しは禁止（要約・言い換えのみ可）' },
        features: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: '箇条書き特徴3点' },
        feeExplanation: { type: 'string', description: '成功報酬に関する説明文。数値の根拠が無ければその旨を明記' },
        commitmentExplanation: { type: 'string', description: 'どこまで対応してくれるかの説明文' },
        companyDetail: {
          type: 'object',
          properties: {
            placementRate: { type: 'string' },
            avgDays: { type: 'string' },
            trackRecord: { type: 'string' },
            refundPolicy: {
              type: 'string',
              description:
                '返戻金制度（返金保証）について。手数料公表サイトの抜粋に「返戻金」「返金」「早期離職」等の記載があれば、' +
                '返金の条件（期間・料率など）を要約して記載する。記載が無ければ「' + NOT_DISCLOSED + '」とする。',
            },
            upfrontFee: { type: 'string' },
            minContract: { type: 'string' },
            exclusivity: { type: 'string' },
            capacity: { type: 'string' },
            sourcingMethod: { type: 'string' },
            reportingFreq: { type: 'string' },
            handoverPolicy: { type: 'string' },
            onboardingSupport: { type: 'string' },
            confidentiality: { type: 'string' },
          },
          required: [
            'placementRate', 'avgDays', 'trackRecord', 'refundPolicy', 'upfrontFee',
            'minContract', 'exclusivity', 'capacity', 'sourcingMethod', 'reportingFreq',
            'handoverPolicy', 'onboardingSupport', 'confidentiality',
          ],
          additionalProperties: false,
        },
      },
      required: [
        'category', 'targetAge', 'jobCount', 'feeRate', 'talentRange', 'oneLiner',
        'companyOneLiner', 'appeal', 'features', 'feeExplanation', 'commitmentExplanation',
        'companyDetail',
      ],
      additionalProperties: false,
    },
  };

  const factsBlock = [
    `企業名: ${raw.companyName || '(不明)'}`,
    `サービス名: ${raw.serviceName || '(不明)'}`,
    `サービスURL: ${raw.serviceUrl || '(不明)'}`,
    `対応エリア: ${raw.region || '(不明)'}`,
    `対応業界: ${raw.industries || '(不明)'}`,
    `対応職種: ${raw.jobTypes || '(不明)'}`,
    `許可番号: ${raw.permitNumber || '(不明)'}`,
    `手数料公表サイトURL: ${raw.feeDisclosureUrl || '(不明)'}`,
    `手数料変動事例（原文）: ${raw.feeVariationNote || '(不明)'}`,
    `事業者コメント（原文）: ${raw.operatorComment || '(不明)'}`,
    raw.feePageExcerpt ? `手数料公表サイトのテキスト抜粋:\n${raw.feePageExcerpt}` : '手数料公表サイトのテキスト抜粋: (取得できず)',
  ].join('\n');

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'structure_agent' },
    messages: [
      {
        role: 'user',
        content:
          '以下は、厚生労働省委託「職業紹介優良事業者認定制度」に掲載された、ある人材紹介事業者の公開情報（事実）です。' +
          'これらの事実情報のみに基づいて structure_agent ツールを呼び出し、転職エージェント比較サイト用のデータを構造化してください。\n\n' +
          '厳守事項:\n' +
          '- 数値（料率・年収・日数・件数など）は、根拠となる記載が無い限り絶対に創作しないこと。無ければ「' + NOT_DISCLOSED + '」と出力する。\n' +
          '- 「事業者コメント（原文）」を長文のままコピーしないこと。要約・言い換えた事実のみ使用する。\n' +
          '- 口コミ・評判は一切創作しないこと（このツールの入力に口コミ関連の項目は無い）。\n' +
          '- 誇張的な断定表現（業界No.1、必ず等）は使わないこと。\n' +
          '- 「手数料公表サイトのテキスト抜粋」を読む際は、それが「職業安定法の届出制手数料表における上限額」なのか' +
          '「実際に請求している標準的な料率（相場）」なのかを文脈から慎重に判断すること。' +
          '「手数料の額（上限）」「届出上限」「就職後1年間の賃金の◯％」のような表現は、多くの場合、法定の届出上限であり実際の請求額とは異なる。' +
          '上限額の記載しかない場合でも、それをそのまま実際の料率として出力しないこと（feeRateの項目説明に従うこと）。\n' +
          '- 抜粋内に返戻金・返金保証に関する記載があれば、必ず companyDetail.refundPolicy に反映すること。\n\n' +
          factsBlock,
      },
    ],
  });

  const toolUse = msg.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI response did not include a tool_use block');
  return toolUse.input;
}

function assembleEntry(raw, ai, rawHash) {
  return {
    name: raw.companyName || raw.serviceName || NOT_DISCLOSED,
    category: ai.category,
    targetAge: ai.targetAge,
    region: formatRegion(raw.region),
    jobCount: ai.jobCount,
    feeRate: ai.feeRate,
    talentRange: ai.talentRange,
    oneLiner: ai.oneLiner,
    companyOneLiner: ai.companyOneLiner,
    appeal: ai.appeal,
    features: ai.features,
    reviews: [],
    reviewNote: REVIEW_NOTE,
    companyReviews: [],
    companyReviewNote: COMPANY_REVIEW_NOTE,
    feeExplanation: ai.feeExplanation,
    commitmentExplanation: ai.commitmentExplanation,
    website: stripProtocol(raw.serviceUrl) || stripProtocol(raw.detailUrl),
    faviconUrl: buildFaviconUrl(raw.serviceUrl),
    real: true,
    sourceNote: buildSourceNote(raw),
    companyDetail: {
      permitNumber: raw.permitNumber || NOT_DISCLOSED,
      ...ai.companyDetail,
    },
    _sourceUrl: raw.detailUrl,
    _rawHash: rawHash,
  };
}

async function main() {
  if (!fs.existsSync(RAW_PATH)) {
    console.error(`Raw data not found at ${RAW_PATH}. Run scrape.js first.`);
    process.exit(1);
  }
  const rawData = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  const existing = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : [];
  const prevByUrl = new Map(existing.filter(a => a._sourceUrl).map(a => [a._sourceUrl, a]));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let anthropic = null;
  if (apiKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey });
  } else {
    console.warn('ANTHROPIC_API_KEY is not set — running in offline fallback mode (no AI structuring).');
  }

  const results = [];
  let reused = 0;
  let aiCalls = 0;
  let offlineBuilds = 0;

  for (const raw of rawData.agents) {
    const rawHash = computeRawHash(raw);
    const prev = prevByUrl.get(raw.detailUrl);

    if (prev && prev._rawHash && prev._rawHash === rawHash) {
      // faviconUrl は raw.serviceUrl から機械的に導出できるため、AI再構造化を
      // 発生させずに毎回リフレッシュする（スキーマ追加時の後方互換のため）。
      results.push({ ...prev, faviconUrl: buildFaviconUrl(raw.serviceUrl) });
      reused += 1;
      continue;
    }

    if (anthropic) {
      try {
        console.log(`[ai] structuring ${raw.companyName || raw.detailUrl}`);
        const ai = await buildWithAI(raw, anthropic);
        results.push(assembleEntry(raw, ai, rawHash));
        aiCalls += 1;
      } catch (err) {
        console.warn(`AI structuring failed for ${raw.detailUrl}: ${err.message}. Falling back to offline builder.`);
        results.push(assembleEntry(raw, buildOffline(raw), null));
        offlineBuilds += 1;
      }
    } else {
      results.push(assembleEntry(raw, buildOffline(raw), null));
      offlineBuilds += 1;
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2) + '\n', 'utf8');
  console.log(
    `Wrote ${results.length} agents to ${OUT_PATH} ` +
      `(reused=${reused}, ai=${aiCalls}, offline=${offlineBuilds})`
  );
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { computeRawHash, buildOffline, assembleEntry, formatRegion, stripProtocol, buildFaviconUrl };
