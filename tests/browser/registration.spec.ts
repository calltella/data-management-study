import { test, expect } from "@playwright/test";
test("新規登録はメールだけ送信し、ログインにはパスワードを表示", async ({
  page,
}) => {
  await page.route("**/api/register", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "new@example.com",
    });
    await route.fulfill({
      json: { ok: true, message: "登録が完了しました。" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "新規登録", exact: true }).click();
  await expect(page.getByLabel("パスワード", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "登録確認メールを送る" }),
  ).toHaveCount(0);
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("new@example.com");
  await page
    .getByRole("button", { name: "登録してパスワードを受け取る" })
    .click();
  await expect(page.getByRole("status")).toContainText("登録が完了しました");
  await page
    .getByRole("button", { name: "ログイン", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("パスワード", { exact: true })).toBeVisible();
});
