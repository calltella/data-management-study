import { register, type RegistrationEnvironment } from "./registration.ts";
import { createClient } from "@supabase/supabase-js";
import { demoCategories, demoQuestions } from "./demo.ts";
interface AppEnvironment extends RegistrationEnvironment {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  DELETE_AUTH_USER?: string;
  QUESTION_IMAGES?: R2Bucket;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const allowed = new Set([
  "catalog",
  "reveal_question",
  "start_exercise",
  "active_exercise",
  "submit_answer",
  "history",
  "history_by_category",
  "rate_question",
  "reset_history",
  "admin_questions",
  "admin_save_question",
  "prepare_account_deletion",
]);
export default {
  async fetch(request: Request, env: AppEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const configured =
      !!env.SUPABASE_URL &&
      !!env.SUPABASE_PUBLISHABLE_KEY &&
      !env.SUPABASE_URL.includes("YOUR_");
    if (url.pathname === "/api/config")
      return json({
        configured,
        url: configured ? env.SUPABASE_URL : null,
        key: configured ? env.SUPABASE_PUBLISHABLE_KEY : null,
      });
    if (!url.pathname.startsWith("/api/"))
      return new Response("Not found", { status: 404 });
    if (
      request.method !== "GET" &&
      request.headers.get("Origin") !== url.origin
    )
      return json({ error: "同じサイトから操作してください。" }, 403);
    if (
      request.method === "POST" &&
      !request.headers.get("Content-Type")?.includes("application/json")
    )
      return json({ error: "JSON形式で送信してください。" }, 415);
    if (url.pathname === "/api/demo")
      return json({ categories: demoCategories, questions: demoQuestions });
    if (!configured) {
      return json(
        {
          error:
            "Supabase接続が未設定です。ゲスト用サンプル演習をご利用ください。",
        },
        503,
      );
    }
    const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
    const db = createClient(env.SUPABASE_URL!, env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    });
    try {
      if (url.pathname === "/api/register" && request.method === "POST")
        return await register(request, env);
      if (url.pathname === "/api/me") {
        if (!token) return json({ user: null });
        const { data, error } = await db.auth.getUser(token);
        if (error || !data.user)
          return json({ error: "ログインし直してください。" }, 401);
        const status = await db.rpc("dm_account_status");
        if (status.error || !status.data?.active)
          return json(
            { error: "この学習アプリのアカウントは利用停止中です。" },
            403,
          );
        return json({
          user: {
            id: data.user.id,
            email: data.user.email,
            admin: status.data.admin,
          },
        });
      }
      if (url.pathname === "/api/account" && request.method === "DELETE") {
        if (!token) return json({ error: "ログインが必要です。" }, 401);
        if (env.DELETE_AUTH_USER === "true" && !env.SUPABASE_SECRET_KEY)
          return json(
            { error: "アカウント削除の管理用接続が未設定です。" },
            503,
          );
        const { data, error } = await db.auth.getUser(token);
        if (error || !data.user)
          return json({ error: "ログインし直してください。" }, 401);
        const prepared = await db.rpc("dm_prepare_account_deletion");
        if (prepared.error) throw prepared.error;
        if (env.DELETE_AUTH_USER !== "true")
          return json({ ok: true, scope: "application" });
        const admin = createClient(
          env.SUPABASE_URL!,
          env.SUPABASE_SECRET_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const result = await admin.auth.admin.deleteUser(data.user.id);
        if (result.error)
          return json(
            {
              error:
                "履歴は削除済みです。アカウント削除をもう一度実行してください。",
            },
            502,
          );
        return json({ ok: true });
      }
      const diagramChoice = url.searchParams.get("choice");
      const validDiagramChoice = diagramChoice === null || /^[1-4]$/.test(diagramChoice);
      if (url.pathname.startsWith("/api/images/") && request.method === "PUT") {
        if (!env.QUESTION_IMAGES)
          return json({ error: "画像ストレージが未設定です。" }, 503);
        if (!token) return json({ error: "ログインが必要です。" }, 401);
        const status = await db.rpc("dm_account_status");
        if (status.error || !status.data?.admin)
          return json({ error: "管理者権限が必要です。" }, 403);
        const mime = request.headers.get("Content-Type") ?? "";
        if (!["image/png", "image/webp", "image/jpeg"].includes(mime))
          return json(
            { error: "PNG・JPEG・WebPのみアップロードできます。" },
            415,
          );
        if (
          Number(request.headers.get("Content-Length") ?? 0) >
          5 * 1024 * 1024
        )
          return json({ error: "画像は5MB以下にしてください。" }, 413);
        const reader = request.body?.getReader();
        if (!reader) return json({ error: "画像がありません。" }, 400);
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 5 * 1024 * 1024) {
            await reader.cancel();
            return json({ error: "画像は5MB以下にしてください。" }, 413);
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.length;
        }
        const signature =
          mime === "image/png"
            ? bytes[0] === 137 &&
              bytes[1] === 80 &&
              bytes[2] === 78 &&
              bytes[3] === 71
            : mime === "image/jpeg"
              ? bytes[0] === 255 && bytes[1] === 216
              : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
                new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
        if (!signature)
          return json({ error: "画像の形式を確認してください。" }, 400);
        const questionId = decodeURIComponent(
          url.pathname.slice("/api/images/".length),
        );
        if (!validDiagramChoice || (diagramChoice && !/^DMQ-\d+$/.test(questionId)))
          return json({ error: "選択肢を確認してください。" }, 400);
        const key = diagramChoice
          ? `explanations/${questionId}/${diagramChoice}/${crypto.randomUUID()}`
          : `questions/${crypto.randomUUID()}`;
        await env.QUESTION_IMAGES.put(key, bytes, {
          httpMetadata: { contentType: mime },
        });
        if (diagramChoice) return json({ ok: true, key });
        const saved = await db.rpc("dm_admin_set_asset", {
          question_id: questionId,
          object_key: key,
        });
        if (saved.error) {
          await env.QUESTION_IMAGES.delete(key);
          return json({ error: saved.error.message }, 400);
        }
        return json({ ok: true, key });
      }
      if (url.pathname.startsWith("/api/images/") && request.method === "GET") {
        if (!env.QUESTION_IMAGES)
          return json({ error: "画像ストレージが未設定です。" }, 503);
        const id = decodeURIComponent(
          url.pathname.slice("/api/images/".length),
        );
        const { data, error } = await db.rpc("dm_reveal_question", {
          question_id: id,
        });
        const key = diagramChoice
          ? data?.choices?.find((choice: { id: number }) => choice.id === Number(diagramChoice))?.diagram_key
          : data?.asset_key;
        if (error || !validDiagramChoice || typeof key !== "string" || !key ||
            (diagramChoice && (!/^DMQ-\d+$/.test(id) || !key.startsWith(`explanations/${id}/${diagramChoice}/`))))
          return json({ error: "画像がありません。" }, 404);
        const obj = await env.QUESTION_IMAGES.get(key);
        if (!obj) return json({ error: "画像がありません。" }, 404);
        return new Response(obj.body, {
          headers: {
            "Content-Type":
              obj.httpMetadata?.contentType ?? "application/octet-stream",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (url.pathname !== "/api/rpc" || request.method !== "POST")
        return json({ error: "APIが見つかりません。" }, 404);
      const reader = request.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            return json({ error: "入力が大きすぎます。" }, 413);
          }
          chunks.push(value);
        }
      }
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }
      const body = JSON.parse(new TextDecoder().decode(raw)) as {
        name: string;
        args?: Record<string, unknown>;
      };
      if (!allowed.has(body.name))
        return json({ error: "許可されていない操作です。" }, 400);
      const start = performance.now();
      const result = await db.rpc(`dm_${body.name}`, body.args ?? {});
      const duration = performance.now() - start;
      console.log(
        JSON.stringify({
          event: "rpc",
          operation: body.name,
          durationMs: Math.round(duration),
          ok: !result.error,
        }),
      );
      if (result.error) return json({ error: result.error.message }, 400);
      const response = json(result.data);
      response.headers.set(
        "Server-Timing",
        `database;dur=${duration.toFixed(1)}`,
      );
      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "api_error",
          type: error instanceof Error ? error.name : "upstream",
        }),
      );
      return json(
        { error: "処理に失敗しました。もう一度お試しください。" },
        500,
      );
    }
  },
} satisfies ExportedHandler<AppEnvironment>;
