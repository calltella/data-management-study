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
          difficulty_assessment:
            i === 0
              ? {
                  level: 1,
                  status: "needs_review",
                  reason: "要レビュー確認用",
                  model: "gemini-4-neon",
                  rubric_version: "v1",
                  assessed_at: "2026-11-23T03:56:00Z",
                }
              : undefined,
        })),
      });
    return r.fulfill({ json: null });
  });
  await page.goto("/#admin");
  const adminList = page.locator("#admin-list");
  const summary = page.locator("#admin-category-summary");
  const rows = page.locator("#admin-list tbody tr:visible");
  await expect(page.getByText("WORKSPACE", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "分類別一覧に戻る" })).toBeHidden();
  await expect(adminList).toBeHidden();
  await expect(summary).toBeVisible();
  await expect(summary.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByLabel("中分類", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("小分類", { exact: true })).toBeDisabled();

  await summary.getByRole("button", { name: "データベース" }).click();
  await expect(adminList).toBeVisible();
  await expect(summary).toBeHidden();
  await expect(rows).toHaveCount(2);
  await expect(rows.locator(".admin-question-source strong")).toHaveCount(0);
  await expect(rows.first()).not.toContainText(demoQuestions[0].id);
  await expect(rows.first().locator(".admin-question-source")).toContainText(
    demoQuestions[0].source,
  );
  await expect(rows.filter({ hasText: "関数従属性" })).not.toContainText(
    "評価",
  );
  await expect(rows.filter({ hasText: "正規化の目的" })).toContainText("評価");

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
  const search = page.getByLabel("問題を検索", { exact: true });
  const clear = page.getByRole("button", { name: "検索をクリア" });
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.getByLabel("小分類", { exact: true })).toHaveValue("normal");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("大分類", { exact: true }).selectOption("data");
  await expect(page.getByLabel("中分類", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("小分類", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("小分類", { exact: true })).toBeDisabled();
  await expect(rows).toHaveCount(1);
  await page.getByLabel("大分類", { exact: true }).selectOption("");
  await expect(adminList).toBeHidden();
  await expect(summary).toBeVisible();
  await page.getByRole("button", { name: "すべて表示" }).click();
  await expect(adminList).toBeVisible();
  await expect(rows).toHaveCount(3);
  await page.getByLabel("非公開を除く", { exact: true }).check();
  await expect(rows).toHaveCount(2);
  await page.getByLabel("要レビューのみ", { exact: true }).check();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "分類別一覧に戻る" }).click();
  await expect(adminList).toBeHidden();
  await expect(summary).toBeVisible();
  await expect(page.getByLabel("AI問題のみ", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("非公開を除く", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("要レビューのみ", { exact: true })).not.toBeChecked();
  await page.getByLabel("AI問題のみ", { exact: true }).check();
  await expect(adminList).toBeVisible();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "分類別一覧に戻る" }).click();
  await expect(page.getByLabel("AI問題のみ", { exact: true })).not.toBeChecked();
});
