import {
  formatElapsed,
  includesBCategory,
  matchesMatrixFilter,
  matrixColumnValues,
  type BCase,
  type BCategory,
  type BExercise,
  type BExerciseItem,
  type BQuestion,
  type BScenarioBlock,
} from "../model-b.ts";
import { bCategories, bPlannedPaidSummary, bSampleCases } from "../kamoku-b-samples.ts";
import { renderExplanationMarkdown } from "./markdown.ts";
import { bindWhiteboard, whiteboardToggle } from "./whiteboard.ts";

export interface KamokuBContext {
  render: (content: string) => void;
  isAdmin: () => boolean;
  isLoggedIn: () => boolean;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

// 画面状態（セッション中保持）
let activeSetupTab: "sample" | "original" = "sample";
let selectedCaseIds: string[] = bSampleCases
  .filter((c) => c.published && c.access_tier === "free")
  .map((c) => c.id);
let showTimer = true;
let enableSlotFilter = true;
let currentExercise: BExercise | null = null;
let currentIndex = 0;
let currentQuestionIndex = 0;
let draftChoiceId: number | null = null;
let mobileTab: "case" | "question" = "case";
let wideCaseMode = false;
let markerEnabled = false;
let timerPaused = false;
let elapsedSeconds = 0;
let timerHandle: number | null = null;
let noticeText = "";

// 問題ごとの一時的な思考補助状態
const eliminatedChoicesMap = new WeakMap<BExerciseItem, Set<number>>();
const eliminatedCandidatesMap = new WeakMap<BExerciseItem, Set<string>>();
const slotFiltersMap = new WeakMap<BExerciseItem, Record<number, string>>();
const markedScenarioHtmlMap = new WeakMap<BExerciseItem, string>();

const difficultyLabels: Record<1 | 2 | 3, string> = {
  1: "基礎",
  2: "標準",
  3: "応用",
};

const tableIconSvg = `<svg class="b-table-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><line x1="1.5" y1="6.2" x2="14.5" y2="6.2"/><line x1="6" y1="6.2" x2="6" y2="13.5"/><line x1="10.5" y1="6.2" x2="10.5" y2="13.5"/></svg>`;

export function cleanupKamokuB(): void {
  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
}

export function isKamokuBActive(): boolean {
  return currentExercise !== null;
}

function stopTimer(): void {
  if (timerHandle !== null) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
}

function startTimer(item: BExerciseItem): void {
  stopTimer();
  if (!currentExercise?.show_timer) return;
  const q = item.case_data.questions[currentQuestionIndex];
  if (!q || item.answers[q.id]) return;
  timerHandle = window.setInterval(() => {
    if (timerPaused) return;
    elapsedSeconds += 1;
    const display = document.querySelector<HTMLElement>("[data-b-timer-text]");
    if (display) {
      const limitSec = item.case_data.estimated_minutes * 60;
      display.textContent = `${formatElapsed(elapsedSeconds)} / 目安 ${formatElapsed(limitSec)}`;
      display.classList.toggle("over-time", elapsedSeconds > limitSec);
    }
  }, 1000);
}

function formatRichText(text: string): string {
  const escaped = esc(text);
  const withSlots = escaped.replace(
    /【\s*([a-zA-Z0-9ａ-ｚＡ-Ｚ０-９]+)\s*】/gu,
    (_m, slot: string) => `<span class="b-slot-pill">【 ${slot} 】</span>`,
  );
  return withSlots.replace(/\n/g, "<br>");
}

function renderScenarioBlock(block: BScenarioBlock): string {
  if (block.type === "markdown") {
    const paragraphs = block.content
      .split(/\n{2,}/)
      .map((p) => `<p class="b-paragraph">${formatRichText(p.trim())}</p>`)
      .join("");
    return `<section class="b-block b-block-text" id="b-ref-${esc(block.id)}" data-b-block="${esc(block.id)}">${paragraphs}</section>`;
  }
  if (block.type === "table") {
    const headerCells = block.headers
      .map((h) => `<th scope="col">${formatRichText(h)}</th>`)
      .join("");
    const bodyRows = block.rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${formatRichText(cell)}</td>`).join("")}</tr>`,
      )
      .join("");
    const notes = block.notes?.length
      ? `<div class="b-table-notes">${block.notes.map((n) => `<p>${formatRichText(n)}</p>`).join("")}</div>`
      : "";
    return `<section class="b-block b-block-table" id="b-ref-${esc(block.id)}" data-b-block="${esc(block.id)}">
      <div class="b-table-caption">
        <span>${esc(block.title)}</span>
        ${block.scrollable ? '<span class="b-scroll-hint">左右にスクロールできます</span>' : ""}
      </div>
      <div class="b-table-wrap${block.scrollable ? " scrollable" : ""}">
        <table class="b-data-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      ${notes}
    </section>`;
  }
  if (block.type === "dialogue") {
    const lines = block.lines
      .map(
        (line) =>
          `<div class="b-dialogue-line"><div class="b-dialogue-speaker">${esc(line.speaker)}${line.role ? ` <span class="muted small">(${esc(line.role)})</span>` : ""}</div><p>${formatRichText(line.text)}</p></div>`,
      )
      .join("");
    return `<section class="b-block b-block-dialogue" id="b-ref-${esc(block.id)}" data-b-block="${esc(block.id)}">
      ${block.title ? `<div class="b-table-caption"><span>${esc(block.title)}</span></div>` : ""}
      <div class="b-dialogue-list">${lines}</div>
    </section>`;
  }
  if (block.type === "callout") {
    return `<section class="b-block b-block-callout" id="b-ref-${esc(block.id)}" data-b-block="${esc(block.id)}">
      ${block.title ? `<div class="b-callout-title">${esc(block.title)}</div>` : ""}
      <p>${formatRichText(block.content)}</p>
    </section>`;
  }
  return `<section class="b-block b-block-image" id="b-ref-${esc(block.id)}" data-b-block="${esc(block.id)}">
    <div class="b-table-caption"><span>${esc(block.title)}</span></div>
    <figure class="question-figure"><img class="question-image" src="/api/images/${esc(block.asset_key)}" alt="${esc(block.alt)}"></figure>
  </section>`;
}

