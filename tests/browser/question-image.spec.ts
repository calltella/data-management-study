import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
import pastQuestions from "../../database/questions-2019-2020.json" with { type: "json" };
test("出題カードの幅を揃え、大きな問題図を読みやすく中央に表示する", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/demo", (r) =>
    r.fulfill({
      json: {
        categories: demoCategories,
        questions: [{ ...demoQuestions[0], asset_key: "large.png" }],
      },
    }),
  );
  await page.route("**/api/images/*", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1800"><rect width="1400" height="1800" fill="#e0efe9"/><rect x="150" y="150" width="1100" height="1500" fill="white" stroke="#176b60" stroke-width="20"/></svg>',
    }),
  );
  await page.goto("/#practice");
  await page.getByRole("combobox", { name: "出題数" }).selectOption("10");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  const question = page.locator(".question");
  expect((await question.boundingBox())!.width).toBe(1120);
  await page.setViewportSize({ width: 1600, height: 900 });
  expect((await question.boundingBox())!.width).toBe(1120);
  const image = page.locator(".question-image");
  await expect(image).toBeVisible();
  await image.evaluate((node: HTMLImageElement) => node.decode());
  const bounds = await image.boundingBox();
  expect(bounds!.width).toBeCloseTo(760, 1);
  expect(bounds!.height / bounds!.width).toBeCloseTo(1800 / 1400);
  await expect(page.locator("[data-choice]").first()).toBeVisible();
  const figure = (await page.locator(".question-figure").boundingBox())!;
  expect(bounds!.x + bounds!.width / 2).toBeCloseTo(figure.x + figure.width / 2, 0);
  await image.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(image).toBeVisible();
  expect((await image.boundingBox())!.width).toBeLessThan((await question.boundingBox())!.width);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("IPA過去問の公式図表を演習画面で読み込む", async ({ page }) => {
  const question = {
    ...demoQuestions[0],
    id: "DMQ-0068",
    asset_key: "ipa-original/DMQ-0068.png",
  };
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();

  const image = page.getByRole("img", { name: "問題の図表" });
  await expect(image).toHaveAttribute("src", "/ipa-original/DMQ-0068.png?v=2");
  await image.evaluate((node: HTMLImageElement) => node.decode());
  await expect(image).toBeVisible();
});

test("公式冊子を画像で表示する問題はシャッフル時も原順の記号だけで回答できる", async ({ page }) => {
  const question = { ...pastQuestions.find(q => q.id === "DMQ-0079")!, category_id: demoQuestions[0].category_id };
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { configured: false } }),
  );
  await page.route("**/api/demo", (route) =>
    route.fulfill({ json: { categories: demoCategories, questions: [question] } }),
  );
  await page.goto("/#practice");
  await page.getByLabel("選択肢を並べ替える").check();
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await page.getByRole("img", { name: "公式冊子の関数従属性と選択肢" })
    .evaluate((image: HTMLImageElement) => image.decode());
  const body = page.locator(".question-body");
  await expect(body).toBeVisible();
  await expect(body).toContainText("注文記録（注文番号、注文日");
  await expect(body).not.toContainText("〔関数従属性〕");
  await expect(page.locator(".choices button")).toHaveText(["ア", "イ", "ウ", "エ"]);
  await page.locator('[data-choice="3"]').click();
  await expect(page.locator(".explanation h2")).toHaveText("正解です · 正解：ウ");
});
