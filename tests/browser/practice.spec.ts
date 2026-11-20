import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { configured: false, url: null, key: null } }),
  );
  await page.route("**/api/demo", (route) =>
    route.fulfill({
      json: { categories: demoCategories, questions: demoQuestions },
    }),
  );
});
test("ログイン案内・ゲスト回答・正答を先に見る・変更禁止", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "おかえりなさい" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "2027年度開始予定の新しい試験に向けて" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "ログインせずに始める" }).click();
  await page.getByRole("combobox", { name: "出題数" }).selectOption("0");
  await page.locator('input[name="category"][value="data"]').uncheck();
  await page.getByRole("checkbox", { name: "選択肢を並べ替える" }).check();
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  await page.getByRole("button", { name: "先に正答・解説を見る" }).click();
  await expect(page.locator(".explanation")).toBeVisible();
  await expect(page.locator("[data-choice]").first()).toBeEnabled();
  await page.locator("[data-choice]").first().click();
  await expect(page.locator("[data-choice]").first()).toBeDisabled();
  await expect(page.getByText("ゲストの回答は保存していません")).toBeVisible();
  await page.getByRole("button", { name: "次の問題へ" }).click();
  await expect(page.getByText("QUESTION 02 / 2")).toBeVisible();
  await page.locator("[data-choice]").first().click();
  await page
    .getByRole("button", { name: "演習を終了", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "演習が完了しました。" }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).length)).toBe(0);
  expect(errors).toEqual([]);
});
test("スマートフォン表示と問題不足の案内", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#practice");
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("条件に合う問題は3問");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "/tmp/dm-study-mobile.png", fullPage: true });
});

test("出題分類は最上位だけで配下の問題件数を表示する", async ({ page }) => {
  await page.goto("/#practice");
  await expect(page.locator('input[name="category"]')).toHaveCount(2);
  await expect(page.locator(".categories")).toContainText(
    "データマネジメント （1問）",
  );
  await expect(page.locator(".categories")).toContainText(
    "データベース （2問）",
  );
  await expect(
    page.getByRole("checkbox", { name: "品質の改善", exact: true }),
  ).toHaveCount(0);
});

test("分類は初期全選択で全解除と全選択を切り替えられる", async ({ page }) => {
  await page.goto("/#practice");
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(2);
  await page.getByRole("combobox", { name: "出題数" }).selectOption("0");
  await page.getByRole("button", { name: "全解除", exact: true }).click();
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "出題数" })).toHaveValue("0");
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "分類を1つ以上選択してください",
  );
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(0);
  await page.getByRole("button", { name: "全選択", exact: true }).click();
  await expect(page.locator('input[name="category"]:checked')).toHaveCount(2);
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  await expect(page.getByText("QUESTION 01 / 3")).toBeVisible();
});

test("出題数メニューと設定は分類枠内にあり全部を選べる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#practice");
  await expect(
    page.getByRole("link", { name: "学習する", exact: true }),
  ).toBeVisible();
  const menu = page.locator('.categories select[name="count"]');
  await expect(menu).toHaveValue("10");
  await expect(menu.locator("option")).toHaveText([
    "10",
    "15",
    "20",
    "25",
    "30",
    "全部",
  ]);
  await expect(page.locator('.categories input[name="shuffle"]')).toHaveCount(
    1,
  );
  await menu.selectOption("0");
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  await expect(page.getByText("QUESTION 01 / 3")).toBeVisible();
  await expect(page.getByText(/指定は/)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
