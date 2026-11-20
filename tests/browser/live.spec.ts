import { test, expect } from "@playwright/test";
test("実Worker接続・ログイン画面と実APIのサンプル演習", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "おかえりなさい" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Googleでログイン" }),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "/tmp/dm-study-login.png", fullPage: true });
  const config = await (await page.request.get("/api/config")).json();
  expect(config.configured).toBe(true);
  const catalog = await page.request.post("/api/rpc", {
    headers: { Origin: "http://localhost:5173" },
    data: { name: "catalog" },
  });
  expect(catalog.ok()).toBe(true);
  const data = await catalog.json();
  expect(data.categories.length).toBe(83);
  expect(data.questions.length).toBe(39);
  expect(
    data.questions.filter((q: { origin: string }) => q.origin === "ipa_sample"),
  ).toHaveLength(3);
  expect(
    data.questions.filter((q: { source: string }) =>
      q.source.includes("令和6年度"),
    ),
  ).toHaveLength(18);
  expect(JSON.stringify(data.questions)).not.toContain("，");
  await page.goto("/?demo=1#practice");
  await page.getByRole("combobox", { name: "出題数" }).selectOption("10");
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  await expect(page.locator("[data-choice]")).toHaveCount(4);
  await page.locator("[data-choice]").first().click();
  await expect(page.locator(".explanation")).toBeVisible();
});
