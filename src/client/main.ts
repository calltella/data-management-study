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
import { supplementalChoiceExplanations } from "./choice-explanations.ts";
import { likelihoodLabels, questionLikelihood } from "./question-likelihood.ts";
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
const questionOrigins = [
  ["ai_original", "AIオリジナル問題"],
  ["ipa_past", "IPA過去問"],
  ["ipa_sample", "IPA公式サンプル"],
] as const;
let selectedOrigins: string[] = questionOrigins.map(([origin]) => origin);
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
function publishedQuestionCount(categoryId: string, pool = questions) {
  return pool.filter((q) =>
    includesCategory(q.category_id, [categoryId], categories),
  ).length;
}

function categoryOptions() {
  const pool = questions.filter((q) => selectedOrigins.includes(q.origin));
  return categories
    .filter((c) => c.level === 1)
    .map((c) => {
      const registered = publishedQuestionCount(c.id, pool);
      return `<label class="check level-1"><input type="checkbox" name="category" value="${esc(c.id)}" ${selectedCategories.includes(c.id) ? "checked" : ""}>${esc(c.name)} <span class="small muted" data-category-count="${esc(c.id)}">（${registered}問）</span></label>`;
    })
    .join("");
}
function practice() {
  if (exercise) {
    showQuestion();
    return;
  }
  render(
    `<div class="section-heading"><div><h1>今日の学習を始めましょう。</h1><p class="muted">分野を選んで、自分のペースで取り組めます。</p></div></div><form id="practice-form" class="card setup"><div class="setup-heading"><h2>出題条件</h2><span class="small muted">公開問題 ${questions.length}問</span></div><fieldset class="practice-origins"><legend>問題の種類</legend>${questionOrigins.map(([origin, label]) => `<label class="check"><input type="checkbox" name="origin" value="${origin}" ${selectedOrigins.includes(origin) ? "checked" : ""}>${label}</label>`).join("")}</fieldset><div class="categories">${categoryOptions()}<div class="category-controls"><div class="settings"><label class="count-setting">出題数<select name="count">${[10, 15, 20, 25, 30, 0].map((n) => `<option value="${n}" ${count === n ? "selected" : ""}>${n || "全部"}</option>`).join("")}</select></label><label class="check"><input name="shuffle" type="checkbox" ${shuffle ? "checked" : ""}>選択肢を並べ替える</label><label class="check"><input name="wrong" type="checkbox" ${wrong ? "checked" : ""} ${!session ? "disabled" : ""}>最後の回答が不正解の問題だけ</label></div><div class="category-actions"><button type="button" class="secondary" data-category-selection="all">全選択</button><button type="button" class="secondary" data-category-selection="none">全解除</button></div></div></div><section class="setup-guidance muted likelihood-guide" aria-labelledby="likelihood-guide-title"><p><strong id="likelihood-guide-title">AIの出題予想</strong>　IPAの科目Aシラバス案と公式サンプル問題をもとに、科目Aとの関連度を5段階で評価しています。</p>
    <details>
      <summary>5段階の意味を見る</summary>
      <dl>
        <dt>${likelihoodLabels[5]}</dt><dd>重視される知識や判断をそのまま問う問題。</dd>
        <dt>${likelihoodLabels[4]}</dt><dd>学習項目に対応し、その知識を具体例に当てはめる問題。</dd>
        <dt>${likelihoodLabels[3]}</dt><dd>共通する知識を使うものの、設問の焦点は少し異なる問題。</dd>
        <dt>${likelihoodLabels[2]}</dt><dd>接点があり、背景を理解する助けになる問題。</dd>
        <dt>${likelihoodLabels[1]}</dt><dd>接点は少なく、学習範囲の周辺にある知識を扱う問題。</dd>
      </dl>
    </details></section><div class="setup-actions"><button type="submit">最初から出題する</button>${session ? '<button type="button" data-action="resume" class="secondary">中断している問題から再開</button>' : ""}</div></form>`,
  );
  const categoryInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="category"]'),
  );
  const originInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="origin"]'),
  );
  originInputs.forEach((input) => input.addEventListener("change", () => {
    selectedOrigins = originInputs.filter((choice) => choice.checked).map((choice) => choice.value);
    const pool = questions.filter((q) => selectedOrigins.includes(q.origin));
    document.querySelectorAll<HTMLElement>("[data-category-count]").forEach((label) => {
      label.textContent = `（${publishedQuestionCount(label.dataset.categoryCount!, pool)}問）`;
    });
  }));
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
      selectedOrigins = f.getAll("origin").map(String);
      count = Number(f.get("count"));
      shuffle = f.has("shuffle");
      wrong = f.has("wrong");
      if (!selectedCategories.length) {
        notice = "分類を1つ以上選択してください。";
        practice();
        return;
      }
      if (!selectedOrigins.length) {
        notice = "問題の種類を1つ以上選択してください。";
        practice();
        return;
      }
      await start();
    });
}
async function start() {
  busy = true;
  try {
    if (session)
      exercise = await request<Exercise>("start_exercise", {
        category_ids: selectedCategories,
        question_origins: selectedOrigins,
        question_count: count,
        wrong_only: wrong,
        shuffle_choices: shuffle,
        replace_existing: true,
      });
    else {
      const candidates = shuffled(
        questions.filter((q) =>
          selectedOrigins.includes(q.origin) &&
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
  } finally {
    busy = false;
  }
}
function current(): ExerciseItem | undefined {
  return exercise?.items[index];
}
const eliminatedChoices = new WeakMap<ExerciseItem, Set<number>>();
const editedExerciseQuestions = new WeakMap<ExerciseItem, Question>();

function choiceExplanation(question: Question, choice: Question["choices"][number]): string {
  if (choice.explanation != null) return choice.explanation.trim();
  const supplemental = supplementalChoiceExplanations[question.id];
  return supplemental && Object.hasOwn(supplemental, choice.body)
    ? supplemental[choice.body]
    : "";
}

const affinityQuestionDiagrams: Record<number, { file: string; caption: string; alt: string }> = {
  1: { file: "fishbone", caption: "特性要因図の例", alt: "製品の傷を結果とし、設備、材料、作業方法、作業環境を原因候補として枝で結ぶ図" },
  2: { file: "affinity", caption: "親和図の例", alt: "作業時の困り事を、作業環境と作業手順の二つのまとまりに分けた図" },
  3: { file: "matrix", caption: "マトリックス図の例", alt: "保護シートと工具の定位置化を行に、傷の削減と作業時間短縮を列に置き、効果を記号で示す表" },
  4: { file: "histogram", caption: "ヒストグラムの例", alt: "製品の幅を1ミリメートルごとの区間に分けた度数分布。100ミリメートル以上101ミリメートル未満が10個で最も多い" },
};

const relationQuestionDiagrams: typeof affinityQuestionDiagrams = {
  1: { file: "arrow-network", caption: "アローダイアグラムの例", alt: "準備2日後に組立3日と点検1日を並行し、引渡しへ進む作業順序の図" },
  2: { file: "pareto", caption: "パレート図の例", alt: "不良の件数を降順の棒で、累積割合を折れ線で示した図" },
  3: affinityQuestionDiagrams[3],
  4: { file: "relations", caption: "連関図の例", alt: "記録漏れと情報不足が確認待ちにつながり、確認待ちと作業の集中が納期遅れにつながる図" },
};

function choiceDiagramUrl(questionId: string, choiceId: number, key: string) {
  return `/api/images/${encodeURIComponent(questionId)}?choice=${choiceId}&v=${encodeURIComponent(key)}`;
}

function bundledQuestionImage(q: Question): string | undefined {
  if (!/^DMQ-\d{4}$/.test(q.id)) return;
  const key = `ipa-original/${q.id}.png`;
  const legacyOfficialFigure = (q.id === "DMQ-0002" || q.id === "DMQ-0003")
    && q.asset_key === `questions/${q.id}/figure.png`;
  if (q.asset_key === key || legacyOfficialFigure) return `/${key}?v=2`;
}

function questionImageUrl(q: Question): string {
  return bundledQuestionImage(q)
    ?? `/api/images/${encodeURIComponent(q.id)}?v=${encodeURIComponent(q.asset_key ?? "")}`;
}

function breakSentences(text: string) {
  return text.replace(/。[^\S\r\n]*(?=[^」』）\s])/gu, "。\n");
}

function choiceLayout(q: Question, imageOnly: boolean) {
  if (imageOnly) return "choices-symbols";
  return q.choices.some(({ body }) => {
    const text = body.trim();
    return text.length >= 40 || text.includes("\n");
  }) ? "choices-stacked" : "";
}

function choiceExplanationRows(
  q: Question, choiceOrder: number[], correct: number | undefined, imageOnly: boolean, adminPreview = false,
) {
  const formatExplanation = (text: string) =>
    esc(breakSentences(relabelExplanation(text, choiceOrder)));
  return correct == null ? "" : choiceOrder
    .map((id, pos) => {
      const choice = q.choices.find((c) => c.id === id)!;
      const supplemental = supplementalChoiceExplanations[q.id];
      const detail = choiceExplanation(q, choice);
      const diagram = supplemental && Object.hasOwn(supplemental, choice.body)
        ? (q.id === "DMQ-0029" ? affinityQuestionDiagrams : q.id === "DMQ-0020" ? relationQuestionDiagrams : undefined)?.[id]
        : undefined;
      const diagramUrl = choice.diagram_key
        ? choiceDiagramUrl(q.id, id, choice.diagram_key)
        : diagram && `/explanation-diagrams/${diagram.file}.svg`;
      if (!detail && !diagramUrl) return "";
      return `<li class="choice-explanation${id === correct ? " correct" : ""}">
        <span class="choice-explanation-label">${labels[pos]}</span>
        <div>
        <div class="choice-explanation-header"><p class="choice-explanation-quote">${esc(imageOnly ? choice.body.replaceAll("\u0332", "") : choice.body)}</p>
        ${id === correct ? '<strong class="choice-explanation-result">正解</strong>' : ""}</div>
        <p class="choice-explanation-detail">${formatExplanation(detail)}</p>
        ${diagramUrl ? `<figure class="choice-explanation-figure">
          <img ${adminPreview && choice.diagram_key ? `data-diagram-url="${esc(diagramUrl)}" hidden` : `src="${esc(diagramUrl)}"`} alt="${esc(choice.diagram_key ? choice.body + "の解説図" : diagram?.alt)}">
          <figcaption>${esc(choice.diagram_key ? choice.body + "の解説図" : diagram?.caption)}</figcaption>
        </figure>` : ""}</div>
      </li>`;
    })
    .join("");
}

function officialQuestionPage(q: Question): string | undefined {
  if (q.id === "DMQ-0079") return "/ipa-original/DMQ-0079.png?v=3";
  if (["DMQ-0102", "DMQ-0110", "DMQ-0111", "DMQ-0119"].includes(q.id)
      && q.asset_key === `ipa-original/${q.id}.png`) {
    return `/${q.asset_key}?v=3`;
  }
}

function questionBodyMarkup(q: Question, className: string, imageOnly: boolean) {
  if (q.id === "DMQ-0079") {
    const [body, dependencies] = q.body.split(/\n\s*(?=〔関数従属性〕)/u, 2);
    return `<p class="${className}">${esc(breakSentences(body.trimEnd()))}</p>${dependencies ? `<p class="question-transcript">${esc(dependencies)}</p>` : ""}`;
  }
  return `<p class="${className}${imageOnly ? " question-transcript" : ""}">${esc(breakSentences(q.body))}</p>`;
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
  const edited = session && admin ? editedExerciseQuestions.get(item) : undefined;
  const resultVisible = Boolean(answer || revealed);
  const explanation = resultVisible ? edited?.explanation ?? answer?.explanation ?? revealed?.explanation : undefined;
  const correct = resultVisible ? edited?.correct ?? answer?.correct_choice ?? revealed?.correct : undefined;
  const answerKeyChanged = answer && correct !== answer.correct_choice;
  const resultClass = answer && !answerKeyChanged ? (answer.correct ? " correct" : " incorrect") : "";
  const resultHeading = answerKeyChanged ? "編集後の正解・解説"
    : answer ? (answer.correct ? "正解です" : "不正解です") : "正解・解説";
  const publicId = q.public_id ?? questions.find(({ id }) => id === q.id)?.public_id;
  const canEdit = Boolean(session && admin);
  const assessment = questionLikelihood[q.id];
  const categoryPath: Category[] = [];
  const seenCategories = new Set<string>();
  let category = categories.find(({ id }) => id === q.category_id);
  while (category && !seenCategories.has(category.id)) {
    categoryPath.unshift(category);
    seenCategories.add(category.id);
    const parentId = category.parent_id;
    category = categories.find(({ id }) => id === parentId);
  }
  const eliminated = eliminatedChoices.get(item) ?? new Set<number>();
  eliminatedChoices.set(item, eliminated);
  const locked = Boolean(answer || pending);
  const reconstructionNote = /[（(](問題文・選択肢を再構成)[）)]\s*$/u.exec(q.source);
  const source = (reconstructionNote ? q.source.slice(0, reconstructionNote.index) : q.source)
    .replace(/(^|[／/])\s*出典\s*[：:]\s*/gu, "$1")
    .replace(/\s*[（(](?:2026年6月公開。)?(?:句読点|読点)を統一。解説は独自作成[）)]/gu, "")
    .replace(/。表を項目一覧にテキスト化\s*$/u, "")
    .replace(/。\s*学習範囲の根拠[：:][^\r\n]*$/u, "")
    .trim();
  const officialPage = officialQuestionPage(q);
  const imageOnly = Boolean(officialPage);
  const choiceOrder = imageOnly ? [1, 2, 3, 4] : item.choice_order;
  const history = item.answer_history ?? (item.previous_correct == null ? [] : [item.previous_correct]);
  const historyIcons = session && history.length
    ? `<span class="answer-history" role="group" aria-label="過去の回答">${history.map((isCorrect, i) => {
        const label = `${i + 1}件目は${isCorrect ? "正解" : "誤答"}`;
        return `<span class="previous-answer ${isCorrect ? "correct" : "incorrect"}" role="img" aria-label="${label}" title="${label}">${isCorrect ? "✓" : "×"}</span>`;
      }).join("")}</span>`
    : "";
  const formatExplanation = (text: string) =>
    esc(breakSentences(relabelExplanation(text, choiceOrder)));
  const choiceExplanations = choiceExplanationRows(q, choiceOrder, correct, imageOnly);
  render(
    `<section class="card question">
      <div class="question-meta"><p class="question-breadcrumb" role="navigation" aria-label="パンくず"><a href="#practice" data-action="conditions">出題条件</a>${categoryPath.map(({ name }) => ` <span class="breadcrumb-separator">»</span> ${esc(name)}`).join("")}</p>
        ${publicId ? `<p class="question-public-id"><code>${esc(publicId)}</code></p>` : ""}
      </div>
      <div class="question-title-row">
        <h1 class="question-source">${esc(source || q.title)}</h1>
        ${canEdit ? '<button type="button" class="question-edit-control" data-edit-exercise="body">問題を編集</button>' : ""}
      </div>
      <div class="question-heading"><h2 class="question-number">問 ${index + 1} <span>／ ${exercise!.items.length}問</span></h2>${historyIcons}
        ${assessment
          ? `<details class="question-likelihood"><summary>科目Aとの関連度（AI評価）｜<strong>${likelihoodLabels[assessment[0]]}</strong></summary><p>${esc(assessment[1])}</p></details>`
          : '<span class="question-likelihood">科目Aとの関連度（AI評価）｜未評価</span>'}
      </div>
      ${questionBodyMarkup(q, "question-body", imageOnly)}
      ${imageOnly ? `<figure class="question-figure"><img class="question-image" src="${esc(officialPage)}" alt="${q.id === "DMQ-0079" ? "公式冊子の関数従属性と選択肢" : "公式冊子の問題と選択肢"}"></figure>` : q.asset_key ? `<figure class="question-figure"><img class="question-image" id="exercise-question-image" ${canEdit && q.published === false ? "hidden" : `src="${esc(questionImageUrl(q))}"`} alt="問題の図表"></figure>` : ""}
      <div class="choices ${choiceLayout(q, imageOnly)}">${choiceOrder
      .map((id, pos) => {
        const c = q.choices.find((v) => v.id === id)!;
        const excluded = eliminated.has(id);
        const result = correct === id ? "正解" : answer?.selected === id ? "誤答" : "";
        return `<div class="choice ${correct === id ? "correct" : ""} ${answer?.selected === id ? "selected" : ""}">
          ${result ? `<span class="choice-result">${result}</span>` : ""}
          <button type="button" class="choice-label" data-choice="${id}" ${imageOnly ? `aria-label="${labels[pos]}、${esc(c.body.replaceAll("\u0332", ""))}"` : `aria-labelledby="choice-label-${id} choice-text-${id}"`} id="choice-label-${id}" ${locked || excluded ? "disabled" : ""}>${labels[pos]}</button>
          ${imageOnly ? "" : `<button type="button" class="choice-text" data-eliminate="${id}" id="choice-text-${id}" aria-pressed="${excluded}" ${locked ? "disabled" : ""}>${esc(c.body)}</button>`}
        </div>`;
      })
      .join(
        "",
      )}</div>${!answer ? '<p class="muted question-choice-hint">記号を押すと回答が確定します。' + (imageOnly ? '' : '選択肢の文を押すと除外・解除できます。') + '</p>' : ""}${pending ? `<div role="alert" class="notice">回答が保存されていません。接続を確認して再試行してください。${button("同じ回答を再送する", "retry", true)}</div>` : ""}${
      resultVisible && (explanation || choiceExplanations || canEdit)
        ? `<section class="explanation${resultClass}"><div class="question-edit-heading"><h2>${resultHeading} · 正解：${labels[choiceOrder.indexOf(correct!)]}</h2>${canEdit ? '<button type="button" class="question-edit-control" data-edit-exercise="explanation">解説を編集</button>' : ""}</div>${explanation ? `<p>${formatExplanation(explanation)}</p>` : ""}${choiceExplanations ? `<h3 class="choice-explanations-title">選択肢ごとの解説</h3><ul class="choice-explanations">${choiceExplanations}</ul>` : ""}${reconstructionNote ? `<p class="small muted">${esc(reconstructionNote[1])}</p>` : ""}${answer && !session ? '<p class="small">ゲストの回答は保存していません</p>' : ""}</section>`
        : ""
    }${session && q.origin === "ai_original" && explanation ? `<div class="rating" data-rating-question="${esc(q.id)}"><span id="rating-label">このAI問題を評価</span><div class="rating-stars" role="group" aria-labelledby="rating-label">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rating-star" data-rating="${n}" aria-label="${n}点" aria-pressed="false">☆</button>`).join("")}</div><span class="small" id="rating-status" role="status" aria-live="polite"></span></div>` : ""}<div class="actions question-actions">${!answer && !revealed ? button("先に正答・解説を見る", "reveal", true) : ""}${answer || revealed ? `<a href="#practice" data-action="next">${index === exercise!.items.length - 1 ? "演習を終了" : "次の問題へ"}</a>` : ""}<div class="question-exit-actions">${button(session ? "中断して保存" : "演習を終了", "suspend", true)}</div></div>${canEdit ? '<dialog id="exercise-editor" aria-labelledby="exercise-editor-title"><div class="question-edit-heading"><h2 id="exercise-editor-title">出題内容を編集</h2><button type="button" class="secondary" data-close-exercise-editor>閉じる</button></div><div class="exercise-editor-content"></div></dialog>' : ""}</section>`,
  );
  if (canEdit) {
    if (q.asset_key && q.published === false) void loadAdminImage(q, "#exercise-question-image");
    document.querySelectorAll<HTMLButtonElement>("[data-edit-exercise]").forEach((control) => {
      control.onclick = () => void openExerciseEditor(item, control.dataset.editExercise === "explanation" ? "explanation" : "body");
    });
  }
  if (session && q.origin === "ai_original" && explanation) bindRating(q);
  document.querySelectorAll<HTMLButtonElement>("[data-eliminate]").forEach((text) => {
    const id = Number(text.dataset.eliminate);
    const choice = document.querySelector<HTMLButtonElement>(`[data-choice="${id}"]`)!;
    text.onclick = () => {
      if (busy && pending) return;
      if (eliminated.has(id)) eliminated.delete(id);
      else eliminated.add(id);
      const excluded = eliminated.has(id);
      text.setAttribute("aria-pressed", String(excluded));
      choice.disabled = excluded;
    };
  });
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
  const questionPanel = document.querySelector(".question");
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
    if (questionPanel?.isConnected && current() === item) showQuestion();
  }
}
async function history() {
  if (!session) {
    location.hash = "login";
    return;
  }
  const data = await request<{
    answers: { title: string; correct: boolean; answered_at: string; previous_results?: boolean[] }[];
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
  const total = summary.reduce(
    (sum, row) => ({ correct: sum.correct + row.correct, answered: sum.answered + row.answered }),
    { correct: 0, answered: 0 },
  );
  const accuracy = ({ correct, answered }: { correct: number; answered: number }) =>
    answered ? `${((correct / answered) * 100).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}%` : "—";
  const timestamp = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const resultIcon = (correct: boolean, label: string) =>
    `<span class="previous-answer ${correct ? "correct" : "incorrect"}" role="img" aria-label="${label}" title="${label}">${correct ? "✓" : "×"}</span>`;
  const selectedSummary = summary.find(({ category_id }) => category_id === historyCategory);
  render(
    `<div class="section-heading"><h1>学習履歴</h1><p class="muted">自分の回答と、分野別の理解度を確認できます。</p></div><section class="card history-summary"><h2>大分類別の学習状況</h2><div class="history-table-scroll"><table class="history-table"><thead><tr><th scope="col">大分類</th><th scope="col">正解数</th><th scope="col">回答数</th><th scope="col">正解率</th></tr></thead><tbody>${summary.map((s) => `<tr class="${historyCategory === s.category_id ? "selected" : ""}"><th scope="row"><button type="button" class="history-category" data-history-category="${esc(s.category_id)}" aria-pressed="${historyCategory === s.category_id}">${esc(categories.find((c) => c.id === s.category_id)?.name ?? s.category_id)}</button> <span class="history-question-count muted">（${publishedQuestionCount(s.category_id)}）</span></th><td>${s.correct}</td><td>${s.answered}</td><td>${accuracy(s)}</td></tr>`).join("")}</tbody><tfoot><tr><th scope="row">合計</th><td>${total.correct}</td><td>${total.answered}</td><td>${accuracy(total)}</td></tr></tfoot></table></div>${summary.length ? "" : "<p>まだ回答履歴がありません。</p>"}</section>${selectedSummary ? `<section class="card" id="answer-history"><div class="history-detail-heading"><h2>回答履歴：${esc(categories.find((c) => c.id === historyCategory)?.name ?? historyCategory)}</h2><span class="small">正解率 <strong>${accuracy(selectedSummary)}</strong>（${selectedSummary.correct} / ${selectedSummary.answered}件）</span></div>${data.answers.length ? data.answers.map((a) => `<div class="history-row"><span>${esc(a.title ?? "非公開の問題")}</span><span class="history-result-icons">${(a.previous_results ?? []).length ? `<span class="history-past-results" role="group" aria-label="同じ問題の過去の回答（新しい順）">${a.previous_results!.map((correct, i) => resultIcon(correct, `過去${i + 1}件目：${correct ? "正解" : "不正解"}`)).join("")}</span>` : ""}${resultIcon(a.correct, a.correct ? "今回：正解" : "今回：不正解")}</span><time datetime="${esc(a.answered_at)}">${esc(timestamp.format(new Date(a.answered_at)))}</time></div>`).join("") : "<p>該当する回答履歴がありません。</p>"}<div class="actions">${page ? button("前の50件", "history-prev", true) : ""}${data.answers.length === 50 ? button("次の50件", "history-next", true) : ""}</div></section>` : ""}`,
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
    `<div class="section-heading"><div><span class="eyebrow">WORKSPACE</span><h1>管理者メニュー</h1><p>問題の内容を確認し、公開状態を管理します。</p></div></div><section class="card"><div class="admin-category-filters"><label>大分類<select id="admin-major" aria-label="大分類"></select></label><label>中分類<select id="admin-middle" aria-label="中分類"></select></label><label>小分類<select id="admin-minor" aria-label="小分類"></select></label></div><label for="search">問題を検索</label><div class="admin-search"><input id="search" value="${esc(adminFilters.term)}" placeholder="問題文・問題ID（UUID）で検索"><button type="button" id="admin-search-clear" class="secondary" aria-label="検索をクリア" ${adminFilters.term ? "" : "hidden"}>×</button></div><p id="admin-result-count" class="small muted" role="status"></p><p id="admin-no-results" hidden>条件に合う問題がありません。</p><div id="admin-list">${list.map((q) => `<div class="history-row" data-question-id="${esc(q.id)}" data-search="${esc([q.id, q.public_id, q.title, q.body].join(" "))}"><span class="admin-question-details">${q.public_id ? `<small>${esc(q.public_id)}</small><br>` : ""}${esc(q.title)}<span class="admin-question-source small muted">${esc(q.source || "出典未設定")}</span></span>${q.origin === "ai_original" ? `<span class="small">評価 ${q.rating_average == null ? "未評価" : Number(q.rating_average).toFixed(1)} / ${q.rating_count ?? 0}件</span>` : ""}<span class="badge">${q.published ? "公開" : "非公開"}</span><div class="admin-question-actions"><button type="button" data-preview="${esc(q.id)}" class="secondary" aria-haspopup="dialog" aria-controls="admin-question-dialog">プレビュー</button><button type="button" data-edit="${esc(q.id)}" class="secondary" aria-haspopup="dialog" aria-controls="admin-question-dialog">確認・編集</button></div></div>`).join("")}</div></section><dialog id="admin-question-dialog" aria-labelledby="admin-question-dialog-title"><div class="question-edit-heading"><h2 id="admin-question-dialog-title" tabindex="-1"></h2><button type="button" class="secondary" data-close-admin-question>閉じる</button></div><div id="editor"></div></dialog>`,
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
  const search = document.querySelector<HTMLInputElement>("#search")!;
  const clearSearch = document.querySelector<HTMLButtonElement>("#admin-search-clear")!;
  search.oninput = () => {
    adminFilters.term = search.value;
    clearSearch.hidden = !search.value;
    applyFilters();
  };
  clearSearch.onclick = () => {
    search.value = "";
    search.focus();
    search.dispatchEvent(new Event("input", { bubbles: true }));
  };
  updateOptions();
  applyFilters();
  const dialog = document.querySelector<HTMLDialogElement>("#admin-question-dialog")!;
  const title = dialog.querySelector<HTMLElement>("#admin-question-dialog-title")!;
  const editor = dialog.querySelector<HTMLElement>("#editor")!;
  const isSaving = () => editor.querySelector("form")?.getAttribute("aria-busy") === "true";

  dialog.querySelector<HTMLButtonElement>("[data-close-admin-question]")!.onclick = () => {
    if (!isSaving()) dialog.close();
  };
  dialog.oncancel = (event) => {
    if (isSaving()) event.preventDefault();
  };
  dialog.onclose = () => {
    if (dialog.open || !dialog.isConnected) return;
    releaseAdminImages();
    editor.replaceChildren();
  };

  const showDialog = () => {
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  };
  const edit = (question: Question) => {
    releaseAdminImages();
    title.textContent = "問題を編集";
    showQuestionEditor(editor, question, async () => {
      notice = "問題を保存しました。";
      await load();
      if (dialog.isConnected) await adminView(question.id);
    });
    showDialog();
    editor.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
  };
  const preview = (question: Question, afterSave = false) => {
    title.textContent = afterSave ? "保存後のプレビュー" : "問題のプレビュー";
    showQuestionPreview(editor, question, () => edit(question), afterSave);
    showDialog();
    editor.querySelector("h2")?.focus({ preventScroll: true });
  };

  document.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((button) => {
    button.onclick = () => {
      const question = byId.get(button.dataset.edit!);
      if (question) edit(question);
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-preview]").forEach((button) => {
    button.onclick = () => {
      const question = byId.get(button.dataset.preview!);
      if (question) preview(question);
    };
  });
  if (previewId) {
    const saved = byId.get(previewId);
    if (saved) {
      const row = document.querySelector<HTMLElement>(`#admin-list [data-question-id="${CSS.escape(saved.id)}"]`);
      const returnTarget = row && !row.hidden ? row.querySelector("button") : document.querySelector("#search");
      if (returnTarget instanceof HTMLElement) returnTarget.focus({ preventScroll: true });
      preview(saved, true);
    }
  }
}
async function openExerciseEditor(item: ExerciseItem, field: "body" | "explanation") {
  if (!session || !admin || busy || pending) return;
  const dialog = document.querySelector<HTMLDialogElement>("#exercise-editor")!;
  const editor = dialog.querySelector<HTMLElement>(".exercise-editor-content")!;
  const close = dialog.querySelector<HTMLButtonElement>("[data-close-exercise-editor]")!;
  const initialAssetKey = item.question.asset_key;
  const formBusy = () => editor.querySelector("form")?.getAttribute("aria-busy") === "true";
  close.onclick = () => {
    if (!formBusy()) dialog.close();
  };
  dialog.oncancel = (event) => {
    if (formBusy()) event.preventDefault();
  };
  dialog.onclose = () => {
    if (dialog.open) return;
    const image = editor.querySelector<HTMLImageElement>("#admin-editor-image");
    if (image?.src.startsWith("blob:")) {
      URL.revokeObjectURL(image.src);
      adminImageUrls.delete(image.src);
    }
    editor.replaceChildren();
    if (dialog.isConnected && current() === item && item.question.asset_key !== initialAssetKey) showQuestion();
  };
  editor.innerHTML = '<p role="status">編集内容を読み込んでいます…</p>';
  dialog.showModal();
  const loading = editor.firstElementChild;
  try {
    const list = await request<Question[]>("admin_questions");
    if (!dialog.isConnected || !dialog.open || editor.firstElementChild !== loading) return;
    const question = list.find(({ id }) => id === item.question.id);
    if (!question) throw new Error("問題が見つかりません。");
    showQuestionEditor(editor, question, async () => {
      const latest = (await request<Question[]>("admin_questions")).find(({ id }) => id === question.id);
      if (!latest) throw new Error("保存した問題を読み込めませんでした。");
      if (!dialog.isConnected || current() !== item || !session || !admin) return;
      item.question = latest;
      editedExerciseQuestions.set(item, latest);
      questions = questions.filter(({ id }) => id !== latest.id);
      if (latest.published) {
        const publicQuestion = { ...latest };
        delete publicQuestion.correct;
        delete publicQuestion.explanation;
        questions.push(publicQuestion);
      }
      showQuestion();
    });
    editor.querySelector<HTMLTextAreaElement>(`[name="${field}"]`)?.focus();
  } catch (error) {
    if (dialog.isConnected && dialog.open && editor.firstElementChild === loading)
      editor.innerHTML = `<p role="alert">${esc(message(error))}</p>`;
  }
}

function showQuestionEditor(
  editor: HTMLElement,
  q: Question,
  onSaved: () => Promise<void>,
) {
  const initialChoiceExplanations = new Map(q.choices.map((choice) => [choice.id, choiceExplanation(q, choice)]));
  editor.innerHTML = `<form id="edit-form"><h2>${esc(q.id)}を編集</h2>
    <label>図表画像（PNG・JPEG・WebP、5MB以下）<input id="asset-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <button type="button" id="upload-asset" class="secondary">図表をアップロード</button><p id="asset-status" role="status"></p>
    <div id="asset-preview"><img id="admin-editor-image" class="question-image" alt="現在の図表" hidden></div>
    <label>タイトル<input name="title" value="${esc(q.title)}" required></label>
    <label>問題文<textarea name="body" required>${esc(q.body)}</textarea></label>
    <label>分類<select name="category_id">${categories
      .filter((c) => c.level === 3)
      .map((c) => `<option value="${esc(c.id)}" ${c.id === q.category_id ? "selected" : ""}>${esc(c.name)}</option>`)
      .join("")}</select></label>
    ${q.choices.map((c) => `<label>${labels[c.id - 1]}<textarea name="choice${c.id}" required>${esc(c.body)}</textarea></label>`).join("")}
    <label>正答<select name="correct">${q.choices.map(({ id }) => `<option value="${id}" ${q.correct === id ? "selected" : ""}>${labels[id - 1]}</option>`).join("")}</select></label>
    <label>解説<textarea name="explanation" required>${esc(q.explanation)}</textarea></label>
    ${q.choices.map(({ id, diagram_key }) => `<label>${labels[id - 1]}の解説<textarea name="choice-explanation-${id}">${esc(initialChoiceExplanations.get(id))}</textarea></label>
      <label>${labels[id - 1]}の解説図（PNG・JPEG・WebP、5MB以下）<input type="file" name="choice-diagram-${id}" accept="image/png,image/jpeg,image/webp"></label>
      ${diagram_key ? '<p class="small muted">登録済み。画像を選ぶと差し替えます。</p>' : ''}`).join("")}
    <label class="check"><input name="published" type="checkbox" ${q.published ? "checked" : ""}>公開する</label>
    <button type="submit">保存する</button><p class="editor-error" role="alert" hidden></p></form>`;
  if (q.asset_key) void loadAdminImage(q, "#admin-editor-image");

  const form = editor.querySelector<HTMLFormElement>("#edit-form")!;
  const upload = form.querySelector<HTMLButtonElement>("#upload-asset")!;
  const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const errorText = form.querySelector<HTMLElement>(".editor-error")!;
  const perform = async (action: () => Promise<void>) => {
    if (form.getAttribute("aria-busy") === "true") return;
    form.setAttribute("aria-busy", "true");
    upload.disabled = save.disabled = true;
    errorText.hidden = true;
    try {
      await action();
    } catch (error) {
      errorText.textContent = message(error);
      errorText.hidden = false;
    } finally {
      form.removeAttribute("aria-busy");
      upload.disabled = save.disabled = false;
    }
  };
  upload.onclick = () => void perform(async () => {
    const file = form.querySelector<HTMLInputElement>("#asset-file")!.files?.[0];
    if (!file) throw new Error("画像を選択してください。");
    q.asset_key = await uploadQuestionImage(q.id, file);
    await load();
    if (!form.isConnected) return;
    await loadAdminImage(q, "#admin-editor-image");
    form.querySelector("#asset-status")!.textContent = "画像を保存しました。";
  });
  form.onsubmit = (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    void perform(async () => {
      const choices = [];
      for (const choice of q.choices) {
        const explanation = String(fields.get("choice-explanation-" + choice.id)).trim();
        const file = fields.get("choice-diagram-" + choice.id);
        const diagram_key = file instanceof File && file.name
          ? await uploadQuestionImage(q.id, file, choice.id)
          : choice.diagram_key;
        choices.push({
          ...choice,
          body: String(fields.get("choice" + choice.id)),
          ...(explanation !== initialChoiceExplanations.get(choice.id) ? { explanation } : {}),
          ...(diagram_key ? { diagram_key } : {}),
        });
      }
      await request("admin_save_question", {
        question: {
          ...q,
          title: fields.get("title"),
          body: fields.get("body"),
          category_id: fields.get("category_id"),
          correct: Number(fields.get("correct")),
          explanation: fields.get("explanation"),
          published: fields.has("published"),
          choices,
        },
      });
      if (form.isConnected) await onSaved();
    });
  };
}

async function uploadQuestionImage(questionId: string, file: File, choiceId?: number) {
  const { data } = await auth!.auth.getSession();
  const response = await fetch("/api/images/" + encodeURIComponent(questionId) + (choiceId ? `?choice=${choiceId}` : ""), {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      Authorization: `Bearer ${data.session!.access_token}`,
    },
    body: file,
  });
  const body = (await response.json()) as { error?: string; key?: string };
  if (!response.ok || !body.key)
    throw new Error(body.error ?? "画像を保存できませんでした。");
  return body.key;
}

async function loadAdminImage(q: Question, selector: string) {
  const image = document.querySelector<HTMLImageElement>(selector);
  if (!image || !q.asset_key) return;
  const assetKey = q.asset_key;
  image.dataset.assetKey = assetKey;
  image.hidden = false;
  const bundled = bundledQuestionImage(q);
  if (bundled) {
    if (image.src.startsWith("blob:")) {
      URL.revokeObjectURL(image.src);
      adminImageUrls.delete(image.src);
    }
    image.src = bundled;
    return;
  }
  await loadAdminImageUrl(image, questionImageUrl(q));
}

async function loadAdminImageUrl(image: HTMLImageElement, src: string) {
  const assetKey = image.dataset.assetKey;
  try {
    const { data } = await auth!.auth.getSession();
    const response = await fetch(
      src,
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
    image.hidden = false;
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
function showQuestionPreview(editor: HTMLElement, q: Question, edit: () => void, afterSave: boolean) {
  releaseAdminImages();
  const officialPage = officialQuestionPage(q);
  const imageOnly = Boolean(officialPage);
  const choices = q.choices;
  const details = choiceExplanationRows(q, choices.map(({ id }) => id), q.correct, imageOnly, true);
  editor.innerHTML = `<section id="saved-question-preview" class="saved-question-preview">
    <h2 tabindex="-1">${esc(q.id)} · ${esc(q.title)}</h2>
    <p class="small muted">${esc(categories.find((c) => c.id === q.category_id)?.name)} ／ ${q.published ? "公開" : "非公開"}</p>
    ${questionBodyMarkup(q, "preview-body", imageOnly)}
    ${imageOnly ? `<figure class="question-figure"><img class="question-image" src="${esc(officialPage)}" alt="${q.id === "DMQ-0079" ? "公式冊子の関数従属性と選択肢" : "公式冊子の問題と選択肢"}"></figure>` : q.asset_key ? `<figure class="question-figure"><img id="admin-saved-image" class="question-image" alt="${afterSave ? "保存した問題の図表" : "問題の図表"}"></figure>` : ""}
    <div class="choices ${choiceLayout(q, imageOnly)}">${choices.map((c, i) => `<div class="choice ${c.id === q.correct ? "correct" : ""}">
      <span class="choice-label"${imageOnly ? ` aria-label="${labels[i]}、${esc(c.body.replaceAll("\u0332", ""))}"` : ""}>${labels[i]}</span>
      ${imageOnly ? "" : `<span class="choice-text">${esc(c.body)}</span>`}
    </div>`).join("")}</div>
    <section class="explanation">
      <h3>正答：${labels[choices.findIndex((c) => c.id === q.correct)] ?? ""}</h3>
      <p class="preview-body">${esc(breakSentences(q.explanation ?? ""))}</p>
      ${details ? `<h3 class="choice-explanations-title">選択肢ごとの解説</h3><ul class="choice-explanations">${details}</ul>` : ""}
    </section>
    <p class="small muted">${esc(q.source)}</p>
    <button type="button" id="preview-edit" class="secondary">${afterSave ? "もう一度編集する" : "問題を編集する"}</button>
  </section>`;
  if (q.asset_key && !imageOnly) void loadAdminImage(q, "#admin-saved-image");
  editor.querySelectorAll<HTMLImageElement>("[data-diagram-url]").forEach((image) => {
    void loadAdminImageUrl(image, image.dataset.diagramUrl!);
  });
  editor.querySelector<HTMLButtonElement>("#preview-edit")!.onclick = edit;
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
  document.querySelectorAll<HTMLElement>("[data-action]").forEach(
    (b) =>
      (b.onclick = (event) =>
        void guard(async () => {
          if (b instanceof HTMLAnchorElement) event.preventDefault();
          if (busy && pending && b.closest(".question")) return;
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
                session
                  ? "出題条件へ戻りますか？演習はサーバーに保存されています。"
                  : "出題条件へ戻りますか？ゲストの演習は保存されません。",
              )
            ) {
              exercise = null;
              revealed = null;
              pending = null;
              notice = "";
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
