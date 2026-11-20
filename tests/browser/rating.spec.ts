import { test, expect } from "@playwright/test";
import { demoCategories, demoQuestions } from "../../src/demo";
test("星クリックで即保存し連打と失敗後の再評価に対応する", async ({ page }) => {
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
  const q = { ...demoQuestions[0], my_rating: 2 };
  const submitted: number[] = [];
  let release: (() => void) | undefined;
  let fail = true;
  await page.route("**/api/rpc", async (r) => {
    const body = r.request().postDataJSON();
    if (body.name === "catalog")
      return r.fulfill({
        json: { categories: demoCategories, questions: [q] },
      });
    if (body.name === "start_exercise")
      return r.fulfill({
        json: {
          id: "exercise",
          requested: 1,
          available: 1,
          items: [
            {
              id: "item",
              sequence: 1,
              question: q,
              choice_order: [1, 2, 3, 4],
              answer: {
                selected: 1,
                correct: true,
                correct_choice: 1,
                explanation: q.explanation,
              },
            },
          ],
        },
      });
    if (body.name === "rate_question") {
      const stars = body.args.stars;
      submitted.push(stars);
      if (stars === 4)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (stars === 1 && fail) {
        fail = false;
        return r.fulfill({ status: 500, json: { error: "保存失敗" } });
      }
      q.my_rating = stars;
      return r.fulfill({ json: null });
    }
    return r.fulfill({ json: null });
  });
  await page.goto("/#practice");
  await page.getByRole("button", { name: "勉強を始める", exact: true }).click();
  const stars = page.getByRole("group", { name: "このAI問題を評価" });
  await expect(
    stars.getByRole("button", { name: "2点", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(stars.locator(".filled")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "評価を保存", exact: true }),
  ).toHaveCount(0);
  await stars.getByRole("button", { name: "4点", exact: true }).click();
  await expect.poll(() => submitted).toEqual([4]);
  await stars.getByRole("button", { name: "5点", exact: true }).click();
  release!();
  await expect(page.locator("#rating-status")).toContainText(
    "5点で保存しました",
  );
  expect(submitted).toEqual([4, 5]);
  await expect(stars.locator(".filled")).toHaveCount(5);
  await stars.getByRole("button", { name: "1点", exact: true }).click();
  await expect(page.locator("#rating-status")).toContainText(
    "保存できませんでした",
  );
  await stars.getByRole("button", { name: "1点", exact: true }).click();
  await expect(page.locator("#rating-status")).toContainText(
    "1点で保存しました",
  );
  await expect(stars.locator(".filled")).toHaveCount(1);
  expect(submitted).toEqual([4, 5, 1, 1]);
});
