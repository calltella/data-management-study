import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";

test("マイページのメニュー切り替え・問題別正誤履歴・1問チャレンジが動作する", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
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

  const q0 = demoQuestions[0]!;
  await page.route("**/api/rpc", async (r) => {
    const body = r.request().postDataJSON() as { name: string; args?: Record<string, unknown> };
    if (body.name === "catalog") {
      return r.fulfill({ json: { categories: demoCategories, questions: demoQuestions } });
    }
    if (body.name === "history" || body.name === "history_by_category") {
      return r.fulfill({
        json: {
          answers: [],
          summary: [{ category_id: q0.category_id, answered: 2, correct: 1 }],
        },
      });
    }
    if (body.name === "question_history") {
      return r.fulfill({
        json: [
          {
            question_id: q0.id,
            title: q0.title,
            category_id: q0.category_id,
            published: true,
            answered_count: 2,
            correct_count: 1,
            latest_correct: true,
            latest_answered_at: "2026-11-24T07:00:00Z",
            results: [false, true],
          },
          {
            question_id: "DMQ-PRIVATE",
            title: "非公開テスト問題",
            category_id: q0.category_id,
            published: false,
            answered_count: 1,
            correct_count: 0,
            latest_correct: false,
            latest_answered_at: "2026-11-24T06:00:00Z",
            results: [false],
          },
        ],
      });
    }
    if (body.name === "start_single_question") {
      expect(body.args?.target_question_id).toBe(q0.id);
      return r.fulfill({
        json: {
          id: "single-ex-1",
          requested: 1,
          available: 1,
          items: [
            {
              id: "item-1",
              sequence: 1,
              question: q0,
              choice_order: [1, 2, 3, 4],
              answer_history: [false, true],
            },
          ],
        },
      });
    }
    return r.fulfill({ json: {} });
  });

  await page.goto("/#account");

  // 初期表示はパスワード変更タブ
  await expect(page.getByRole("tab", { name: "パスワード変更", selected: true })).toBeVisible();
  await expect(page.locator("#change-password-form")).toBeVisible();

  // 学習データの管理タブ
  await page.getByRole("tab", { name: "学習データの管理" }).click();
  await expect(page.getByRole("button", { name: "回答履歴を削除する" })).toBeVisible();
  await expect(page.getByRole("button", { name: "学習履歴をリセットする" })).toBeVisible();

  // アカウントの処理タブ
  await page.getByRole("tab", { name: "アカウントの処理" }).click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expect(page.getByRole("button", { name: "このアプリのアカウントを削除" })).toBeVisible();

  // 学習履歴タブ（大分類選択 → 公開問題一覧 → 1問チャレンジ）
  await page.getByRole("tab", { name: "学習履歴" }).click();
  await expect(page.getByRole("heading", { name: "大分類別の学習状況" })).toBeVisible();
  await expect(page.locator(".question-history-row")).toHaveCount(0);

  // 大分類を選択すると公開問題のみ表示され、非公開問題は表示されないこと
  await page.locator("[data-history-category]").first().click();
  await expect(page.locator(".question-history-row")).toHaveCount(1);
  await expect(page.locator(".question-history-row")).toContainText(q0.title);
  await expect(page.locator(".question-history-row")).toContainText("1/2");
  await expect(page.locator(".history-questions")).not.toContainText("非公開テスト問題");

  // 1問チャレンジで出題画面に遷移すること
  await page.getByRole("button", { name: "1問チャレンジ" }).click();
  await expect(page.locator(".question")).toContainText(q0.body);
});
