'use strict';

/**
 * カテゴリー名を、サイトで使う分類にまとめ直す。
 *
 * 【なぜ必要になったか】
 * 「その他」に付いた補足メモ（categoryHint）を、5件たまるたびに正式カテゴリーへ
 * 自動昇格させる仕組みを入れていた（promote-categories.js）。厚労省データを
 * 4,000件超取り込んだ結果、その補足メモのほとんどが職業紹介の許可区分の言い換えで、
 *
 *   職業紹介・人材紹介 812件 / 職業紹介事業一般 787件 / 職業紹介 485件 /
 *   職業紹介（一般）333件 / 職業紹介事業者（全職種対応）318件 …
 *
 * のように、同じ意味の名前が46種類も増えてしまった。これは「特化職種」ではないので、
 * 利用者がここから選ぶ意味がない。しかも自動採番のslugになるため、
 * トップの「職種から探す」にも1つも出ていなかった（表に出ていたのは4,084社中144社）。
 *
 * 【考え方】
 * 名前の文字列だけで機械的にまとめる。AIに判定し直させない。
 * 元の分類はAIがページ本文から出したものなので、それを言い換えの単位で束ねるだけなら
 * 「本文に無いことを足す」ことにならない。
 *
 * 特化を表す語（医療・農業・特定技能・運輸）を先に見て、どれにも当たらない
 * 「職業紹介／人材紹介」系は、特化していないという事実どおり「全職種対応」にする。
 */

const { CATEGORIES, SPECIALIZED_CATEGORIES, GENERAL_CATEGORY, FALLBACK_CATEGORY } = require('./schema');

/**
 * まとめ先の判定。上から順に見て、最初に当たったものを採用する。
 * 「職業紹介（医療・介護）」のように両方の語を含む名前があるため、順番に意味がある。
 */
const MERGE_RULES = [
  { to: '医療・介護・福祉', pattern: /医療|医師|看護|介護|福祉|保育|ひとり親/ },
  { to: '農業', pattern: /農業|農協|農林|林業/ },
  { to: '外国人・特定技能', pattern: /特定技能|外国人|技能実習|国際人材|外国人材/ },
  { to: '運輸・物流', pattern: /運輸|物流|ドライバー|トラック/ },
  { to: GENERAL_CATEGORY, pattern: /職業紹介|人材紹介|人材派遣|人材サービス|全職種/ },
];

/**
 * カテゴリー名をまとめ先に変換する。
 * 既に正式カテゴリーの名前はそのまま返す（勝手に付け替えない）。
 */
function mergeCategory(name) {
  const value = String(name || '').trim();
  if (!value) return FALLBACK_CATEGORY;
  if (CATEGORIES.includes(value)) return value;

  const hit = MERGE_RULES.find(rule => rule.pattern.test(value));
  return hit ? hit.to : FALLBACK_CATEGORY;
}

/**
 * トップの「職種から探す」に出すカテゴリー。
 *
 * 「全職種対応」と「その他」は、特化していないことを示すものなので入れない。
 * ここから選んでも絞り込めず、入口としての役に立たないため
 * （一覧と絞り込みのプルダウンからは今までどおりたどれる）。
 */
function navigableCategories(agents, categories) {
  const counts = new Map();
  for (const agent of agents || []) {
    const key = agent && agent.category;
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return (categories || [])
    .filter(c => SPECIALIZED_CATEGORIES.includes(c.name))
    .map(c => ({ ...c, count: counts.get(c.name) || 0 }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count || SPECIALIZED_CATEGORIES.indexOf(a.name) - SPECIALIZED_CATEGORIES.indexOf(b.name));
}

module.exports = { MERGE_RULES, mergeCategory, navigableCategories };
