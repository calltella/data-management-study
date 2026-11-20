import { createClient } from "@supabase/supabase-js";
export interface RegistrationEnvironment {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  MAILGUN_FROM?: string;
  MAILGUN_REGION?: string;
  REGISTRATION_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}
const result = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function register(
  request: Request,
  env: RegistrationEnvironment,
  transport: typeof fetch = fetch,
): Promise<Response> {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SECRET_KEY ||
    !env.MAILGUN_API_KEY ||
    !env.MAILGUN_DOMAIN ||
    !env.MAILGUN_FROM
  )
    return result(
      {
        error:
          "新規登録のメール送信設定が準備中です。しばらくしてからお試しください。",
      },
      503,
    );
  if (
    !/^[a-zA-Z0-9.-]+$/.test(env.MAILGUN_DOMAIN) ||
    /[\r\n]/.test(env.MAILGUN_FROM)
  )
    return result({ error: "メール送信設定を確認してください。" }, 503);
  const limit = await env.REGISTRATION_LIMITER?.limit({
    key: request.headers.get("CF-Connecting-IP") ?? "local",
  });
  if (limit && !limit.success)
    return result(
      { error: "登録要求が多すぎます。1分ほど待ってからお試しください。" },
      429,
    );
  const reader = request.body?.getReader();
  if (!reader)
    return result({ error: "メールアドレスを入力してください。" }, 400);
  let raw = "";
  const decoder = new TextDecoder();
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) {
      await reader.cancel();
      return result({ error: "入力が大きすぎます。" }, 413);
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  let email: string;
  try {
    const body = JSON.parse(raw);
    email = typeof body.email === "string" ? body.email.trim() : "";
  } catch {
    return result({ error: "入力を確認してください。" }, 400);
  }
  if (
    email.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
    /[\r\n]/.test(email)
  )
    return result({ error: "正しいメールアドレスを入力してください。" }, 400);
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport },
  });
  const password =
    "Aa1!" +
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
  let id: string | null = null;
  try {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });
    if (created.error) {
      if (
        ["email_exists", "user_already_exists"].includes(
          created.error.code ?? "",
        )
      )
        return result(
          {
            error:
              "このメールアドレスは登録済みです。ログイン、またはパスワード再設定をご利用ください。",
          },
          409,
        );
      return result(
        {
          error: "登録できませんでした。入力内容を確認して再度お試しください。",
        },
        502,
      );
    }
    id = created.data.user?.id ?? null;
    if (!id) throw new Error("creation_failed");
    const form = new FormData();
    form.set("from", env.MAILGUN_FROM);
    form.set("to", email);
    form.set("subject", "【DM STUDY】ログイン用パスワードのお知らせ");
    form.set(
      "text",
      `DM STUDYへのご登録ありがとうございます。\n\nメールアドレス：${email}\nパスワード：${password}\n\nこのメールの送信処理が完了すると登録完了となります。確認リンクの操作は不要です。\nログイン画面からメールアドレスと上記パスワードでログインしてください。\n\n登録に心当たりがない場合、このメールを破棄してください。\nDM STUDY`,
    );
    const host =
      env.MAILGUN_REGION === "EU" ? "api.eu.mailgun.net" : "api.mailgun.net";
    const sent = await transport(
      `https://${host}/v3/${env.MAILGUN_DOMAIN}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa("api:" + env.MAILGUN_API_KEY),
        },
        body: form,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!sent.ok) throw new Error("mail_failed");
    // メール受付完了まではログイン不可。リンク操作なしで有効化する。
    const activated = await admin.auth.admin.updateUserById(id, {
      email_confirm: true,
    });
    if (activated.error) throw new Error("activation_failed");
    return result({
      ok: true,
      message:
        "登録が完了しました。メールに記載されたパスワードでログインしてください。",
    });
  } catch {
    if (id) {
      try {
        const rollback = await admin.auth.admin.deleteUser(id);
        if (rollback.error) throw new Error("rollback_failed");
      } catch {
        console.error(
          JSON.stringify({
            event: "registration_cleanup_required",
            userId: id,
          }),
        );
        return result(
          {
            error: "登録を完了できませんでした。管理者へお問い合わせください。",
          },
          502,
        );
      }
    }
    return result(
      {
        error:
          "登録を完了できませんでした。メール送信状況を確認のうえ、もう一度お試しください。",
      },
      502,
    );
  }
}