function categoryNameById(id: string): string {
  const c = bCategories.find((cat) => cat.id === id);
  return c ? `${c.code}. ${c.name}` : id;
}

function renderSetupView(ctx: KamokuBContext): void {
  stopTimer();
  const isAdmin = ctx.isAdmin();
  const sampleCases = bSampleCases.filter(
    (c) => c.published && c.origin === "ipa_sample" && c.access_tier === "free",
  );
  const originalFreeCases = bSampleCases.filter(
    (c) => c.published && c.origin === "ai_original" && c.access_tier === "free",
  );
  const originalPaidCases = bSampleCases.filter(
    (c) => c.published && c.origin === "ai_original" && c.access_tier === "paid",
  );
  const visibleOriginalCases = isAdmin
    ? [...originalFreeCases, ...originalPaidCases]
    : originalFreeCases;
  const activeCases =
    activeSetupTab === "sample" ? sampleCases : visibleOriginalCases;
  const majors = bCategories.filter((c) => c.level === 1);

  const renderCaseRows = (list: BCase[], showTierBadge = false) => `
    <div class="b-case-select-list">
      ${list
        .map(
          (c) => `<div class="b-case-select-row">
            <label class="b-case-select-label">
              <input type="checkbox" name="b-case" value="${esc(c.id)}" ${selectedCaseIds.includes(c.id) ? "checked" : ""}>
              <div class="b-case-select-title-line">
                ${
                  showTierBadge
                    ? c.access_tier === "paid"
                      ? '<span class="b-badge b-badge-paid">有料</span>'
                      : '<span class="b-badge b-badge-free">無料</span>'
                    : ""
                }
                <strong>${esc(c.title)}</strong>
                <span class="small muted">目安 ${c.estimated_minutes}分 ／ ${difficultyLabels[c.difficulty_level]}</span>
              </div>
            </label>
            <button type="button" class="secondary b-tiny-btn b-case-direct-btn" data-b-direct-case="${esc(c.id)}">この問題を解く</button>
          </div>`,
        )
        .join("")}
    </div>
    <div class="category-controls">
      <div class="settings">
        <label class="check">
          <input type="checkbox" name="b-timer" ${showTimer ? "checked" : ""}>
          目安タイマーを表示する
        </label>
        <label class="check">
          <input type="checkbox" name="b-slot-filter" ${enableSlotFilter ? "checked" : ""}>
          空欄の絞り込みメモを使う
        </label>
      </div>
      <div class="category-actions">
        <button type="button" class="secondary" data-b-case-all>全選択</button>
        <button type="button" class="secondary" data-b-case-none>全解除</button>
      </div>
    </div>
  `;

  const sampleTabPanel = renderCaseRows(sampleCases, false);

  const originalTabPanel = `
    ${
      visibleOriginalCases.length
        ? `<div class="b-original-trial-block">
            <div class="b-paid-panel-head">
              <strong>オリジナル演習問題（AI作成）</strong>
            </div>
            ${renderCaseRows(visibleOriginalCases, true)}
          </div>`
        : ""
    }
    <div class="b-paid-panel${visibleOriginalCases.length ? " b-paid-panel-divided" : ""}">
      <div class="b-paid-panel-head">
        <span class="b-badge b-badge-paid">有料プラン（準備中）</span>
        <strong>${!isAdmin && originalPaidCases.length ? `🔒 有料オリジナル問題 ${originalPaidCases.length}問収録済み（有料会員向けに公開予定）` : "今後の追加予定"}</strong>
      </div>
      <p class="small muted">${esc(bPlannedPaidSummary.description)}</p>
      <ul class="b-plan-list small">
        <li><strong>科目Aの全問題：</strong>無料（過去問・サンプル・オリジナル問題すべて）</li>
        <li><strong>科目BのIPA公式サンプル問題：</strong>無料（ゲストでも2ペイン演習・解説を利用可能）</li>
        <li><strong>科目Bのオリジナル演習問題：</strong>有料プランとして順次公開予定（現在、管理者アカウントのみ有料問題のプレビューが可能）</li>
      </ul>
      <div class="b-planned-themes">
        <p class="small"><strong>収録予定の技能分野（全4大項目・16小項目）</strong></p>
        <div class="b-tag-row">
          ${majors.map((m) => `<span class="b-skill-tag">🔒 ${esc(m.code)}. ${esc(m.name)}</span>`).join("")}
        </div>
      </div>
    </div>
  `;

  const totalPublished = sampleCases.length + visibleOriginalCases.length;

  ctx.render(`
    <div class="section-heading">
      <div>
        <h1>今日の学習を始めましょう。</h1>
        <p class="muted">問題を選んで、自分のペースで科目Bのケース演習に取り組めます。</p>
      </div>
    </div>
    ${noticeText ? `<div role="status" class="notice">${esc(noticeText)}</div>` : ""}
    <form id="b-practice-form" class="card setup">
      <div class="setup-heading">
        <h2>出題条件</h2>
        <span class="small muted">利用可能な問題 ${totalPublished}問</span>
      </div>

      <div class="b-setup-tabs" role="tablist" aria-label="問題の種類">
        <button type="button" role="tab" class="b-setup-tab${activeSetupTab === "sample" ? " active" : ""}" data-b-setup-tab="sample" aria-selected="${activeSetupTab === "sample"}">
          IPA公式サンプル（無料）
        </button>
        <button type="button" role="tab" class="b-setup-tab${activeSetupTab === "original" ? " active" : ""}" data-b-setup-tab="original" aria-selected="${activeSetupTab === "original"}">
          オリジナル演習問題（AI作成・${isAdmin ? `全${visibleOriginalCases.length}問` : `無料体験${originalFreeCases.length}問`}）
        </button>
      </div>

      <div class="b-setup-tabpanel" role="tabpanel">
        ${activeSetupTab === "sample" ? sampleTabPanel : originalTabPanel}
      </div>

      ${
        activeCases.length
          ? `<div class="setup-actions">
              <button type="submit">選択した問題を出題する</button>
            </div>`
          : ""
      }
    </form>
  `);

  noticeText = "";

  document
    .querySelectorAll<HTMLButtonElement>("[data-b-setup-tab]")
    .forEach((btn) => {
      btn.onclick = () => {
        activeSetupTab =
          btn.dataset.bSetupTab === "original" ? "original" : "sample";
        renderSetupView(ctx);
      };
    });

  const form = document.querySelector<HTMLFormElement>("#b-practice-form");
  const caseInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="b-case"]'),
  );
  const syncCases = () => {
    const visibleIds = new Set(activeCases.map((c) => c.id));
    const checkedVisible = caseInputs
      .filter((i) => i.checked)
      .map((i) => i.value);
    selectedCaseIds = [
      ...selectedCaseIds.filter((id) => !visibleIds.has(id)),
      ...checkedVisible,
    ];
  };
  caseInputs.forEach((input) => input.addEventListener("change", syncCases));

  document.querySelector("[data-b-case-all]")?.addEventListener("click", () => {
    caseInputs.forEach((i) => (i.checked = true));
    syncCases();
  });
  document.querySelector("[data-b-case-none]")?.addEventListener("click", () => {
    caseInputs.forEach((i) => (i.checked = false));
    syncCases();
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-b-direct-case]")
    .forEach((btn) => {
      btn.onclick = () => {
        const fd = form ? new FormData(form) : null;
        if (fd) {
          showTimer = fd.has("b-timer");
          enableSlotFilter = fd.has("b-slot-filter");
        }
        const target = activeCases.find(
          (c) => c.id === btn.dataset.bDirectCase,
        );
        if (target) startExerciseWithCases([target], ctx);
      };
    });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!activeCases.length) return;
    const fd = new FormData(form);
    const checkedIds = fd.getAll("b-case").map(String);
    showTimer = fd.has("b-timer");
    enableSlotFilter = fd.has("b-slot-filter");
    if (!checkedIds.length) {
      noticeText = "問題を1つ以上選択してください。";
      renderSetupView(ctx);
      return;
    }
    const selected = activeCases.filter((c) => checkedIds.includes(c.id));
    if (!selected.length) {
      noticeText = "選択された問題が見つかりません。";
      renderSetupView(ctx);
      return;
    }
    startExerciseWithCases(selected, ctx);
  });
}

