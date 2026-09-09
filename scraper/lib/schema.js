'use strict';

/**
 * サイトで使う分類。フロントエンド（index.html）の CATEGORY_STYLE / categories.json と
 * 一致させること。AIに分類させるときの選択肢もここから作る。
 *
 * 【特化カテゴリーと、それ以外】
 * 掲載の大半は厚生労働省の職業紹介事業者データで、その多くは特定の職種に特化していない。
 * 特化していないものを無理に細分化しても選ぶ意味がないので、
 *   - 特化が確認できたもの → SPECIALIZED_CATEGORIES のいずれか
 *   - 全職種を扱うと確認できたもの → 「全職種対応」
 *   - どちらとも言えないもの → 「その他」
 * の3段構えにしている。トップの「職種から探す」に出すのは特化カテゴリーだけ。
 */

/** 特化しているカテゴリー。トップの「職種から探す」に出すのはこれだけ。 */
const SPECIALIZED_CATEGORIES = [
  'IT・Web',
  '管理部門・コンサル',
  '施工管理・建設',
  '営業・マーケティング',
  '外資・グローバル',
  'スタートアップ・ベンチャー',
  '地方転職・UIターン',
  '第二新卒・ポテンシャル層',
  '医療・介護・福祉',
  '農業',
  '外国人・特定技能',
  '運輸・物流',
];

/** 特化が無い（全職種を扱う）ことが確認できたもの。 */
const GENERAL_CATEGORY = '全職種対応';

/** 特化の有無まで確認できなかったもの。 */
const FALLBACK_CATEGORY = 'その他';

const CATEGORIES = [...SPECIALIZED_CATEGORIES, GENERAL_CATEGORY, FALLBACK_CATEGORY];

const NOT_DISCLOSED = '非公開（お問い合わせで確認）';

module.exports = {
  CATEGORIES,
  SPECIALIZED_CATEGORIES,
  GENERAL_CATEGORY,
  FALLBACK_CATEGORY,
  NOT_DISCLOSED,
};
