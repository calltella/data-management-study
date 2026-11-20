import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("学習履歴は小分類の回答数を大分類に合算する", async ({ page }) => {
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
  const categories = [
    ...demoCategories,
    { id: "sql", parent_id: "design", name: "SQLの詳細", level: 3 },
  ];
  await page.route("**/api/rpc", (r) => {
    const body = r.request().postDataJSON();
    if (body.name === "catalog")
      return r.fulfill({ json: { categories, questions: demoQuestions } });
    if (body.name === "history_by_category") {
      expect(body.args.category_ids).toEqual(["db", "design", "normal", "sql"]);
    }
    if (body.name === "history" || body.name === "history_by_category")
      return r.fulfill({
        json: {
          answers:
            body.name === "history"
              ? [
                  {
                    title: "品質の回答",
                    correct: true,
                    answered_at: "2026-11-18T00:00:00Z",
                  },
                ]
              : body.args.page_number === 1
                ? [
                    {
                      title: "古い設計の回答",
                      correct: false,
                      answered_at: "2026-11-17T00:00:00Z",
                    },
                  ]
                : Array.from({ length: 50 }, (_, i) => ({
                    title: `設計の回答${i}`,
                    correct: true,
                    answered_at: "2026-11-18T00:00:00Z",
                  })),
          summary: [
            { category_id: "normal", answered: 3, correct: 2 },
            { category_id: "sql", answered: 2, correct: 1 },
            { category_id: "quality-basic", answered: 1, correct: 1 },
          ],
        },
      });
    return r.fulfill({ json: null });
  });
  await page.goto("/#history");
  const rows = page.locator(".history-table tbody tr");
  await expect(rows).toHaveCount(2);
  const database = rows.filter({ hasText: "データベース" });
  await expect(database.locator("td")).toHaveText(["3", "5"]);
  await expect(
    rows.filter({ hasText: "データマネジメント" }).locator("td"),
  ).toHaveText(["1", "1"]);
  await expect(page.locator(".history-table")).not.toContainText("正規化");
  await page.getByRole("button", { name: "データベース", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "回答履歴：データベース" }),
  ).toBeVisible();
  await expect(page.locator("#answer-history .history-row")).toHaveCount(50);
  await expect(page.locator("#answer-history")).not.toContainText("品質の回答");
  await expect(
    page.getByRole("button", { name: "データベース", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "次の50件" }).click();
  await expect(page.locator("#answer-history")).toContainText("古い設計の回答");
  await page.getByRole("button", { name: "すべての回答履歴を表示" }).click();
  await expect(
    page.getByRole("heading", { name: "回答履歴：すべて" }),
  ).toBeVisible();
  await expect(page.locator("#answer-history")).toContainText("品質の回答");
  await expect(page.getByRole("button", { name: "前の50件" })).toHaveCount(0);
});