function startExerciseWithCases(cases: BCase[], ctx: KamokuBContext): void {
  const allowedCases = cases.filter(
    (c) => c.access_tier === "free" || ctx.isAdmin(),
  );
  if (!allowedCases.length) {
    noticeText = "有料問題は現在、管理者アカウントのみ閲覧・演習できます。";
    renderSetupView(ctx);
    return;
  }
  currentExercise = {
    id: crypto.randomUUID(),
    show_timer: showTimer,
    enable_slot_filter: enableSlotFilter,
    items: allowedCases.map((c) => ({
      id: crypto.randomUUID(),
      case_data: c,
      answers: {},
      revealed: false,
    })),
  };
  currentIndex = 0;
  currentQuestionIndex = 0;
  draftChoiceId = null;
  mobileTab = "case";
  markerEnabled = false;
  timerPaused = false;
  elapsedSeconds = 0;
  renderExerciseView(ctx);
}

function renderMatrixChoices(
  q: BQuestion,
  item: BExerciseItem,
  locked: boolean,
  selectedId: number | null,
  correctId: number | undefined,
): string {
  const cols = q.matrix_columns ?? [];
  const eliminated = eliminatedChoicesMap.get(item) ?? new Set<number>();
  const slotFilters = slotFiltersMap.get(item) ?? {};
  const hasFilter = Object.values(slotFilters).some(Boolean);
  const colValues = matrixColumnValues(q);

  const matchedCount = hasFilter
    ? q.choices.filter((c) => matchesMatrixFilter(c, slotFilters)).length
    : q.choices.length;

  const filterBar =
    currentExercise?.enable_slot_filter && !locked && cols.length > 0
      ? `<div class="b-slot-filter-bar" aria-label="空欄ごとの絞り込みメモ">
          <div class="b-slot-filter-head">
            <span class="small"><strong>空欄ごとの絞り込みメモ</strong>（学習支援）</span>
            <span class="small muted">${hasFilter ? `合致：${matchedCount}件` : "仮の答えを選ぶと該当行を強調します"}</span>
            ${hasFilter ? '<button type="button" class="secondary b-tiny-btn" data-b-reset-filter>リセット</button>' : ""}
          </div>
          <div class="b-slot-filter-controls">
            ${cols
              .map(
                (col, colIdx) => `<label class="b-slot-filter-item">
                  <span>【 ${esc(col)} 】</span>
                  <select data-b-slot-select="${colIdx}">
                    <option value="">すべて</option>
                    ${colValues[colIdx]!
                      .map(
                        (v) =>
                          `<option value="${esc(v)}" ${slotFilters[colIdx] === v ? "selected" : ""}>${esc(v)}</option>`,
                      )
                      .join("")}
                  </select>
                </label>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

  const rows = q.choices
    .map((choice) => {
      const isEliminated = eliminated.has(choice.id);
      const isFilteredOut = hasFilter && !matchesMatrixFilter(choice, slotFilters);
      const isSelected = selectedId === choice.id;
      const isCorrect = correctId === choice.id;
      const isWrongSelected = locked && isSelected && correctId != null && !isCorrect;
      const rowClasses = [
        "b-matrix-row",
        isSelected ? "selected" : "",
        isCorrect ? "correct" : "",
        isWrongSelected ? "incorrect" : "",
        isEliminated ? "eliminated" : "",
        isFilteredOut && !locked ? "filtered-out" : "",
        hasFilter && !isFilteredOut && !locked ? "filtered-match" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const statusBadge = isCorrect
        ? '<span class="b-row-badge correct">正解</span>'
        : isWrongSelected
          ? '<span class="b-row-badge incorrect">選択</span>'
          : "";

      return `<tr class="${rowClasses}" data-b-choice-row="${choice.id}">
        <td class="b-matrix-symbol">
          <button type="button" class="b-matrix-pick" data-b-pick="${choice.id}" aria-pressed="${isSelected}" ${locked || isEliminated ? "disabled" : ""}>
            <span class="b-choice-circle">${esc(choice.label)}</span>
          </button>
          ${statusBadge}
        </td>
        ${(choice.cells ?? []).map((cell) => `<td>${esc(cell)}</td>`).join("")}
        <td class="b-matrix-elim">
          ${
            !locked
              ? `<button type="button" class="b-elim-btn" data-b-elim-choice="${choice.id}" aria-pressed="${isEliminated}" title="${isEliminated ? "除外を解除" : "候補から除外"}">${isEliminated ? "戻す" : "×"}</button>`
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");

  return `${filterBar}
    <div class="b-matrix-wrap">
      <table class="b-matrix-table">
        <thead>
          <tr>
            <th scope="col" class="b-matrix-symbol-th">記号</th>
            ${cols.map((col) => `<th scope="col">【 ${esc(col)} 】</th>`).join("")}
            <th scope="col" class="b-matrix-elim-th">${!locked ? "除外" : ""}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderSingleChoices(
  q: BQuestion,
  item: BExerciseItem,
  locked: boolean,
  selectedId: number | null,
  correctId: number | undefined,
): string {
  const eliminated = eliminatedChoicesMap.get(item) ?? new Set<number>();
  return `<div class="b-single-choices">${q.choices
    .map((choice) => {
      const isEliminated = eliminated.has(choice.id);
      const isSelected = selectedId === choice.id;
      const isCorrect = correctId === choice.id;
      const isWrongSelected = locked && isSelected && correctId != null && !isCorrect;
      return `<div class="b-single-choice ${isSelected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isWrongSelected ? "incorrect" : ""} ${isEliminated ? "eliminated" : ""}">
        <button type="button" class="b-single-pick" data-b-pick="${choice.id}" aria-pressed="${isSelected}" ${locked || isEliminated ? "disabled" : ""}>
          <span class="b-choice-circle">${esc(choice.label)}</span>
          <span>${esc(choice.body ?? "")}</span>
        </button>
        ${
          !locked
            ? `<button type="button" class="b-elim-btn" data-b-elim-choice="${choice.id}" aria-pressed="${isEliminated}" title="${isEliminated ? "除外を解除" : "候補から除外"}">${isEliminated ? "戻す" : "×"}</button>`
            : ""
        }
      </div>`;
    })
    .join("")}</div>`;
}

function renderExplanationSection(
  c: BCase,
  q: BQuestion,
  item: BExerciseItem,
): string {
  const answer = item.answers[q.id];
  if (!answer && !item.revealed) return "";

  const correctChoice = q.choices.find((ch) => ch.id === q.correct_choice_id);
  const resultClass = answer ? (answer.correct ? " correct" : " incorrect") : "";
  const heading = answer
    ? answer.correct
      ? "正解です"
      : "不正解です"
    : "正解・解説";

  const tableBlockMap = new Map<string, { num: number; title: string }>();
  let tableSeq = 0;
  for (const b of c.scenario_blocks) {
    if (b.type === "table") {
      tableSeq += 1;
      tableBlockMap.set(b.id, { num: tableSeq, title: b.title });
    }
  }

  const stepsHtml = q.explanation.steps
    .map((step) => {
      const refButtons = step.refs
        .map((refId) => {
          const tbl = tableBlockMap.get(refId);
          if (!tbl) return "";
          return `<button type="button" class="b-jump-chip" data-b-jump-ref="${esc(refId)}" title="${esc(tbl.title)}を見る" aria-label="${esc(tbl.title)}を見る">${tableIconSvg}<span>${tbl.num}</span></button>`;
        })
        .filter(Boolean)
        .join("");
      return `<li class="b-exp-step">
        <div class="b-exp-step-head">
          <span class="b-slot-pill">【 ${esc(step.slot)} 】</span>
          <strong class="b-exp-step-answer">${esc(step.answer)}</strong>
          <div class="b-ref-chips">${refButtons}</div>
        </div>
        <div class="b-exp-step-body">${renderExplanationMarkdown(step.detail)}</div>
      </li>`;
    })
    .join("");

  const candidateNotesHtml = q.explanation.candidate_notes?.length
    ? `<div class="b-exp-block">
        <h3>候補・紛らわしい判断の比較</h3>
        <ul class="b-candidate-notes">
          ${q.explanation.candidate_notes
            .map(
              (note) => `<li class="b-candidate-note ${note.is_correct ? "is-correct" : "is-wrong"}">
                <div class="b-candidate-note-head">
                  <strong>${esc(note.key)}</strong>
                  <span class="b-row-badge ${note.is_correct ? "correct" : "incorrect"}">${note.is_correct ? "適切" : "不適切"}</span>
                </div>
                <div>${renderExplanationMarkdown(note.detail)}</div>
              </li>`,
            )
            .join("")}
        </ul>
      </div>`
    : "";

  return `<section class="explanation b-explanation${resultClass}">
    <div class="b-exp-header">
      <h2>${heading} · 正解：${esc(correctChoice?.label ?? "")}</h2>
      ${answer ? `<span class="small muted">解答時間 ${formatElapsed(answer.elapsed_seconds)}</span>` : ""}
    </div>

    <div class="b-exp-meta">
      <p class="small"><strong>出題趣旨：</strong>${esc(c.exam_intent)}</p>
    </div>

    <div class="b-exp-block">
      <h3>全体の考え方</h3>
      <div class="explanation-body">${renderExplanationMarkdown(q.explanation.summary)}</div>
    </div>

    <div class="b-exp-block">
      <h3>空欄別・ステップ別の根拠</h3>
      <ol class="b-exp-steps">${stepsHtml}</ol>
    </div>

    ${candidateNotesHtml}

    ${
      q.explanation.practice_tip
        ? `<div class="b-exp-tip"><strong>解法のポイント：</strong>${esc(q.explanation.practice_tip)}</div>`
        : ""
    }

    ${
      c.related_a_categories.length
        ? `<div class="b-exp-related small muted">関連する科目A分野：${c.related_a_categories.map((name) => `<span class="b-related-tag">${esc(name)}</span>`).join(" ")}</div>`
        : ""
    }
  </section>`;
}

function renderExerciseView(ctx: KamokuBContext, preserveScroll = false): void {
  const prevLeftScroll = preserveScroll
    ? (document.querySelector<HTMLElement>(".b-pane-left")?.scrollTop ?? 0)
    : 0;
  const prevRightScroll = preserveScroll
    ? (document.querySelector<HTMLElement>(".b-pane-right")?.scrollTop ?? 0)
    : 0;
  const prevWindowScrollY = preserveScroll ? window.scrollY : 0;

  const ex = currentExercise;
  if (!ex) {
    renderSetupView(ctx);
    return;
  }

  const item = ex.items[currentIndex];
  if (!item) {
    stopTimer();
    const totalQuestions = ex.items.reduce(
      (sum, it) => sum + it.case_data.questions.length,
      0,
    );
    const correctCount = ex.items.reduce(
      (sum, it) =>
        sum + Object.values(it.answers).filter((a) => a.correct).length,
      0,
    );
    ctx.render(`
      <section class="card completed">
        <span class="eyebrow">WELL DONE</span>
        <h1>科目B 演習が完了しました。</h1>
        <p>${correctCount}問正解 ／ ${totalQuestions}問</p>
        <div class="setup-actions" style="justify-content:center;">
          <button type="button" data-b-finish>科目Bの出題条件へ戻る</button>
        </div>
      </section>
    `);
    document.querySelector("[data-b-finish]")?.addEventListener("click", () => {
      currentExercise = null;
      renderSetupView(ctx);
    });
    return;
  }

  const c = item.case_data;
  const q = c.questions[currentQuestionIndex] ?? c.questions[0]!;
  const answer = item.answers[q.id];
  const locked = Boolean(answer);
  const selectedId = answer ? answer.selected_choice_id : draftChoiceId;
  const correctId = answer || item.revealed ? q.correct_choice_id : undefined;
  const eliminatedCandidates =
    eliminatedCandidatesMap.get(item) ?? new Set<string>();
  eliminatedCandidatesMap.set(item, eliminatedCandidates);

  const jumpChips = c.scenario_blocks
    .filter((b): b is Extract<BScenarioBlock, { type: "table" }> => b.type === "table")
    .map(
      (b, idx) =>
        `<button type="button" class="b-jump-chip" data-b-jump="${esc(b.id)}" title="${esc(b.title)}" aria-label="${esc(b.title)}へジャンプ">${tableIconSvg}<span>${idx + 1}</span></button>`,
    )
    .join("");

  const scenarioHtml = c.scenario_blocks.map(renderScenarioBlock).join("");
  const savedMarkedHtml = markedScenarioHtmlMap.get(item);
  const scenarioBodyContent =
    savedMarkedHtml ??
    `<div class="b-case-title-line">
              <h1>${esc(c.title)}</h1>
              <span class="b-badge ${c.access_tier === "free" ? "b-badge-free" : "b-badge-paid"}">${c.access_tier === "free" ? "無料" : "有料"}</span>
            </div>
            ${scenarioHtml}`;

  const candidatesHtml = q.candidates?.length
    ? `<div class="b-candidates-box">
        <div class="b-candidates-head">
          <strong>選択肢の候補文</strong>
          <span class="small muted">クリックで取り消し線を付けられます</span>
        </div>
        <ul class="b-candidates-list">
          ${q.candidates
            .map((cand) => {
              const isElim = eliminatedCandidates.has(cand.key);
              return `<li>
                <button type="button" class="b-candidate-btn${isElim ? " eliminated" : ""}" data-b-elim-cand="${esc(cand.key)}" aria-pressed="${isElim}">
                  <span class="b-candidate-key">${esc(cand.key)}</span>
                  <span class="b-candidate-body">${esc(cand.body)}</span>
                </button>
              </li>`;
            })
            .join("")}
        </ul>
      </div>`
    : "";

  const choicesHtml =
    q.question_type === "matrix_combination"
      ? renderMatrixChoices(q, item, locked, selectedId, correctId)
      : renderSingleChoices(q, item, locked, selectedId, correctId);

  const questionTabsHtml =
    c.questions.length > 1
      ? `<div class="b-subq-tabs" role="tablist">${c.questions
          .map(
            (subq, idx) =>
              `<button type="button" role="tab" class="b-subq-tab${idx === currentQuestionIndex ? " active" : ""}" data-b-subq="${idx}" aria-selected="${idx === currentQuestionIndex}">設問 ${subq.position}${item.answers[subq.id] ? (item.answers[subq.id]!.correct ? " ✓" : " ×") : ""}</button>`,
          )
          .join("")}</div>`
      : "";

  const pauseIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8"/></svg>`;
  const playIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4.2 2.8a.7.7 0 0 1 1.06-.6l8.1 5.2a.7.7 0 0 1 0 1.2l-8.1 5.2A.7.7 0 0 1 4.2 13.2V2.8z"/></svg>`;
  const limitSec = c.estimated_minutes * 60;
  const timerHtml = ex.show_timer
    ? `<div class="b-timer-widget">
        <span class="b-timer-text${elapsedSeconds > limitSec ? " over-time" : ""}" data-b-timer-text>${formatElapsed(elapsedSeconds)} / 目安 ${formatElapsed(limitSec)}</span>
        ${!locked ? `<button type="button" class="secondary b-icon-btn" data-b-toggle-timer aria-label="${timerPaused ? "タイマーを再開" : "タイマーを一時停止"}" title="${timerPaused ? "タイマーを再開" : "タイマーを一時停止"}">${timerPaused ? playIcon : pauseIcon}</button>` : ""}
      </div>`
    : "";

  const isLastCase = currentIndex === ex.items.length - 1;

  ctx.render(`
    <div class="b-workspace${wideCaseMode ? " wide-case" : ""}" data-mobile-tab="${mobileTab}">
      <div class="b-topbar card">
        <div class="b-topbar-left">
          <button type="button" class="secondary b-tiny-btn" data-b-back-setup>← 出題条件</button>
          <span class="b-progress-badge">ケース ${currentIndex + 1} / ${ex.items.length}</span>
          <span class="b-case-source">${esc(c.source || c.title)}</span>
        </div>
        <div class="b-topbar-right">
          <button type="button" class="${wideCaseMode ? "" : "secondary "}b-tiny-btn b-wide-toggle" data-b-toggle-wide aria-pressed="${wideCaseMode}">${wideCaseMode ? "回答欄を表示" : "問題文を広く表示"}</button>
          ${timerHtml}
        </div>
      </div>

      <div class="b-mobile-tabs" role="tablist">
        <button type="button" role="tab" class="b-mobile-tab${mobileTab === "case" ? " active" : ""}" data-b-mobile-tab="case" aria-selected="${mobileTab === "case"}">問題文・資料</button>
        <button type="button" role="tab" class="b-mobile-tab${mobileTab === "question" ? " active" : ""}" data-b-mobile-tab="question" aria-selected="${mobileTab === "question"}">設問・解答${answer ? "（解答済）" : ""}</button>
      </div>

      <div class="b-split-panes">
        <article class="card b-pane b-pane-left" aria-label="ケース本文と資料">
          <div class="b-jump-bar" role="navigation" aria-label="表へジャンプ">
            <div class="b-jump-links">
              ${jumpChips}
            </div>
            <div class="b-pane-tools">
              <button type="button" class="underline-toggle b-marker-toggle" data-b-marker-toggle aria-pressed="${markerEnabled}" title="問題文や表のテキストを選んでマーカーを引く">✎</button>
              <button type="button" class="secondary b-tiny-btn b-clear-marks-btn" data-b-clear-marks hidden>消去</button>
              ${whiteboardToggle}
            </div>
          </div>
          <div class="b-scenario-body${markerEnabled ? " marker-mode" : ""}" id="b-scenario-body">
            ${scenarioBodyContent}
          </div>
        </article>

        <section class="card b-pane b-pane-right" aria-label="設問と解答">
          <div class="b-mobile-ref-trigger">
            <button type="button" class="secondary b-tiny-btn" data-b-open-ref-modal>📄 問題文・表を別枠で確認</button>
          </div>
          ${questionTabsHtml}
          <div class="b-prompt-box">
            <h2 class="b-prompt-heading">設問</h2>
            <p class="b-prompt-text">${formatRichText(q.prompt)}</p>
          </div>
          ${candidatesHtml}
          <div class="b-choices-section">
            <div class="b-choices-head">
              <h3>解答群</h3>
              ${!locked ? '<span class="small muted">行を選んで「回答を確定する」を押してください</span>' : ""}
            </div>
            ${choicesHtml}
          </div>

          <div class="b-submit-bar">
            ${
              !locked
                ? `<button type="button" data-b-confirm-answer ${selectedId == null ? "disabled" : ""}>回答を確定する${selectedId != null ? `（${esc(q.choices.find((ch) => ch.id === selectedId)?.label ?? "")}）` : ""}</button>
                   ${!item.revealed ? '<button type="button" class="secondary" data-b-reveal>先に正答・解説を見る</button>' : ""}`
                : `<button type="button" data-b-next-case>${isLastCase ? "演習を終了する" : "次のケースへ進む →"}</button>`
            }
          </div>

          ${renderExplanationSection(c, q, item)}
        </section>
      </div>

      <dialog id="b-ref-dialog" class="b-dialog b-ref-dialog" aria-labelledby="b-ref-dialog-title">
        <div class="question-edit-heading">
          <h2 id="b-ref-dialog-title">資料参照：${esc(c.title)}</h2>
          <button type="button" class="secondary" data-b-close-ref-modal>閉じる</button>
        </div>
        <div class="b-ref-dialog-body">${scenarioHtml}</div>
      </dialog>
    </div>
  `);

  bindExerciseEvents(item, q, ctx);
  startTimer(item);

  if (preserveScroll) {
    const leftPane = document.querySelector<HTMLElement>(".b-pane-left");
    const rightPane = document.querySelector<HTMLElement>(".b-pane-right");
    if (leftPane) {
      leftPane.style.scrollBehavior = "auto";
      leftPane.scrollTop = prevLeftScroll;
      leftPane.style.scrollBehavior = "";
    }
    if (rightPane) {
      rightPane.style.scrollBehavior = "auto";
      rightPane.scrollTop = prevRightScroll;
      rightPane.style.scrollBehavior = "";
    }
    window.scrollTo({ top: prevWindowScrollY, behavior: "instant" });
  }
}

function scrollAndFlashBlock(blockId: string): void {
  const isMobile = window.matchMedia("(max-width: 1023px)").matches;
  if (isMobile) {
    const dialog = document.querySelector<HTMLDialogElement>("#b-ref-dialog");
    if (dialog) {
      if (!dialog.open) dialog.showModal();
      const target = dialog.querySelector<HTMLElement>(
        `[data-b-block="${CSS.escape(blockId)}"]`,
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.remove("b-flash");
        void target.offsetWidth;
        target.classList.add("b-flash");
      }
      return;
    }
  }
  const leftPane = document.querySelector<HTMLElement>(".b-pane-left");
  const target = leftPane?.querySelector<HTMLElement>(
    `[data-b-block="${CSS.escape(blockId)}"]`,
  );
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("b-flash");
  void target.offsetWidth;
  target.classList.add("b-flash");
}

function bindMarkerTool(item: BExerciseItem): void {
  const body = document.querySelector<HTMLElement>("#b-scenario-body");
  const toggleBtn = document.querySelector<HTMLButtonElement>(
    "[data-b-marker-toggle]",
  );
  const clearBtn = document.querySelector<HTMLButtonElement>(
    "[data-b-clear-marks]",
  );
  if (!body || !toggleBtn || !clearBtn) return;

  const updateClearVisibility = () => {
    const hasMarks = body.querySelectorAll("mark.b-highlight").length > 0;
    clearBtn.hidden = !hasMarks;
    if (hasMarks) {
      markedScenarioHtmlMap.set(item, body.innerHTML);
    } else {
      markedScenarioHtmlMap.delete(item);
    }
  };

  // 復元されたマーカーに合わせて消去ボタン表示を同期
  clearBtn.hidden = body.querySelectorAll("mark.b-highlight").length === 0;

  toggleBtn.onclick = () => {
    markerEnabled = !markerEnabled;
    toggleBtn.setAttribute("aria-pressed", String(markerEnabled));
    body.classList.toggle("marker-mode", markerEnabled);
    window.getSelection()?.removeAllRanges();
  };

  clearBtn.onclick = () => {
    body.querySelectorAll("mark.b-highlight").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
    updateClearVisibility();
  };

  body.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches("mark.b-highlight") && !window.getSelection()?.toString()) {
      const parent = target.parentNode;
      if (!parent) return;
      while (target.firstChild) parent.insertBefore(target.firstChild, target);
      parent.removeChild(target);
      parent.normalize();
      updateClearVisibility();
    }
  });

  body.addEventListener("pointerup", () => {
    if (!markerEnabled) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return;
    if (!sel.toString().trim()) return;
    try {
      const mark = document.createElement("mark");
      mark.className = "b-highlight";
      mark.title = "クリックでマーカーを消す";
      range.surroundContents(mark);
      sel.removeAllRanges();
      updateClearVisibility();
    } catch {
      // 複数要素をまたぐ選択時は安全にスキップ
      sel.removeAllRanges();
    }
  });
}

function bindExerciseEvents(
  item: BExerciseItem,
  q: BQuestion,
  ctx: KamokuBContext,
): void {
  const workspace = document.querySelector<HTMLElement>(".b-workspace");
  if (workspace) bindWhiteboard(workspace);
  bindMarkerTool(item);

  document.querySelector("[data-b-back-setup]")?.addEventListener("click", () => {
    stopTimer();
    currentExercise = null;
    wideCaseMode = false;
    renderSetupView(ctx);
  });

  document
    .querySelector<HTMLButtonElement>("[data-b-toggle-wide]")
    ?.addEventListener("click", (e) => {
      wideCaseMode = !wideCaseMode;
      workspace?.classList.toggle("wide-case", wideCaseMode);
      const btn = e.currentTarget as HTMLButtonElement;
      btn.textContent = wideCaseMode ? "回答欄を表示" : "問題文を広く表示";
      btn.classList.toggle("secondary", !wideCaseMode);
      btn.setAttribute("aria-pressed", String(wideCaseMode));
    });

  document
    .querySelector("[data-b-toggle-timer]")
    ?.addEventListener("click", (e) => {
      timerPaused = !timerPaused;
      const btn = e.currentTarget as HTMLButtonElement;
      const pauseSvg = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8"/></svg>`;
      const playSvg = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4.2 2.8a.7.7 0 0 1 1.06-.6l8.1 5.2a.7.7 0 0 1 0 1.2l-8.1 5.2A.7.7 0 0 1 4.2 13.2V2.8z"/></svg>`;
      btn.innerHTML = timerPaused ? playSvg : pauseSvg;
      const label = timerPaused ? "タイマーを再開" : "タイマーを一時停止";
      btn.setAttribute("aria-label", label);
      btn.title = label;
    });

  document.querySelectorAll<HTMLButtonElement>("[data-b-jump]").forEach((btn) => {
    btn.onclick = () => scrollAndFlashBlock(btn.dataset.bJump!);
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-b-jump-ref]")
    .forEach((btn) => {
      btn.onclick = () => scrollAndFlashBlock(btn.dataset.bJumpRef!);
    });

  document
    .querySelectorAll<HTMLButtonElement>("[data-b-mobile-tab]")
    .forEach((btn) => {
      btn.onclick = () => {
        mobileTab = btn.dataset.bMobileTab === "question" ? "question" : "case";
        renderExerciseView(ctx);
      };
    });

  const refDialog = document.querySelector<HTMLDialogElement>("#b-ref-dialog");
  document
    .querySelector("[data-b-open-ref-modal]")
    ?.addEventListener("click", () => refDialog?.showModal());
  document
    .querySelector("[data-b-close-ref-modal]")
    ?.addEventListener("click", () => refDialog?.close());

  document.querySelectorAll<HTMLButtonElement>("[data-b-subq]").forEach((btn) => {
    btn.onclick = () => {
      currentQuestionIndex = Number(btn.dataset.bSubq);
      draftChoiceId = null;
      renderExerciseView(ctx);
    };
  });

  // 候補文（一）〜（六）の除外トグル
  document
    .querySelectorAll<HTMLButtonElement>("[data-b-elim-cand]")
    .forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.bElimCand!;
        const set = eliminatedCandidatesMap.get(item) ?? new Set<string>();
        if (set.has(key)) set.delete(key);
        else set.add(key);
        eliminatedCandidatesMap.set(item, set);
        renderExerciseView(ctx, true);
      };
    });

  // 空欄絞り込みメモ
  document
    .querySelectorAll<HTMLSelectElement>("[data-b-slot-select]")
    .forEach((sel) => {
      sel.onchange = () => {
        const colIdx = Number(sel.dataset.bSlotSelect);
        const filters = { ...(slotFiltersMap.get(item) ?? {}) };
        if (sel.value) filters[colIdx] = sel.value;
        else delete filters[colIdx];
        slotFiltersMap.set(item, filters);
        renderExerciseView(ctx, true);
      };
    });

  document
    .querySelector("[data-b-reset-filter]")
    ?.addEventListener("click", () => {
      slotFiltersMap.set(item, {});
      renderExerciseView(ctx, true);
    });

  // マトリックス行・単一選択肢の選択
  const locked = Boolean(item.answers[q.id]);
  if (!locked) {
    document
      .querySelectorAll<HTMLButtonElement>("[data-b-pick]")
      .forEach((btn) => {
        btn.onclick = () => {
          draftChoiceId = Number(btn.dataset.bPick);
          renderExerciseView(ctx, true);
        };
      });

    document
      .querySelectorAll<HTMLTableRowElement>("[data-b-choice-row]")
      .forEach((row) => {
        row.onclick = (e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-b-elim-choice]") || target.closest("[data-b-pick]"))
            return;
          const id = Number(row.dataset.bChoiceRow);
          const elim = eliminatedChoicesMap.get(item);
          if (elim?.has(id)) return;
          draftChoiceId = id;
          renderExerciseView(ctx, true);
        };
      });

    document
      .querySelectorAll<HTMLButtonElement>("[data-b-elim-choice]")
      .forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.bElimChoice);
          const set = eliminatedChoicesMap.get(item) ?? new Set<number>();
          if (set.has(id)) set.delete(id);
          else {
            set.add(id);
            if (draftChoiceId === id) draftChoiceId = null;
          }
          eliminatedChoicesMap.set(item, set);
          renderExerciseView(ctx, true);
        };
      });
  }

  // 回答確定
  document
    .querySelector("[data-b-confirm-answer]")
    ?.addEventListener("click", () => {
      if (draftChoiceId == null) return;
      stopTimer();
      item.answers[q.id] = {
        question_id: q.id,
        selected_choice_id: draftChoiceId,
        correct: draftChoiceId === q.correct_choice_id,
        elapsed_seconds: elapsedSeconds,
      };
      draftChoiceId = null;
      renderExerciseView(ctx, true);
      document
        .querySelector(".b-explanation")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

  // 先に正答・解説を見る
  document.querySelector("[data-b-reveal]")?.addEventListener("click", () => {
    item.revealed = true;
    renderExerciseView(ctx, true);
    document
      .querySelector(".b-explanation")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // 次のケースへ
  document
    .querySelector("[data-b-next-case]")
    ?.addEventListener("click", () => {
      stopTimer();
      currentIndex += 1;
      currentQuestionIndex = 0;
      draftChoiceId = null;
      mobileTab = "case";
      markerEnabled = false;
      timerPaused = false;
      elapsedSeconds = 0;
      renderExerciseView(ctx);
    });
}

export function renderKamokuB(ctx: KamokuBContext): void {
  if (currentExercise) {
    renderExerciseView(ctx);
  } else {
    renderSetupView(ctx);
  }
}
