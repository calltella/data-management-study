import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shuffled,
  includesCategory,
  relabelExplanation,
} from "../src/model.ts";
test("分類の親子選択とシャッフルの問題重複なし", () => {
  const cs = [
    { id: "a", parent_id: null },
    { id: "b", parent_id: "a" },
  ];
  assert.equal(includesCategory("b", ["a"], cs), true);
  assert.deepEqual([...shuffled([1, 2, 3, 4])].sort(), [1, 2, 3, 4]);
});
test("解説の選択肢参照を表示順へ対応させる", () => {
  assert.equal(
    relabelExplanation(
      "「ア」は正解。選択肢イは不正解。ウィンドウは変更しない。",
      [2, 1, 4, 3],
    ),
    "「イ」は正解。選択肢アは不正解。ウィンドウは変更しない。",
  );
});
