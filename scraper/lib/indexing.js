'use strict';

/**
 * 検索エンジンに載せるページ（インデックス対象）を決める。
 *
 * 【なぜ必要になったか】
 * AdSense の審査で「有用性の低いコンテンツ」と判定された。調べると、
 *
 *   - 掲載5,584社のうち5,505社（98.6%）が厚労省『人材サービス総合サイト』の公開データの転載
 *   - その1ページあたりの中身は約500字で、手数料・対象年代・口コミはほぼ0%
 *   - 手数料の説明が「非公開（お問い合わせで確認）」で完全一致するページが2,270枚
 *
 * という状態で、その5,600ページすべてを検索対象として Google に送っていた。
 *
 * 【方針】
 * 厚労省データのページはサイトに残す（利用者はこれまで通り全社を見られる）が、
 * 検索対象からは外す（noindex, follow ＋ サイトマップから除外）。
 * Google に評価してもらうのは、独自に情報を集めたエージェントのページ・
 * それを含むカテゴリーページ・トップ・解説記事だけにする。
 *
 * 判定は出所（source）だけで機械的に行う。ページごとの文字数などで線を引くと、
 * 日々のデータ更新でインデックス対象が揺れ動いてしまうため。
 */

/** 公開データの転載で、独自の情報が加わっていない出所。 */
const NON_INDEXABLE_SOURCES = new Set(['mhlw']);

/** 検索対象から外すときに <head> に入れるタグ。リンクはたどってもらう（follow）。 */
const ROBOTS_NOINDEX = '<meta name="robots" content="noindex,follow">';

function isIndexableAgent(agent) {
  return !!agent && !NON_INDEXABLE_SOURCES.has(agent.source);
}

/**
 * カテゴリーページを検索対象にするか。
 * 並んでいるのが厚労省データのエージェントだけなら、一覧ページも同じく中身が薄いので外す。
 */
function isIndexableCategory(agents, categoryName) {
  return (agents || []).some(a => a && a.category === categoryName && isIndexableAgent(a));
}

/**
 * HTML の <head> に noindex を1つだけ入れる（既にあれば何もしない）。
 * 文字コード指定は <head> の先頭にある必要があるので、その直後に置く。
 */
function withRobotsNoindex(html) {
  const source = String(html);
  if (/<meta\s+name=["']robots["']/i.test(source)) return source;
  if (/<meta\s+charset=["'][^"']*["']\s*\/?>/i.test(source)) {
    return source.replace(/(<meta\s+charset=["'][^"']*["']\s*\/?>)/i, `$1\n${ROBOTS_NOINDEX}`);
  }
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/(<head[^>]*>)/i, `$1\n${ROBOTS_NOINDEX}`);
  }
  throw new Error('<head> が見つからないため noindex を入れられません');
}

module.exports = {
  NON_INDEXABLE_SOURCES,
  ROBOTS_NOINDEX,
  isIndexableAgent,
  isIndexableCategory,
  withRobotsNoindex,
};
