'use strict';

/**
 * 厚労省データを「AIを使わずに」整形する部分の見張り。
 *
 * 【なぜAIを使わないことにしたか】
 * 厚労省データは、許可番号・事業主名・住所・取扱職種・取扱地域がすでに構造化されている。
 * AIに渡しても項目を言い換えるだけで情報は増えず、むしろ元データに無い記述
 * （「8職種に対応」「医師会が直営する」など、実際に出ていた）が混ざった。
 * 1件1回の呼び出しで毎日500件・月$56かかっていたので、機械的な整形に切り替えた
 * （2026-09-27・DECISIONS.md）。
 *
 * ここで守りたいのは「元データに無いことを書かない」こと。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { guessCategoryOfflineMhlw, mhlwOneLiner, buildOffline } = require('../structure');

const ROOT = path.join(__dirname, '..', '..');

test('取扱職種から、カテゴリーを決める', () => {
  const cases = [
    ['全職種', '全職種対応'],
    ['農業の職業', '農業'],
    ['医師、看護師、薬剤師', '医療・介護・福祉'],
    ['情報処理･通信技術者', 'IT・Web'], // 半角の中黒が使われている（公式の表記ゆれ）
    ['自動車運転の職業、倉庫作業員', '運輸・物流'],
    ['出入国管理及び難民認定法に基づく特定技能の在留資格に係る職種', '外国人・特定技能'],
    ['建設の職業', '施工管理・建設'],
    ['販売の職業', '営業・マーケティング'],
    ['専門的･技術的職業、管理的職業、事務的職業', '管理部門・コンサル'],
    ['', 'その他'],
  ];
  for (const [occ, expected] of cases) {
    assert.strictEqual(
      guessCategoryOfflineMhlw({ handledOccupations: occ }),
      expected,
      `「${occ}」の分類が違います`
    );
  }
});

test('事業所名や備考は分類に使わない（「営業所」「外国人」などに当たるため）', () => {
  const raw = {
    handledOccupations: '全職種',
    handledOther: '外国人材の紹介も行う',
    establishmentName: '株式会社◯◯ 札幌営業所',
  };
  assert.strictEqual(guessCategoryOfflineMhlw(raw), '全職種対応');
});

test('紹介文は、公式の項目だけを並べる', () => {
  const text = mhlwOneLiner({
    handledOccupations: '全職種',
    handledRegion: '国内',
    prefecture: '東京',
  });
  assert.match(text, /東京都の職業紹介事業者/);
  assert.match(text, /取扱職種は全職種/);
  assert.match(text, /取扱地域は国内/);
  // 評価の言葉を足していないこと
  for (const word of ['幅広い', '豊富', '充実', '安心', 'おすすめ']) {
    assert.ok(!text.includes(word), `「${word}」は元データに無いので書けません`);
  }
});

test('長い取扱職種は、読点で切る（途中で切ると意味が変わる）', () => {
  const text = mhlwOneLiner({
    handledOccupations: '医師、看護師、助産師、保健師、薬剤師、栄養士、検査技師、レントゲン技師で北海道に居住するもの',
    handledRegion: '北海道',
    prefecture: '北海道',
  });
  assert.ok(text.includes('ほか'), '省略の印がありません');
  assert.ok(!/技師で北海道にほか/.test(text), '語の途中で切れています');
});

test('整形した結果に、元データに無い数字が入らない', () => {
  const raw = {
    handledOccupations: '医師、看護師、薬剤師',
    handledRegion: '北海道',
    prefecture: '北海道',
    businessOwnerName: '一般社団法人 札幌市医師会',
  };
  const built = buildOffline(raw, 'mhlw');
  const text = [built.oneLiner, built.appeal, ...(built.features || [])].join(' ');
  // AI版は「8職種に対応」と、数えた数を書いていた。機械版はそれをしない。
  const numbers = text.match(/\d+/g) || [];
  assert.deepStrictEqual(numbers, [], `元データに無い数字が入っています: ${numbers.join(', ')}`);
});

test('掲載中の厚労省データすべてで、分類が14種類のどれかになる', () => {
  const { CATEGORIES } = require('../lib/schema');
  const raws = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'mhlw-agents.json'), 'utf8'));
  const unknown = new Set();
  for (const raw of raws) {
    const category = guessCategoryOfflineMhlw(raw);
    if (!CATEGORIES.includes(category)) unknown.add(category);
  }
  assert.deepStrictEqual([...unknown], [], '決めた14分類に無いカテゴリーが出ています');
});
