import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("管理画面と演習画面から問題・解説を編集できる", async ({
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
  let administrator = true;
  await page.route("**/api/me", (r) =>
    r.fulfill({
      json: { user: { id: user.id, email: user.email, admin: administrator } },
    }),
  );
  let question = {
    ...demoQuestions[0],
    id: "DMQ-0011",
    public_id: "834e9ce2-c58a-4a50-8aa2-21188cb3dc4a",
    asset_key: null as string | null,
    published: true,
  };
  let refuseSave = false;
  await page.route("**/api/rpc", (r) => {
    const body = r.request().postDataJSON();
    if (body.name === "catalog")
      return r.fulfill({
        json: {
          categories: demoCategories,
          questions: question.published ? [question] : [],
        },
      });
    if (body.name === "admin_questions") return r.fulfill({ json: [question] });
    if (body.name === "start_exercise")
      return r.fulfill({ json: { id: "exercise", requested: 1, available: 1, items: [
        { id: "item", sequence: 1, question, choice_order: [2, 1, 3, 4] },
      ] } });
    if (body.name === "submit_answer")
      return r.fulfill({ json: {
        selected: body.args.selected_choice, correct: body.args.selected_choice === question.correct,
        correct_choice: question.correct, explanation: question.explanation,
      } });
    if (body.name === "admin_save_question") {
      if (refuseSave) return r.fulfill({ status: 500, json: { error: "保存に失敗しました" } });
      question = { ...body.args.question, asset_key: question.asset_key };
      return r.fulfill({ json: null });
    }
    return r.fulfill({ json: null });
  });
  let authorizedImageReads = 0;
  await page.route("**/api/images/**", (r) => {
    if (r.request().method() === "PUT") {
      if (new URL(r.request().url()).searchParams.get("choice") === "1")
        return r.fulfill({ json: { ok: true, key: "explanations/DMQ-0011/1/test" } });
      question.asset_key = "questions/uploaded";
      return r.fulfill({ json: { ok: true, key: question.asset_key } });
    }
    if (r.request().headers().authorization?.startsWith("Bearer "))
      authorizedImageReads++;
    return r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="green"/></svg>',
    });
  });
  await page.goto("/#admin");
  const questionSearch = page.getByRole("textbox", { name: "問題を検索" });
  await questionSearch.fill("00000000-0000-0000-0000-000000000000");
  await expect(page.locator("#admin-no-results")).toBeVisible();
  await questionSearch.fill(question.public_id.toUpperCase());
  await expect(page.locator('[data-edit="DMQ-0011"]')).toBeVisible();
  await page.locator('[data-edit="DMQ-0011"]').click();
  await page
    .locator("#asset-file")
    .setInputFiles({
      name: "figure.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XcAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page
    .getByRole("button", { name: "図表をアップロード", exact: true })
    .click();
  await expect(
    page.getByText("画像を保存しました。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByAltText("現在の図表")).toBeVisible();
  await page.getByLabel("タイトル", { exact: true }).fill("保存したタイトル");
  await page.locator('textarea[name="body"]').fill("保存した問題文");
  await page.locator('textarea[name="explanation"]').fill("保存した解説");
  await page.getByLabel("公開する", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  const preview = page.locator("#saved-question-preview");
  await expect(preview).toContainText("保存したタイトル");
  await expect(preview).toContainText("保存した問題文");
  await expect(preview).toContainText("保存した解説");
  await expect(preview).toContainText("非公開");
  await expect(page.getByAltText("保存した問題の図表")).toBeVisible();
  await expect.poll(() => authorizedImageReads).toBeGreaterThan(0);
  await page.getByRole("button", { name: "もう一度編集する" }).click();
  await expect(page.getByLabel("タイトル", { exact: true })).toHaveValue(
    "保存したタイトル",
  );

  await page.getByLabel("公開する", { exact: true }).check();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(preview).toContainText("／ 公開");
  await page.goto("/#practice");
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.getByRole("button", { name: "解説を編集" })).toHaveCount(0);
  await expect(page.locator(".question-public-id")).toContainText(question.public_id);
  const problemEdit = page.getByRole("button", { name: "問題を編集", exact: true });
  await problemEdit.click();
  const dialog = page.getByRole("dialog", { name: "出題内容を編集" });
  const bodyInput = dialog.getByRole("textbox", { name: "問題文", exact: true });
  await expect(bodyInput).toBeFocused();
  await bodyInput.fill("演習画面から修正した問題文");
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".question-body")).toHaveText("演習画面から修正した問題文");
  await expect(page.locator(".explanation")).toHaveCount(0);

  await page.locator('[data-choice="1"]').click();
  await page.getByRole("button", { name: "解説を編集", exact: true }).click();
  const explanationInput = dialog.getByRole("textbox", { name: "解説", exact: true });
  await expect(explanationInput).toBeFocused();
  await explanationInput.fill("演習中に更新した全体解説");
  await dialog.getByRole("textbox", { name: "アの解説", exact: true }).fill("演習中に更新した個別解説");
  await dialog.locator('input[name="choice-diagram-1"]').setInputFiles("public/ipa-original/DMQ-0068.png");
  refuseSave = true;
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("保存に失敗しました");
  await expect(explanationInput).toHaveValue("演習中に更新した全体解説");
  refuseSave = false;
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".explanation")).toContainText("演習中に更新した全体解説");
  const editedChoice = page.locator(".choice-explanation").filter({ hasText: "演習中に更新した個別解説" });
  await expect(editedChoice.locator(".choice-explanation-label")).toHaveText("イ");
  const editedDiagram = editedChoice.locator("img");
  await expect(editedDiagram).toHaveAttribute("src", /choice=1&v=explanations/);
  await editedDiagram.evaluate((image: HTMLImageElement) => image.decode());
  await expect(page.locator(".explanation h2")).toHaveText("正解です · 正解：イ");
  await expect(page.locator('[data-choice="1"]')).toBeDisabled();

  administrator = false;
  await page.reload();
  await page.getByRole("button", { name: "最初から出題する", exact: true }).click();
  await expect(page.getByRole("button", { name: "問題を編集" })).toHaveCount(0);
  await page.locator('[data-choice="1"]').click();
  await expect(page.locator(".explanation")).toBeVisible();
  await expect(page.getByRole("button", { name: "解説を編集" })).toHaveCount(0);
});
