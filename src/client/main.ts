import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import {
  shuffled,
  includesCategory,
  orderedCategories,
  relabelExplanation,
  type Category,
  type Question,
  type Exercise,
  type ExerciseItem,
} from "../model.ts";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let auth: SupabaseClient | null = null,
  session: Session | null = null,
  admin = false,
  configured = false;
let categories: Category[] = [],
  questions: Question[] = [],
  exercise: Exercise | null = null,
  index = 0,
  revealed: Question | null = null;
let pending: { item: string; selected: number } | null = null,
  notice = "",
  authMode = "login",
  authMessage = "",
  busy = false;
let categorySelectionInitialized = false;
let selectedCategories: string[] = [],
  count = 10,
  shuffle = false,
  wrong = false,
  page = 0;
let historyCategory = "";
const adminFilters = { major: "", middle: "", minor: "", term: "" };
const ratingStates = new Map<
  string,
  { value: number; saved: number; saving: boolean }
>();
const labels = ["ア", "イ", "ウ", "エ"];
const icon = '<img src="/logo.svg" alt="" width="34" height="34">';
function header() {
  return `<header><a class="brand" href="#login">${icon}<span>DM STUDY</span></a><span class="subtitle">データマネジメント試験・科目A</span><nav><a href="#practice">学習する</a>${session ? '<a href="#history">学習履歴</a><a href="#account">マイページ</a>' : '<a href="#login">ログイン</a>'}${admin ? '<a href="#admin">管理者</a>' : ""}</nav></header>`;
}
const adminImageUrls = new Set<string>();
function releaseAdminImages() {
  for (const url of adminImageUrls) URL.revokeObjectURL(url);
  adminImageUrls.clear();
}
function render(content: string) {
  releaseAdminImages();
  app.innerHTML =
    header() +
    `<main>${!configured ? '<div class="banner">サンプルモード · 動作確認用の問題を出題します。回答履歴は保存しません。</div>' : ""}${notice ? `<div role="status" class="notice">${esc(notice)}</div>` : ""}${content}</main><footer>DM STUDY · 科目Aの非公式学習支援アプリ</footer>`;
  bind();
}
async function request<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data } = auth
    ? await auth.auth.getSession()
    : { data: { session: null } };
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(data.session
        ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    body: JSON.stringify({ name, args }),
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "通信に失敗しました。");
  return body;
}
async function load() {
  if (configured) {
    const catalog = await request<{
      categories: Category[];
      questions: Question[];
    }>("catalog");
    categories = orderedCategories(catalog.categories);
    questions = catalog.questions;
  } else {
    const data = (await (await fetch("/api/demo")).json()) as {
      categories: Category[];
      questions: Question[];
    };
    categories = orderedCategories(data.categories);
    questions = data.questions;
  }
  if (exercise) {
    const latest = new Map(questions.map((q) => [q.id, q]));
    for (const item of exercise.items) {
      const q = latest.get(item.question.id);
      if (q) item.question = q;
    }
  }
  if (!categorySelectionInitialized) {
    selectedCategories = categories
      .filter((c) => c.level === 1)
      .map((c) => c.id);
    categorySelectionInitialized = true;
  }
}
function button(
  text: string,
  action: string,
  secondary = false,
  disabled = false,
) {
  return `<button data-action="${action}" class="${secondary ? "secondary" : ""}" ${disabled ? "disabled" : ""}>${text}</button>`;
}
function login() {
  const title =
    authMode === "register"
      ? "新規登録"
      : authMode === "reset"
        ? "パスワードを忘れた方"
        : authMode === "password"
          ? "新しいパスワード"
          : "おかえりなさい";
  render(
    `<div class="login-layout"><section class="welcome"><span class="eyebrow">LEARN EVERY DAY</span><h1>毎日の一問が、<br>確かな理解につながる。</h1><p>分野を選んで演習。解説を読んで、苦手を復習。<br>あなたのペースで、科目Aの学習を進めましょう。</p><div class="callout"><h2>登録なしでも、今すぐ一問。</h2><p>ゲストの回答履歴・中断位置は保存されません。</p><a class="button secondary" href="#practice">ログインせずに始める</a></div><section class="exam-info"><h2>2027年度開始予定の新しい試験に向けて</h2><p>データマネジメント試験（仮称）の科目Aを学ぶアプリです。IPA公表のシラバス案を参考にした非公式の学習支援です。</p><p class="small">名称・実施予定は変更される場合があります。</p><a target="_blank" rel="noopener noreferrer" href="https://www.ipa.go.jp/shiken/syllabus/henkou/2026/20260630.html">IPA公式：試験概要・シラバス案 ↗</a><br><a target="_blank" rel="noopener noreferrer" href="https://www.ipa.go.jp/shiken/syllabus/henkou/2026/20260622.html">IPA公式：サンプル問題 ↗</a></section></section><section class="card auth-card"><h2>${title}</h2><p class="muted">${authMode === "register" ? "メールアドレスだけで登録できます。ログイン用パスワードをメールでお送りします。確認リンクの操作は不要です。" : session ? "ログインしています。演習を始められます。" : "ログインして学習の続きを始めましょう。"}</p><form id="auth-form">${authMode !== "password" ? '<label>メールアドレス<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>' : ""}${authMode === "login" || authMode === "password" ? '<label>パスワード<input name="password" type="password" minlength="8" autocomplete="' + (authMode === "login" ? "current-password" : "new-password") + '" required placeholder="8文字以上"></label>' : ""}<button ${!configured ? "disabled" : ""}>${authMode === "login" ? "ログイン" : authMode === "register" ? "登録してパスワードを受け取る" : authMode === "reset" ? "再設定リンクを送る" : "パスワードを変更"}</button></form><p role="status">${esc(authMessage)}</p><div class="auth-links">${button("ログイン", "mode-login", true)}${button("新規登録", "mode-register", true)}${button("パスワードを忘れた方", "mode-reset", true)}</div></section></div>`,
  );
  document
    .querySelector("#auth-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!auth || busy) return;
      busy = true;
      const f = new FormData(e.target as HTMLFormElement);
      try {
        let error;
        const email = String(f.get("email") ?? ""),
          password = String(f.get("password") ?? "");
        const redirect = location.origin + "/?recovery=1#login";
        if (authMode === "login")
          ({ error } = await auth.auth.signInWithPassword({ email, password }));
        else if (authMode === "register") {
          const response = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          const data = (await response.json()) as {
            ok?: boolean;
            message?: string;
            error?: string;
          };
          if (!response.ok || !data.ok)
            throw new Error(data.error ?? "登録できませんでした。");
        } else if (authMode === "reset")
          ({ error } = await auth.auth.resetPasswordForEmail(email, {
            redirectTo: redirect,
          }));
        else ({ error } = await auth.auth.updateUser({ password }));
        if (error) throw error;
        authMessage =
          authMode === "register"
            ? "登録が完了しました。メールに記載されたパスワードでログインしてください。"
            : authMode === "reset"
              ? "対象のアカウントがある場合、再設定メールを送信しました。"
              : authMode === "password"
                ? "パスワードを変更しました。"
                : "";
        if (authMode === "login") {
          await syncUser();
          location.hash = "practice";
          await route();
        } else login();
      } catch (error) {
        authMessage = message(error);
        login();
      } finally {
        busy = false;
      }
    });
}
function categoryOptions() {
  return categories
    .filter((c) => c.level === 1)
    .map((c) => {
      const registered = questions.filter((q) =>
        includesCategory(q.category_id, [c.id], categories),
      ).length;
      return `<label class="check level-1"><input type="checkbox" name="category" value="${esc(c.id)}" ${selectedCategories.includes(c.id) ? "checked" : ""}>${esc(c.name)} <span class="small muted">（${registered}問）</span></label>`;
    })
    .join("");
}
function practice() {
  if (exercise) {
    showQuestion();
    return;
  }
  render(
    `<div class="section-heading"><div><span class="eyebrow">YOUR PRACTICE</span><h1>今日の学習を始めましょう。</h1><p class="muted">分野を選んで、自分のペースで取り組めます。</p></div>${session ? button("中断中の演習を再開", "resume", true) : ""}</div><form id="practice-form" class="card setup"><h2>出題条件</h2><div class="categories">${categoryOptions()}<div class="category-actions"><button type="button" class="secondary" data-category-selection="all">全選択</button><button type="button" class="secondary" data-category-selection="none">全解除</button></div><div class="settings"><label>出題数<select name="count">${[10, 15, 20, 25, 30, 0].map((n) => `<option value="${n}" ${count === n ? "selected" : ""}>${n || "全部"}</option>`).join("")}</select></label><label class="check"><input name="shuffle" type="checkbox" ${shuffle ? "checked" : ""}>選択肢を並べ替える</label><label class="check"><input name="wrong" type="checkbox" ${wrong ? "checked" : ""} ${!session ? "disabled" : ""}>最後の回答が不正解の問題だけ</label></div></div><p>${session ? "未回答の問題を優先し、足りない分は回答済みから出題します。回答履歴を記録します。未完了の演習は1件保存できます。" : "ゲストの履歴・中断位置は保存されません。"}</p><button>勉強を始める</button><span class="small"> 公開問題 ${questions.length}問</span></form>`,
  );
  const categoryInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="category"]'),
  );
  const syncCategories = () => {
    selectedCategories = categoryInputs
      .filter((input) => input.checked)
      .map((input) => input.value);
  };
  categoryInputs.forEach((input) =>
    input.addEventListener("change", syncCategories),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-category-selection]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          categoryInputs.forEach((input) => {
            input.checked = button.dataset.categorySelection === "all";
          });
          syncCategories();
        }),
    );
  document
    .querySelector("#practice-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const f = new FormData(e.target as HTMLFormElement);
      selectedCategories = f.getAll("category").map(String);
      count = Number(f.get("count"));
      shuffle = f.has("shuffle");
      wrong = f.has("wrong");
      if (!selectedCategories.length) {
        notice = "分類を1つ以上選択してください。";
        practice();
        return;
      }
      await start();
    });
}
async function start(replace = false) {
  busy = true;
  try {
    if (session)
      exercise = await request<Exercise>("start_exercise", {
        category_ids: selectedCategories,
        question_count: count,
        wrong_only: wrong,
        shuffle_choices: shuffle,
        replace_existing: replace,
      });
    else {
      const candidates = shuffled(
        questions.filter((q) =>
          includesCategory(q.category_id, selectedCategories, categories),
        ),
      ).slice(0, count || undefined);
      if (!candidates.length)
        throw new Error("条件に合う問題がありません。分類を変更してください。");
      exercise = {
        id: crypto.randomUUID(),
        requested: count || candidates.length,
        available: candidates.length,
        items: candidates.map((q, i) => ({
          id: crypto.randomUUID(),
          sequence: i,
          question: q,
          choice_order: shuffle
            ? shuffled(q.choices.map((c) => c.id))
            : q.choices.map((c) => c.id),
        })),
      };
    }
    index = 0;
    revealed = null;
    pending = null;
    notice =
      exercise.available < count
        ? `指定は${count}問ですが、条件に合う問題は${exercise.available}問です。全${exercise.available}問を出題します。`
        : "";
    showQuestion();
  } catch (error) {
    notice = message(error);
    practice();
    if (notice.includes("中断中")) {
      const node = document.querySelector(".setup");
      node?.insertAdjacentHTML(
        "beforeend",
        button("中断中の演習を置き換えて始める", "replace", true),
      );
      bind();
    }
  } finally {
    busy = false;
  }
}
function current(): ExerciseItem | undefined {
  return exercise?.items[index];
}
function showQuestion() {
  const item = current();
  if (!item) {
    render(
      `<section class="card completed"><span class="eyebrow">WELL DONE</span><h1>演習が完了しました。</h1><p>${exercise?.items.filter((i) => i.answer?.correct).length ?? 0}問正解 ／ ${exercise?.items.length ?? 0}問</p>${button("新しい演習へ", "finish")}${session ? '<a href="#history">履歴を確認する →</a>' : ""}</section>`,
    );
    return;
  }
  const q = item.question,
    answer = item.answer;
  const explanation = answer?.explanation ?? revealed?.explanation,
    correct = answer?.correct_choice ?? revealed?.correct;
  const breadcrumb = categories.find((c) => c.id === q.category_id)?.name ?? "";
  render(
    `<div class="exercise-layout"><aside class="card"><h2>今回の演習</h2><p>${exercise!.items.length}問の演習</p><p class="muted">${esc(breadcrumb)}</p><p>${session ? "回答履歴を記録します" : "ゲスト · 履歴は保存しません"}</p>${button(session ? "中断して保存" : "演習を終了", "suspend", true)}${button("出題条件へ戻る", "conditions", true)}</aside><section class="card question"><div class="question-meta"><span class="eyebrow">QUESTION ${String(index + 1).padStart(2, "0")} / ${exercise!.items.length}</span><span class="badge">${q.origin === "ai_original" ? "AIオリジナル" : q.origin === "ipa_sample" ? "IPA公式サンプル" : "IPA過去問"}</span></div><progress max="${exercise!.items.length}" value="${index + 1}" aria-label="演習の進捗"></progress><p class="muted small">${esc(breadcrumb)}</p><h1>${esc(q.body)}</h1>${q.asset_key ? `<figure class="question-figure"><button type="button" id="question-image-trigger" class="question-image-trigger" aria-label="問題の図表を拡大"><img class="question-image" src="/api/images/${encodeURIComponent(q.id)}" alt="問題の図表"></button><figcaption>図を押すと拡大できます</figcaption></figure><dialog id="question-image-dialog" class="image-dialog" aria-label="問題の図表（拡大）"><button type="button" id="close-question-image" class="secondary">閉じる</button><img src="/api/images/${encodeURIComponent(q.id)}" alt="問題の図表（拡大）"></dialog>` : ""}<p class="small muted">${esc(q.source)}</p><div class="choices">${item.choice_order
      .map((id, pos) => {
        const c = q.choices.find((v) => v.id === id)!;
        return `<button class="choice ${correct === id ? "correct" : ""} ${answer?.selected === id ? "selected" : ""}" data-choice="${id}" ${answer || pending ? "disabled" : ""}><span class="choice-label">${labels[pos]}</span><span>${esc(c.body)}</span>${shuffle ? `<small>元の${labels[id - 1]}</small>` : ""}</button>`;
      })
      .join(
        "",
      )}</div>${!answer ? '<p class="small muted">選択すると回答が確定します。回答後の変更はできません。</p>' : ""}${pending ? `<div role="alert" class="notice">回答が保存されていません。接続を確認して再試行してください。${button("同じ回答を再送する", "retry", true)}</div>` : ""}${
      explanation
        ? `<section class="explanation"><h2>${answer ? (answer.correct ? "正解です" : "不正解です") : "正答・解説"} · 正答：${labels[item.choice_order.indexOf(correct!)]}</h2><p>${esc(relabelExplanation(explanation, item.choice_order))}</p>${shuffle ? '<p class="small">原文中の記号は「元のア」等の対応を参照してください。</p>' : ""}${item.choice_order
            .map((id, pos) => {
              const c = q.choices.find((c) => c.id === id);
              return c?.explanation
                ? `<p><strong>${labels[pos]}</strong> ${esc(c.explanation)}</p>`
                : "";
            })
            .join(
              "",
            )}${answer ? `<p class="small">${session ? "回答を保存しました" : "ゲストの回答は保存していません"}</p>` : ""}</section>`
        : ""
    }<div class="actions">${!answer && !revealed ? button("先に正答・解説を見る", "reveal", true) : ""}${answer || revealed ? button(index === exercise!.items.length - 1 ? "演習を終了" : "次の問題へ", "next") : ""}</div>${session && q.origin === "ai_original" && explanation ? `<div class="rating" data-rating-question="${esc(q.id)}"><span id="rating-label">このAI問題を評価</span><div class="rating-stars" role="group" aria-labelledby="rating-label">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star" data-rating="${n}" aria-label="${n}点" aria-pressed="false">☆</button>`).join("")}</div><span class="small" id="rating-status" role="status" aria-live="polite"></span></div>` : ""}</section></div>`,
  );
  if (session && q.origin === "ai_original" && explanation) bindRating(q);
  const imageDialog = document.querySelector<HTMLDialogElement>(
    "#question-image-dialog",
  );
  const imageTrigger = document.querySelector<HTMLButtonElement>(
    "#question-image-trigger",
  );
  if (imageDialog && imageTrigger) {
    imageTrigger.onclick = () => imageDialog.showModal();
    document.querySelector<HTMLButtonElement>(
      "#close-question-image",
    )!.onclick = () => imageDialog.close();
    imageDialog.onclick = (e) => {
      if (e.target === imageDialog) imageDialog.close();
    };
  }
  document
    .querySelectorAll<HTMLButtonElement>("[data-choice]")
    .forEach((b) => (b.onclick = () => void submit(Number(b.dataset.choice))));
}
function bindRating(q: Question) {
  const ratingUserId = session!.user.id;
  const key = `${ratingUserId}:${q.id}`;
  let state = ratingStates.get(key);
  if (!state) {
    const saved = q.my_rating ?? revealed?.my_rating ?? 0;
    state = { value: saved, saved, saving: false };
    ratingStates.set(key, state);
  }
  const rating = state;
  const paint = (status: string) => {
    const root = document.querySelector<HTMLElement>("[data-rating-question]");
    if (
      !root ||
      root.dataset.ratingQuestion !== q.id ||
      session?.user.id + ":" + q.id !== key
    )
      return;
    root
      .querySelectorAll<HTMLButtonElement>("[data-rating]")
      .forEach((button) => {
        const n = Number(button.dataset.rating);
        button.textContent = n <= rating.value ? "★" : "☆";
        button.setAttribute("aria-pressed", String(n === rating.value));
        button.classList.toggle("filled", n <= rating.value);
      });
    root.querySelector("#rating-status")!.textContent = status;
  };
  paint(
    rating.saving
      ? "保存中…"
      : rating.value !== rating.saved
        ? "未保存です。星を押すと再試行できます。"
        : rating.saved
          ? `${rating.saved}点で評価済み（変更できます）`
          : "星を押すと保存します",
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-rating]")
    .forEach((button) => {
      button.onclick = async () => {
        rating.value = Number(button.dataset.rating);
        paint("保存中…");
        if (rating.saving) return;
        rating.saving = true;
        try {
          // 連打は直列保存し、最後に選んだ点数が最後に確定する。
          while (rating.saved !== rating.value) {
            if (session?.user.id !== ratingUserId) return;
            const stars = rating.value;
            await request("rate_question", { question_id: q.id, stars });
            rating.saved = stars;
            q.my_rating = stars;
          }
          paint(`${rating.saved}点で保存しました（変更できます）`);
        } catch {
          paint("保存できませんでした。星を押すと再試行できます。");
        } finally {
          rating.saving = false;
        }
      };
    });
}
async function submit(selected: number) {
  const item = current();
  if (!item || item.answer || busy) return;
  busy = true;
  pending = { item: item.id, selected };
  showQuestion();
  try {
    if (session)
      item.answer = await request<NonNullable<ExerciseItem["answer"]>>(
        "submit_answer",
        { item_id: item.id, selected_choice: selected },
      );
    else {
      const q = configured
        ? await request<Question>("reveal_question", {
            question_id: item.question.id,
          })
        : item.question;
      item.answer = {
        selected,
        correct: q.correct === selected,
        correct_choice: q.correct!,
        explanation: q.explanation!,
      };
    }
    pending = null;
    notice = "";
  } catch (error) {
    notice = message(error);
  } finally {
    busy = false;
    showQuestion();
  }
}
async function history() {
  if (!session) {
    location.hash = "login";
    return;
  }
  const data = await request<{
    answers: { title: string; correct: boolean; answered_at: string }[];
    summary: { category_id: string; answered: number; correct: number }[];
  }>(historyCategory ? "history_by_category" : "history", {
    page_number: page,
    ...(historyCategory
      ? {
          category_ids: categories
            .filter((c) =>
              includesCategory(c.id, [historyCategory], categories),
            )
            .map((c) => c.id),
        }
      : {}),
  });
  const summary = categories
    .filter((c) => c.level === 1)
    .map((category) => {
      const totals = data.summary
        .filter((s) =>
          includesCategory(s.category_id, [category.id], categories),
        )
        .reduce(
          (sum, s) => ({
            answered: sum.answered + s.answered,
            correct: sum.correct + s.correct,
          }),
          { answered: 0, correct: 0 },
        );
      return { category_id: category.id, ...totals };
    })
    .filter((s) => s.answered > 0);
  render(
    `<div class="section-heading"><h1>学習履歴</h1><p class="muted">自分の回答と、分野別の理解度を確認できます。</p></div><section class="card history-summary"><h2>大分類別の学習状況</h2><div class="history-table-scroll"><table class="history-table"><thead><tr><th scope="col">大分類</th><th scope="col">正解数</th><th scope="col">回答数</th></tr></thead><tbody>${summary.map((s) => `<tr class="${historyCategory === s.category_id ? "selected" : ""}"><th scope="row"><button type="button" class="history-category" data-history-category="${esc(s.category_id)}" aria-pressed="${historyCategory === s.category_id}">${esc(categories.find((c) => c.id === s.category_id)?.name ?? s.category_id)}</button></th><td>${s.correct}</td><td>${s.answered}</td></tr>`).join("")}</tbody></table></div>${summary.length ? '<button type="button" class="secondary" data-history-category="" aria-pressed="' + !historyCategory + '">すべての回答履歴を表示</button>' : "<p>まだ回答履歴がありません。</p>"}</section><section class="card" id="answer-history"><h2>回答履歴${historyCategory ? `：${esc(categories.find((c) => c.id === historyCategory)?.name)}` : "：すべて"}</h2>${data.answers.length ? data.answers.map((a) => `<div class="history-row"><span>${esc(a.title ?? "非公開の問題")}</span><strong>${a.correct ? "正解" : "不正解"}</strong><time>${esc(new Date(a.answered_at).toLocaleString("ja-JP"))}</time></div>`).join("") : "<p>該当する回答履歴がありません。</p>"}<div class="actions">${page ? button("前の50件", "history-prev", true) : ""}${data.answers.length === 50 ? button("次の50件", "history-next", true) : ""}</div></section>`,
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-history-category]")
    .forEach((button) => {
      button.onclick = () =>
        void guard(async () => {
          historyCategory = button.dataset.historyCategory ?? "";
          page = 0;
          await history();
          document
            .querySelector("#answer-history")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}
async function adminView(previewId?: string) {
  if (!session || !admin) {
    render('<section class="card"><h1>管理者権限が必要です。</h1></section>');
    return;
  }
  const list = await request<Question[]>("admin_questions");
  render(
    `<div class="section-heading"><div><span class="eyebrow">WORKSPACE</span><h1>管理者メニュー</h1><p>問題の内容を確認し、公開状態を管理します。</p></div></div><section class="card"><div class="admin-category-filters"><label>大分類<select id="admin-major" aria-label="大分類"></select></label><label>中分類<select id="admin-middle" aria-label="中分類"></select></label><label>小分類<select id="admin-minor" aria-label="小分類"></select></label></div><label>問題を検索<input id="search" value="${esc(adminFilters.term)}" placeholder="問題文・問題IDで検索"></label><p id="admin-result-count" class="small muted" role="status"></p><p id="admin-no-results" hidden>条件に合う問題がありません。</p><div id="admin-list">${list.map((q) => `<div class="history-row" data-question-id="${esc(q.id)}" data-search="${esc(q.id + " " + q.title + " " + q.body)}"><span class="admin-question-details"><small>${esc(q.id)}</small><br>${esc(q.title)}<span class="admin-question-source small muted"><strong>${q.origin === "ipa_sample" ? "IPA公式サンプル" : q.origin === "ipa_past" ? "IPA過去問" : "AIオリジナル"}</strong><br>${esc(q.source || "出典未設定")}</span></span>${q.origin === "ai_original" ? `<span class="small">評価 ${q.rating_average == null ? "未評価" : Number(q.rating_average).toFixed(1)} / ${q.rating_count ?? 0}件</span>` : ""}<span class="badge">${q.published ? "公開" : "非公開"}</span><button data-edit="${esc(q.id)}" class="secondary">確認・編集</button></div>`).join("")}</div><div id="editor"></div></section>`,
  );
  const major = document.querySelector<HTMLSelectElement>("#admin-major")!;
  const middle = document.querySelector<HTMLSelectElement>("#admin-middle")!;
  const minor = document.querySelector<HTMLSelectElement>("#admin-minor")!;
  const populate = (
    select: HTMLSelectElement,
    values: Category[],
    selected: string,
  ) => {
    select.innerHTML =
      '<option value="">すべて</option>' +
      values
        .map((c) => {
          const total = list.filter((q) =>
            includesCategory(q.category_id, [c.id], categories),
          ).length;
          return `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}（${total}問）</option>`;
        })
        .join("");
  };
  const updateOptions = () => {
    populate(
      major,
      categories.filter((c) => c.level === 1),
      adminFilters.major,
    );
    populate(
      middle,
      categories.filter(
        (c) => c.level === 2 && c.parent_id === adminFilters.major,
      ),
      adminFilters.middle,
    );
    populate(
      minor,
      categories.filter(
        (c) => c.level === 3 && c.parent_id === adminFilters.middle,
      ),
      adminFilters.minor,
    );
    middle.disabled = !adminFilters.major;
    minor.disabled = !adminFilters.middle;
  };
  const byId = new Map(list.map((q) => [q.id, q]));
  const applyFilters = () => {
    const selected =
      adminFilters.minor || adminFilters.middle || adminFilters.major;
    const term = adminFilters.term
      .trim()
      .normalize("NFKC")
      .toLocaleLowerCase("ja");
    let visible = 0;
    document
      .querySelectorAll<HTMLElement>("[data-question-id]")
      .forEach((row) => {
        const q = byId.get(row.dataset.questionId!)!;
        const matches =
          (!selected ||
            includesCategory(q.category_id, [selected], categories)) &&
          row.dataset
            .search!.normalize("NFKC")
            .toLocaleLowerCase("ja")
            .includes(term);
        row.hidden = !matches;
        if (matches) visible++;
      });
    document.querySelector("#admin-result-count")!.textContent =
      `${visible}問表示 ／ 登録 ${list.length}問`;
    document.querySelector<HTMLElement>("#admin-no-results")!.hidden =
      visible !== 0;
  };
  major.onchange = () => {
    adminFilters.major = major.value;
    adminFilters.middle = "";
    adminFilters.minor = "";
    updateOptions();
    applyFilters();
  };
  middle.onchange = () => {
    adminFilters.middle = middle.value;
    adminFilters.minor = "";
    updateOptions();
    applyFilters();
  };
  minor.onchange = () => {
    adminFilters.minor = minor.value;
    applyFilters();
  };
  document.querySelector<HTMLInputElement>("#search")!.oninput = (e) => {
    adminFilters.term = (e.target as HTMLInputElement).value;
    applyFilters();
  };
  updateOptions();
  applyFilters();
  document.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach(
    (b) =>
      (b.onclick = () => {
        const q = list.find((q) => q.id === b.dataset.edit)!;
        const editor = document.querySelector("#editor")!;
        editor.innerHTML = `<form id="edit-form"><h2>${esc(q.id)}を編集</h2><label>図表画像（PNG・JPEG・WebP、5MB以下）<input id="asset-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" id="upload-asset" class="secondary">図表をアップロード</button><p id="asset-status" role="status"></p><div id="asset-preview"><img id="admin-editor-image" class="question-image" alt="現在の図表" hidden></div><label>タイトル<input name="title" value="${esc(q.title)}" required></label><label>問題文<textarea name="body" required>${esc(q.body)}</textarea></label><label>分類<select name="category_id">${categories
          .filter((c) => c.level === 3)
          .map(
            (c) =>
              `<option value="${esc(c.id)}" ${c.id === q.category_id ? "selected" : ""}>${esc(c.name)}</option>`,
          )
          .join(
            "",
          )}</select></label>${q.choices.map((c) => `<label>元の${labels[c.id - 1]}<textarea name="choice${c.id}" required>${esc(c.body)}</textarea></label>`).join("")}<label>正答<select name="correct">${[1, 2, 3, 4].map((id) => `<option value="${id}" ${q.correct === id ? "selected" : ""}>元の${labels[id - 1]}</option>`).join("")}</select></label><label>解説<textarea name="explanation" required>${esc(q.explanation)}</textarea></label><label class="check"><input name="published" type="checkbox" ${q.published ? "checked" : ""}>公開する</label><button>保存する</button></form>`;
        releaseAdminImages();
        if (q.asset_key) void loadAdminImage(q, "#admin-editor-image");
        editor.scrollIntoView({ behavior: "smooth" });
        document.querySelector<HTMLButtonElement>("#upload-asset")!.onclick =
          () =>
            void guard(async () => {
              const file =
                document.querySelector<HTMLInputElement>("#asset-file")!
                  .files?.[0];
              if (!file) throw new Error("画像を選択してください。");
              const { data } = await auth!.auth.getSession();
              const response = await fetch(
                "/api/images/" + encodeURIComponent(q.id),
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": file.type,
                    Authorization: `Bearer ${data.session!.access_token}`,
                  },
                  body: file,
                },
              );
              const body = (await response.json()) as {
                error?: string;
                key?: string;
              };
              if (!response.ok || !body.key)
                throw new Error(body.error ?? "画像を保存できませんでした。");
              q.asset_key = body.key;
              await load();
              await loadAdminImage(q, "#admin-editor-image");
              document.querySelector("#asset-status")!.textContent =
                "画像を保存しました。";
            });
        document
          .querySelector("#edit-form")!
          .addEventListener("submit", (e) => {
            e.preventDefault();
            void guard(async () => {
              const f = new FormData(e.target as HTMLFormElement);
              await request("admin_save_question", {
                question: {
                  ...q,
                  title: f.get("title"),
                  body: f.get("body"),
                  category_id: f.get("category_id"),
                  correct: Number(f.get("correct")),
                  explanation: f.get("explanation"),
                  published: f.has("published"),
                  choices: q.choices.map((c) => ({
                    ...c,
                    body: String(f.get("choice" + c.id)),
                  })),
                },
              });
              notice = "問題を保存しました。";
              await load();
              await adminView(q.id);
            });
          });
      }),
  );
  if (previewId) {
    const saved = list.find((q) => q.id === previewId);
    if (saved) showSavedPreview(saved);
  }
}
async function loadAdminImage(q: Question, selector: string) {
  const image = document.querySelector<HTMLImageElement>(selector);
  if (!image || !q.asset_key) return;
  const assetKey = q.asset_key;
  image.dataset.assetKey = assetKey;
  image.hidden = false;
  try {
    const { data } = await auth!.auth.getSession();
    const response = await fetch(
      `/api/images/${encodeURIComponent(q.id)}?v=${encodeURIComponent(assetKey)}`,
      {
        headers: data.session
          ? { Authorization: `Bearer ${data.session.access_token}` }
          : {},
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("画像を読み込めませんでした。");
    const blob = await response.blob();
    if (!image.isConnected || image.dataset.assetKey !== assetKey) return;
    if (image.src.startsWith("blob:")) {
      URL.revokeObjectURL(image.src);
      adminImageUrls.delete(image.src);
    }
    const url = URL.createObjectURL(blob);
    adminImageUrls.add(url);
    image.src = url;
  } catch {
    if (image.isConnected) {
      image.hidden = true;
      const message = document.createElement("p");
      message.textContent =
        "図表を読み込めませんでした。画像の保存先を確認してください。";
      message.setAttribute("role", "alert");
      image.parentElement?.append(message);
    }
  }
}
function showSavedPreview(q: Question) {
  releaseAdminImages();
  const editor = document.querySelector("#editor")!;
  editor.innerHTML = `<section id="saved-question-preview" class="saved-question-preview"><span class="eyebrow">保存後のプレビュー</span><h2>${esc(q.id)} · ${esc(q.title)}</h2><p class="small muted">${esc(categories.find((c) => c.id === q.category_id)?.name)} ／ ${q.published ? "公開" : "非公開"}</p><p class="preview-body">${esc(q.body)}</p>${q.asset_key ? '<figure class="question-figure"><img id="admin-saved-image" class="question-image" alt="保存した問題の図表"></figure>' : ""}<div class="choices">${q.choices.map((c, i) => `<div class="choice ${c.id === q.correct ? "correct" : ""}"><span class="choice-label">${labels[i]}</span><span>${esc(c.body)}</span></div>`).join("")}</div><section class="explanation"><h3>正答：${labels[q.choices.findIndex((c) => c.id === q.correct)] ?? ""}</h3><p class="preview-body">${esc(q.explanation)}</p></section><p class="small muted">${esc(q.source)}</p><button type="button" id="preview-edit" class="secondary">もう一度編集する</button></section>`;
  if (q.asset_key) void loadAdminImage(q, "#admin-saved-image");
  document.querySelector<HTMLButtonElement>("#preview-edit")!.onclick = () => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-edit]"),
    ).find((b) => b.dataset.edit === q.id);
    button?.click();
  };
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}
function account() {
  if (!session) {
    location.hash = "login";
    return;
  }
  render(
    `<section class="card account"><h1>マイページ</h1><p>${esc(session.user.email)}</p><h2>パスワードの変更</h2><form id="change-password-form"><label>現在のパスワード<input name="current_password" type="password" autocomplete="current-password" required></label><label>新しいパスワード<input name="new_password" type="password" autocomplete="new-password" minlength="8" placeholder="8文字以上" required></label><label>新しいパスワード（確認）<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label><button type="submit">パスワードを変更する</button><p id="change-password-status" role="status" aria-live="polite"></p></form><h2>学習データの管理</h2><p>履歴の削除・リセットを行うと、中断中の演習も削除されます。</p>${button("回答履歴を削除する", "clear", true)}${button("学習履歴をリセットする", "reset", true)}<h2>アカウント</h2>${button("ログアウト", "logout", true)}${button("このアプリのアカウントを削除", "delete", true)}</section>`,
  );
  const form = document.querySelector<HTMLFormElement>(
    "#change-password-form",
  )!;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    if (submit.disabled) return;
    const status = form.querySelector<HTMLElement>("#change-password-status")!;
    status.textContent = "";
    const fields = new FormData(form);
    const currentPassword = String(fields.get("current_password") ?? "");
    const password = String(fields.get("new_password") ?? "");
    if (password !== fields.get("confirm_password")) {
      status.textContent = "新しいパスワードと確認用の入力が一致しません。";
      return;
    }
    if (!currentPassword || password.length < 8) {
      status.textContent =
        "現在のパスワードと、8文字以上の新しいパスワードを入力してください。";
      return;
    }
    submit.disabled = true;
    status.textContent = "現在のパスワードを確認しています…";
    try {
      const user = session?.user;
      if (!auth || !user?.email) throw new Error("ログインし直してください。");
      // 現在のパスワードを認証し、成功した同じ利用者だけ更新する。
      const verified = await auth.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (verified.error) {
        status.textContent =
          verified.error.code === "invalid_credentials"
            ? "現在のパスワードが正しくありません。"
            : "現在のパスワードを確認できませんでした。時間をおいて再度お試しください。";
        return;
      }
      if (verified.data.user?.id !== user.id)
        throw new Error("ログイン情報を確認できませんでした。");
      const { error } = await auth.auth.updateUser({
        password,
        current_password: currentPassword,
      });
      if (error) throw error;
      form.reset();
      status.textContent = "パスワードを変更しました。";
    } catch (error) {
      status.textContent =
        "パスワードを変更できませんでした。" + message(error);
    } finally {
      submit.disabled = false;
    }
  };
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "処理に失敗しました。";
}
async function guard(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    notice = message(error);
    render(
      `<section class="card"><h1>操作を完了できませんでした</h1><p>${esc(notice)}</p><a href="#practice">演習へ戻る</a></section>`,
    );
  }
}
async function route() {
  notice = "";
  const path = location.hash.slice(1).split("?")[0];
  await guard(async () => {
    if (path === "practice") {
      await load();
      practice();
    } else if (path === "history") await history();
    else if (path === "admin") await adminView();
    else if (path === "account") account();
    else login();
  });
}
function bind() {
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(
    (b) =>
      (b.onclick = () =>
        void guard(async () => {
          const action = b.dataset.action!;
          if (action.startsWith("mode-")) {
            authMode = action.slice(5);
            authMessage = "";
            login();
          } else if (action === "resume") {
            exercise = await request<Exercise | null>("active_exercise");
            if (!exercise) {
              notice = "中断中の演習はありません。";
              practice();
            } else {
              index = exercise.items.findIndex((i) => !i.answer);
              if (index < 0) index = exercise.items.length;
              revealed = null;
              pending = null;
              showQuestion();
            }
          } else if (action === "replace") {
            if (confirm("中断中の演習を置き換えますか？")) await start(true);
          } else if (action === "reveal") {
            const q = current()!.question;
            revealed = configured
              ? await request<Question>("reveal_question", {
                  question_id: q.id,
                })
              : q;
            showQuestion();
          } else if (action === "retry" && pending)
            await submit(pending.selected);
          else if (action === "next") {
            if (pending)
              throw new Error("回答の保存を完了してから進んでください。");
            index++;
            revealed = null;
            showQuestion();
          } else if (action === "finish") {
            exercise = null;
            revealed = null;
            pending = null;
            practice();
          } else if (action === "suspend") {
            if (
              !session &&
              !confirm("ゲストの演習は保存されません。終了しますか？")
            )
              return;
            exercise = null;
            revealed = null;
            pending = null;
            notice = session ? "中断しました。演習画面から再開できます。" : "";
            practice();
          } else if (action === "conditions") {
            if (
              confirm(
                "出題条件へ戻りますか？ログイン中の演習はサーバーに保存されています。",
              )
            ) {
              exercise = null;
              practice();
            }
          } else if (action === "history-prev" || action === "history-next") {
            page += action === "history-next" ? 1 : -1;
            await history();
          } else if (action === "clear" || action === "reset") {
            if (confirm("回答履歴と中断情報を削除します。よろしいですか？")) {
              await request("reset_history");
              exercise = null;
              notice = "履歴と中断情報を削除しました。";
              account();
            }
          } else if (action === "logout") {
            await auth?.auth.signOut();
            session = null;
            historyCategory = "";
            page = 0;
            admin = false;
            exercise = null;
            pending = null;
            location.hash = "login";
            await route();
          } else if (action === "delete") {
            if (
              !confirm(
                "この学習アプリの利用を停止し、回答履歴・中断情報・評価を削除します。ログイン用アカウント自体は残ります。元に戻せません。よろしいですか？",
              )
            )
              return;
            const { data } = await auth!.auth.getSession();
            const res = await fetch("/api/account", {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${data.session!.access_token}`,
              },
            });
            const result = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(result.error);
            await auth!.auth.signOut();
            session = null;
            historyCategory = "";
            page = 0;
            admin = false;
            exercise = null;
            pending = null;
            notice = "アカウントを削除しました。";
            location.hash = "login";
            login();
          }
        })),
  );
}
async function syncUser() {
  if (!auth) return;
  const { data } = await auth.auth.getSession();
  session = data.session;
  admin = false;
  if (session) {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      await auth.auth.signOut();
      session = null;
    } else {
      const me = (await res.json()) as { user: { admin: boolean } };
      admin = me.user.admin;
    }
  }
}
async function init() {
  render('<section class="card"><h1>学習の準備をしています…</h1></section>');
  try {
    const config = (await (await fetch("/api/config")).json()) as {
      configured: boolean;
      url: string;
      key: string;
    };
    configured =
      config.configured && !new URL(location.href).searchParams.has("demo");
    if (configured) {
      auth = createClient(config.url, config.key, {
        auth: { flowType: "pkce", detectSessionInUrl: false },
      });
      const code = new URL(location.href).searchParams.get("code");
      if (code) {
        const { error } = await auth.auth.exchangeCodeForSession(code);
        if (error) throw error;
        historyReplace();
      }
      await syncUser();
      if (new URL(location.href).searchParams.has("recovery") && session)
        authMode = "password";
      auth.auth.onAuthStateChange((event, next) => {
        session = next;
        if (event === "PASSWORD_RECOVERY") {
          authMode = "password";
          login();
        } else if (event === "SIGNED_OUT") {
          ratingStates.clear();
          admin = false;
          exercise = null;
          pending = null;
        }
      });
    }
    await load();
    await route();
  } catch (error) {
    notice = message(error);
    render(
      `<section class="card"><h1>接続を確認してください</h1><p>${esc(notice)}</p><p>Supabaseの設定とスキーマの適用状況を確認してください。</p></section>`,
    );
  }
}
function historyReplace() {
  const u = new URL(location.href);
  u.searchParams.delete("code");
  window.history.replaceState(null, "", u.toString());
}
window.addEventListener("hashchange", () => void route());
void init();
