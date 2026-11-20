import { test, expect } from "@playwright/test";
import { demoCategories } from "../../src/demo";
import samples from "../../database/questions-ipa-sample.json" with { type: "json" };
for (const q of samples) {
  test(`${q.id}を公式サンプルとして表示して公式正答で回答できる`, async ({
    page,
  }) => {
    await page.route("**/api/config", (r) =>
      r.fulfill({ json: { configured: false } }),
    );
    await page.route("**/api/demo", (r) =>
      r.fulfill({
        json: {
          categories: demoCategories,
          questions: [{ ...q, category_id: "quality-basic" }],
        },
      }),
    );
    await page.goto("/#practice");
    await page
      .getByRole("button", { name: "最初から出題する", exact: true })
      .click();
    await expect(page.locator(".question-source")).toHaveText(`IPA データマネジメント試験（仮称）科目A サンプル問題 問${q.reference.question_number}`);
    await expect(page.locator(".question")).toContainText("サンプル問題");
    if (q.id === "DMQ-0039") {
      await expect(page.locator(".question-body")).toContainText(
        "データの意味、利用ルールの説明など",
      );
      await expect(page.locator(".question-body")).toContainText(
        "カラムの型・桁",
      );
      await expect(page.locator(".question-body")).toContainText(
        "データの作成日時",
      );
    }
    await page.locator(`[data-choice="${q.correct}"]`).click();
    await expect(page.locator(".explanation")).toContainText("正解です");
    await expect(page.locator(".rating")).toHaveCount(0);
  });
}
