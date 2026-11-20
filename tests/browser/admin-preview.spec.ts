import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("画像のアップロードと保存後のプレビューに最新データを表示する", async ({
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
  let question = {
    ...demoQuestions[0],
    id: "DMQ-0011",
    asset_key: null as string | null,
    published: true,
  };
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
    if (body.name === "admin_save_question") {
      question = { ...body.args.question, asset_key: question.asset_key };
      return r.fulfill({ json: null });
    }
    return r.fulfill({ json: null });
  });
  let authorizedImageReads = 0;
  await page.route("**/api/images/**", (r) => {
    if (r.request().method() === "PUT") {
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
});
