import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("管理者の分類が親子で連動し、問題ID・本文検索と組み合わさる", async ({
  page,
}) => {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "admin@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { dm_study_admin: true },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  await page.addInitScript(
    ({ user, now }) => {
      const encode = (x: unknown) =>
        btoa(JSON.stringify(x))
          .replaceAll("=", "")
          .replaceAll("+", "-")
          .replaceAll("/", "_");
      localStorage.setItem(
        "sb-example-auth-token",
        JSON.stringify({
          access_token:
            encode({ alg: "HS256", typ: "JWT" }) +
            "." +
            encode({ sub: user.id, exp: now + 3600, aud: "authenticated" }) +
            ".test",
          refresh_token: "test",
          expires_at: now + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { user, now },
  );
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        configured: true,
        url: "https://example.supabase.co",
        key: "sb_publishable_test",
      },
    }),
  );
  await page.route("**/api/me", (r) =>
    r.fulfill({
      json: { user: { id: user.id, email: user.email, admin: true } },
    }),
  );
  await page.route("**/api/rpc", (r) => {
    const body = r.request().postDataJSON();
    if (body.name === "catalog")
      return r.fulfill({
        json: { categories: demoCategories, questions: demoQuestions },
      });
    if (body.name === "admin_questions")
      return r.fulfill({
        json: demoQuestions.map((q, i) => ({
          ...q,
          published: i !== 1,
          origin: i === 2 ? "ipa_past" : i === 1 ? "ipa_sample" : "ai_original",
        })),
      });
    return r.fulfill({ json: null });
  });
  await page.goto("/#admin");
  const rows = page.locator("#admin-list .history-row:visible");
  await expect(rows).toHaveCount(3);
  await expect(
    rows.filter({ hasText: "正規化の目的" }).locator(".admin-question-source"),
  ).toContainText("AIオリジナル");
  await expect(
    rows
      .filter({ hasText: "データ品質の改善" })
      .locator(".admin-question-source"),
  ).toContainText("IPA公式サンプル");
  await expect(
    rows.filter({ hasText: "関数従属性" }).locator(".admin-question-source"),
  ).toContainText("IPA過去問");
  await expect(rows.first().locator(".admin-question-source")).toContainText(
    demoQuestions[0].source,
  );

  await expect(rows.filter({ hasText: "関数従属性" })).not.toContainText(
    "評価",
  );
  await expect(rows.filter({ hasText: "正規化の目的" })).toContainText("評価");
  await expect(page.getByLabel("中分類", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("小分類", { exact: true })).toBeDisabled();
  await page.getByLabel("大分類", { exact: true }).selectOption("db");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("中分類", { exact: true }).selectOption("design");
  await page.getByLabel("小分類", { exact: true }).selectOption("normal");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("問題を検索", { exact: true }).fill("DEMO-NORMAL");
  await expect(rows).toHaveCount(1);
  await page.getByLabel("問題を検索", { exact: true }).fill("社員番号");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("関数従属性");
  await page.getByLabel("問題を検索", { exact: true }).fill("存在しない語");
  await expect(
    page.getByText("条件に合う問題がありません。", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("問題を検索", { exact: true }).fill("");
  await page.getByLabel("大分類", { exact: true }).selectOption("data");
  await expect(page.getByLabel("中分類", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("小分類", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("小分類", { exact: true })).toBeDisabled();
  await expect(rows).toHaveCount(1);
  await page.getByLabel("大分類", { exact: true }).selectOption("");
  await expect(rows).toHaveCount(3);
});
