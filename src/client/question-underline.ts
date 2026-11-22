import type { ExerciseItem } from "../model.ts";

type Segment = { start: number; end: number };
type Underlines = { text: string; enabled: boolean; segments: Segment[] };
const annotations = new WeakMap<ExerciseItem, Underlines>();

export const underlineToggle = `<button type="button" class="underline-toggle" aria-label="下線" aria-pressed="false" title="範囲を選んで下線を引く。下線を押すと消せます。">✎</button>`;
export const underlineApply = `<button type="button" class="secondary underline-apply" hidden>選択範囲に下線を引く</button>`;

export function bindQuestionUnderlines(panel: HTMLElement, item: ExerciseItem) {
  const body = panel.querySelector<HTMLElement>(".question-body")!;
  const toggle = panel.querySelector<HTMLButtonElement>(".underline-toggle")!;
  const apply = panel.querySelector<HTMLButtonElement>(".underline-apply")!;
  const touchInput = matchMedia("(any-pointer: coarse)");
  const text = body.textContent ?? "";
  const saved = annotations.get(item);
  const state: Underlines = saved?.text === text ? saved : { text, enabled: false, segments: [] };
  annotations.set(item, state);

  function updateControls() {
    toggle.setAttribute("aria-pressed", String(state.enabled));
    apply.hidden = !state.enabled || !touchInput.matches;
    // 公式冊子が画像の問題では、線を引く間と下線がある間だけ本文も表示する。
    body.classList.toggle("underline-readable", state.enabled || state.segments.length > 0);
  }

  function paint() {
    const content = document.createDocumentFragment();
    let offset = 0;
    for (const segment of state.segments) {
      content.append(text.slice(offset, segment.start));
      const mark = document.createElement("span");
      mark.className = "question-underline";
      mark.textContent = text.slice(segment.start, segment.end);
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", mark.textContent + " の下線を消す");
      const remove = () => {
        state.segments = state.segments.filter((s) => s !== segment);
        paint();
        updateControls();
      };
      mark.onclick = () => {
        if (!window.getSelection()?.toString()) remove();
      };
      mark.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          remove();
          toggle.focus();
        }
      };
      content.append(mark);
      offset = segment.end;
    }
    content.append(text.slice(offset));
    body.replaceChildren(content);
  }

  function selectedSegment(): Segment | undefined {
    const selection = window.getSelection();
    if (!state.enabled || !selection?.rangeCount || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(body);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    return { start, end: start + range.toString().length };
  }

  function underline(segment?: Segment) {
    if (!segment) return;
    const merged = { ...segment };
    state.segments = state.segments.filter((existing) => {
      if (existing.end <= segment.start || existing.start >= segment.end) return true;
      merged.start = Math.min(merged.start, existing.start);
      merged.end = Math.max(merged.end, existing.end);
      return false;
    });
    state.segments.push(merged);
    state.segments.sort((a, b) => a.start - b.start);
    window.getSelection()?.removeAllRanges();
    paint();
    updateControls();
  }

  toggle.onclick = () => {
    window.getSelection()?.removeAllRanges();
    state.enabled = !state.enabled;
    updateControls();
  };
  body.onpointerup = (event) => {
    if (event.pointerType === "mouse" && event.button === 0) underline(selectedSegment());
  };
  // タッチでは選択ハンドルの調整が終わるのを待つ。ボタンへのフォーカス移動前に範囲を控える。
  let pendingSelection: Segment | undefined;
  apply.onpointerdown = (event) => {
    pendingSelection = selectedSegment();
    event.preventDefault();
  };
  apply.onclick = () => {
    underline(pendingSelection ?? selectedSegment());
    pendingSelection = undefined;
  };
  if (state.segments.length) paint();
  updateControls();
}
