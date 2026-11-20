import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "../src/registration.ts";
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-secret",
  MAILGUN_API_KEY: "test-mail-key",
  MAILGUN_DOMAIN: "mg.example.com",
  MAILGUN_FROM: "DM STUDY <no-reply@mg.example.com>",
};
const req = (email = "new@example.com") =>
  new Request("http://localhost/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
function backend({
  mailFails = false,
  existing = false,
  activationFails = false,
} = {}) {
  const events = [];
  let createdPassword = "";
  const transport = async (url, init = {}) => {
    const u = String(url),
      method = init.method ?? "GET";
    if (u.endsWith("/auth/v1/admin/users") && method === "POST") {
      events.push("create");
      if (existing)
        return Response.json(
          { msg: "already registered", code: "email_exists", error_code: "email_exists" },
          { status: 422 },
        );
      const body = JSON.parse(init.body);
      createdPassword = body.password;
      assert.equal(body.email_confirm, false);
      return Response.json({
        user: { id: "33333333-3333-4333-8333-333333333333", email: "new@example.com" },
      });
    }
    if (u.includes("mailgun.net/")) {
      events.push("mail");
      assert.equal(init.body.get("to"), "new@example.com");
      assert.ok(createdPassword.length >= 32);
      assert.ok(init.body.get("text").includes(createdPassword));
      return Response.json(
        mailFails ? { message: "failed" } : { id: "accepted" },
        { status: mailFails ? 500 : 200 },
      );
    }
    if (u.endsWith("/auth/v1/admin/users/33333333-3333-4333-8333-333333333333") && method === "PUT") {
      events.push("activate");
      assert.equal(JSON.parse(init.body).email_confirm, true);
      return Response.json(
        activationFails ? { msg: "failed" } : { user: { id: "33333333-3333-4333-8333-333333333333" } },
        { status: activationFails ? 500 : 200 },
      );
    }
    if (u.endsWith("/auth/v1/admin/users/33333333-3333-4333-8333-333333333333") && method === "DELETE") {
      events.push("delete-33333333-3333-4333-8333-333333333333");
      return Response.json({ user: { id: "33333333-3333-4333-8333-333333333333" } });
    }
    if(u.endsWith("/auth/v1/admin/users/33333333-3333-4333-8333-333333333333") && method==="GET") return Response.json({user:{id:"33333333-3333-4333-8333-333333333333"}});
    throw new Error("Unexpected transport call");
  };
  return { events, transport, getPassword: () => createdPassword };
}
test("登録はメール送信後に有効化し、レスポンスへパスワードを含めない", async () => {
  const b = backend();
  const r = await register(req(), env, b.transport);
  assert.equal(r.status, 200);
  assert.deepEqual(b.events, ["create", "mail", "activate"]);
  assert.ok(!(await r.text()).includes(b.getPassword()));
});
test("メール送信失敗時は新しく作成した利用者だけを取り消す", async () => {
  const b = backend({ mailFails: true });
  const r = await register(req(), env, b.transport);
  assert.equal(r.status, 502);
  assert.deepEqual(b.events, ["create", "mail", "delete-33333333-3333-4333-8333-333333333333"]);
});
test("登録済みアドレスのパスワードを変更せずメールも送らない", async () => {
  const b = backend({ existing: true });
  const r = await register(req(), env, b.transport);
  assert.equal(r.status, 409);
  assert.deepEqual(b.events, ["create"]);
});
test("有効化失敗時にも登録完了とせず新規利用者を取り消す", async () => {
  const b = backend({ activationFails: true });
  const r = await register(req(), env, b.transport);
  assert.equal(r.status, 502);
  assert.deepEqual(b.events, ["create", "mail", "activate", "delete-33333333-3333-4333-8333-333333333333"]);
});
test("設定未完了・不正メール・レート上限では外部への登録要求をしない", async () => {
  const b = backend();
  assert.equal((await register(req(), {}, b.transport)).status, 503);
  assert.equal(
    (await register(req("bad\r\n@example.com"), env, b.transport)).status,
    400,
  );
  assert.equal(
    (
      await register(
        req(),
        {
          ...env,
          REGISTRATION_LIMITER: { limit: async () => ({ success: false }) },
        },
        b.transport,
      )
    ).status,
    429,
  );
  assert.deepEqual(b.events, []);
});
