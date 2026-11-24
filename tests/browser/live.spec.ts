import { test, expect } from "@playwright/test";
import { questionLikelihood } from "../../src/client/question-likelihood";
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
  expect(data.questions.length).toBeGreaterThan(0);
  expect(
    data.questions.filter(({ id }: { id: string }) => !Object.hasOwn(questionLikelihood, id)),
  ).toEqual([]);
  const newPastQuestion = await page.request.post("/api/rpc", {
    headers: { Origin: "http://localhost:5173" },
    data: { name: "reveal_question", args: { question_id: "DMQ-0064" } },
  });
  expect(newPastQuestion.ok()).toBe(true);
  expect(await newPastQuestion.json()).toMatchObject({ correct: 4 });
  expect(JSON.stringify(data.questions)).not.toContain("，");
  await page.goto("/#practice");
  await page.getByRole("button", { name: "全解除" }).click();
  await page.locator('input[name="category"][value="DM-A-29"]').check();
  await page.getByRole("combobox", { name: "出題数" }).selectOption("0");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  const heading = page.locator(".question-source");
  await expect(heading).toBeVisible();
  const reveal = page.getByRole("button", { name: "先に正答・解説を見る" });
  const newQuestion = "従業員が、顧客連絡先一覧を閲覧できるクラウドの共有リンク";
  const questionBody = page.locator(".question-body");
  for (let i = 0; i < 3 && !(await questionBody.textContent())?.includes(newQuestion); i++) {
    await reveal.click();
    await page.getByRole("link", { name: "次の問題へ" }).click();
  }
  await expect(questionBody).toContainText(newQuestion);
  await expect(heading).toHaveText("オリジナル演習問題（AI作成）");
  await reveal.click();
  await expect(page.locator(".explanation h2")).toContainText("正解：ア");
  await expect(page.locator(".choice-explanation")).toHaveCount(4);

  await page.goto("/?demo=1#practice");
  await page.getByRole("combobox", { name: "出題数" }).selectOption("10");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.locator("[data-choice]")).toHaveCount(4);
  await page.locator("[data-choice]").first().click();
  await expect(page.locator(".explanation")).toBeVisible();
});
