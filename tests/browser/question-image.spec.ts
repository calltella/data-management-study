import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("大きな問題図を縮小表示し、拡大と閉じる操作ができる", async ({ page }) => {
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
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  const image = page.locator(".question-image");
  await expect(image).toBeVisible();
  await image.evaluate((node: HTMLImageElement) => node.decode());
  const bounds = await image.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(180);
  expect(bounds!.width).toBeLessThanOrEqual(420);
  await expect(page.locator("[data-choice]").first()).toBeInViewport();
  await page
    .getByRole("button", { name: "問題の図表を拡大", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "問題の図表（拡大）",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect((await dialog.locator("img").boundingBox())!.height).toBeGreaterThan(
    bounds!.height,
  );
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "問題の図表を拡大", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(image).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
