import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("現在のパスワードが一致するときだけパスワードを変更する", async ({
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
  await page.route("**/api/rpc", (r) =>
    r.fulfill({
      json: { categories: demoCategories, questions: demoQuestions },
    }),
  );
  let updates = 0;
  let signins = 0;
  await page.route("https://example.supabase.co/auth/v1/token**", async (r) => {
    signins++;
    const body = r.request().postDataJSON();
    expect(body.email).toBe(user.email);
    if (body.password !== "current-password")
      return r.fulfill({
        status: 400,
        json: { error_code: "invalid_credentials", msg: "Invalid login credentials" },
      });
    const session = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("sb-example-auth-token")!),
    );
    return r.fulfill({ json: { ...session, user } });
  });
  await page.route("https://example.supabase.co/auth/v1/user", (r) => {
    if (r.request().method() === "PUT") {
      updates++;
      expect(r.request().postDataJSON()).toMatchObject({
        password: "new-password",
        current_password: "current-password",
      });
    }
    return r.fulfill({ json: user });
  });
  await page.goto("/#account");
  const current = page.getByLabel("現在のパスワード", { exact: true });
  const next = page.getByLabel("新しいパスワード", { exact: true });
  const confirmation = page.getByLabel("新しいパスワード（確認）", {
    exact: true,
  });
  const submit = page.getByRole("button", {
    name: "パスワードを変更する",
    exact: true,
  });
  const status = page.locator("#change-password-status");
  await current.fill("incorrect-password");
  await next.fill("new-password");
  await confirmation.fill("different-password");
  await submit.click();
  await expect(status).toContainText("一致しません");
  expect(signins).toBe(0);
  expect(updates).toBe(0);
  await confirmation.fill("new-password");
  await submit.click();
  await expect(status).toContainText("現在のパスワードが正しくありません");
  expect(updates).toBe(0);
  await current.fill("current-password");
  await submit.click();
  await expect(status).toHaveText("パスワードを変更しました。");
  expect(updates).toBe(1);
  await expect(current).toHaveValue("");
  await expect(next).toHaveValue("");
  await expect(confirmation).toHaveValue("");
});
