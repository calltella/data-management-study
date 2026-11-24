import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";

test("解説のMarkdown記法が演習画面・選択肢解説・管理プレビューで描画され生HTMLはエスケープされる", async ({
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

  const mdExplanation = [
    "### 用語整理",
    "これは**重要ポイント**です。",
    "",
    "- 箇条書き1",
    "- 箇条書き2",
    "",
    "| 役割 | 担当 |",
    "|---|---|",
    "| オーナー | 承認 |",
    "",
    "<img src=x onerror=alert(1)>",
  ].join("\n");

  const question = {
    ...demoQuestions[0],
    id: "DMQ-9999",
    public_id: "99999999-9999-4999-8999-999999999999",
    published: true,
    explanation: mdExplanation,
    choices: demoQuestions[0].choices.map((c) =>
      c.id === 1 ? { ...c, explanation: "**正解理由**：条件に一致する。" } : c,
    ),
  };

  await page.route("**/api/rpc", (r) => {
    const body = r.request().postDataJSON();
    if (body.name === "catalog") {
      return r.fulfill({
        json: { categories: demoCategories, questions: [question] },
      });
    }
    if (body.name === "admin_questions") return r.fulfill({ json: [question] });
    if (body.name === "start_exercise") {
      return r.fulfill({
        json: {
          id: "exercise",
          requested: 1,
          available: 1,
          items: [{ id: "item", sequence: 1, question, choice_order: [1, 2, 3, 4] }],
        },
      });
    }
    if (body.name === "submit_answer") {
      return r.fulfill({
        json: {
          selected: body.args.selected_choice,
          correct: body.args.selected_choice === question.correct,
          correct_choice: question.correct,
          explanation: question.explanation,
        },
      });
    }
    return r.fulfill({ json: null });
  });

  // 1. 管理画面プレビューで確認
  await page.goto("/#admin");
  await page.getByRole("textbox", { name: "問題を検索" }).fill("DMQ-9999");
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  const preview = page.locator("#saved-question-preview");
  await expect(preview.locator(".preview-body h3")).toHaveText("用語整理");
  await expect(preview.locator(".preview-body strong")).toHaveText("重要ポイント");
  await expect(preview.locator(".preview-body li")).toHaveCount(2);
  await expect(preview.locator(".preview-body table th")).toHaveText(["役割", "担当"]);
  await expect(preview.locator(".preview-body img")).toHaveCount(0);
  await expect(preview.locator(".preview-body")).toContainText("<img src=x onerror=alert(1)>");
  await expect(preview.locator(".choice-explanation-detail strong").first()).toHaveText("正解理由");

  // 2. 演習画面で確認
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await page.locator('[data-choice="1"]').click();

  const body = page.locator(".explanation-body");
  await expect(body.locator("h3")).toHaveText("用語整理");
  await expect(body.locator("strong")).toHaveText("重要ポイント");
  await expect(body.locator("li")).toHaveCount(2);
  await expect(body.locator("table td")).toHaveText(["オーナー", "承認"]);
  await expect(body.locator("img")).toHaveCount(0);
  await expect(body).toContainText("<img src=x onerror=alert(1)>");
  await expect(page.locator(".choice-explanation-detail strong").first()).toHaveText("正解理由");
});
