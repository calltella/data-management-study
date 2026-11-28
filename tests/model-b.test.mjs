import assert from "node:assert/strict";
import test from "node:test";
import {
  formatElapsed,
  includesBCategory,
  matchesMatrixFilter,
  matrixColumnValues,
} from "../src/model-b.ts";
import { bCategories, bSampleCases } from "../src/kamoku-b-samples.ts";

test("科目Bカテゴリは4大項目・16小項目で構成されている", () => {
  const majors = bCategories.filter((c) => c.level === 1);
  const minors = bCategories.filter((c) => c.level === 2);
  assert.equal(majors.length, 4);
  assert.equal(minors.length, 16);
  for (const minor of minors) {
    assert.ok(
      majors.some((m) => m.id === minor.parent_id),
      `親カテゴリが存在すること: ${minor.id}`,
    );
  }
});

test("公式サンプル2問＋オリジナル体験1問＋有料1問の整合性（区分・9択マトリックス・正答・資料アンカー）", () => {
  assert.equal(bSampleCases.length, 4);
  const [q1Case, q2Case, q3Case, q4Case] = bSampleCases;

  assert.equal(q1Case.origin, "ipa_sample");
  assert.equal(q1Case.access_tier, "free");
  assert.equal(q1Case.questions[0].choices.length, 9);
  assert.equal(q1Case.questions[0].correct_choice_id, 3); // ウ
  assert.deepEqual(q1Case.questions[0].choices[2].cells, [
    "営業部",
    "マーケティング部",
    "営業部",
    "営業部",
  ]);

  assert.equal(q2Case.origin, "ipa_sample");
  assert.equal(q2Case.access_tier, "free");
  assert.equal(q2Case.questions[0].choices.length, 9);
  assert.equal(q2Case.questions[0].candidates?.length, 6);
  assert.equal(q2Case.questions[0].correct_choice_id, 5); // オ
  assert.deepEqual(q2Case.questions[0].choices[4].cells, ["（二）", "（五）"]);

  assert.equal(q3Case.origin, "ai_original");
  assert.equal(q3Case.access_tier, "free");
  assert.equal(q3Case.source, "オリジナル演習問題（AI作成）");
  assert.equal(q3Case.questions[0].choices.length, 9);
  assert.equal(q3Case.questions[0].candidates?.length, 6);
  assert.equal(q3Case.questions[0].correct_choice_id, 6); // カ
  assert.deepEqual(q3Case.questions[0].choices[5].cells, ["（二）", "（六）"]);

  assert.equal(q4Case.origin, "ai_original");
  assert.equal(q4Case.access_tier, "paid");
  assert.equal(q4Case.source, "オリジナル演習問題（AI作成）");
  assert.equal(q4Case.questions[0].choices.length, 9);
  assert.equal(q4Case.questions[0].candidates?.length, 6);
  assert.equal(q4Case.questions[0].correct_choice_id, 8); // ク
  assert.deepEqual(q4Case.questions[0].choices[7].cells, ["（三）", "（五）"]);

  // 解説ステップの資料参照アンカーが実在するブロックIDを指していること
  for (const c of bSampleCases) {
    const blockIds = new Set(c.scenario_blocks.map((b) => b.id));
    for (const q of c.questions) {
      for (const step of q.explanation.steps) {
        for (const ref of step.refs) {
          assert.ok(blockIds.has(ref), `${c.id} の参照先 ${ref} が存在すること`);
        }
      }
    }
  }
});

test("includesBCategory は大項目・小項目のどちらの選択にも反応する", () => {
  assert.equal(
    includesBCategory(["DM-B-01-04"], ["DM-B-01"], bCategories),
    true,
  );
  assert.equal(
    includesBCategory(["DM-B-01-04"], ["DM-B-01-04"], bCategories),
    true,
  );
  assert.equal(
    includesBCategory(["DM-B-01-04"], ["DM-B-02"], bCategories),
    false,
  );
});

test("matrixColumnValues と matchesMatrixFilter が正しく絞り込む", () => {
  const q1 = bSampleCases[0].questions[0];
  const cols = matrixColumnValues(q1);
  assert.deepEqual(cols[0], ["営業部", "データ基盤チーム"]);
  assert.deepEqual(cols[1], ["営業部", "マーケティング部", "データ基盤チーム"]);

  const matched = q1.choices.filter((ch) =>
    matchesMatrixFilter(ch, { 0: "営業部", 1: "マーケティング部", 2: "営業部", 3: "営業部" }),
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].label, "ウ");
});

test("formatElapsed が MM:SS 形式で整形する", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(65), "01:05");
  assert.equal(formatElapsed(300), "05:00");
});
