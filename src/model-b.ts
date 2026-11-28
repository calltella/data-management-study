export type BAccessTier = "free" | "paid";
export type BOrigin = "ipa_sample" | "ai_original" | "ipa_past";
export type BQuestionType = "matrix_combination" | "single_choice";

export interface BCategory {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  level: 1 | 2;
  sort_order: number;
}

export interface BMarkdownBlock {
  id: string;
  type: "markdown";
  label: string;
  content: string;
}

export interface BTableBlock {
  id: string;
  type: "table";
  label: string;
  title: string;
  headers: string[];
  rows: string[][];
  notes?: string[];
  scrollable?: boolean;
}

export interface BImageBlock {
  id: string;
  type: "image";
  label: string;
  title: string;
  asset_key: string;
  alt: string;
}

export interface BDialogueLine {
  speaker: string;
  role?: string;
  text: string;
}

export interface BDialogueBlock {
  id: string;
  type: "dialogue";
  label: string;
  title?: string;
  lines: BDialogueLine[];
}

export interface BCalloutBlock {
  id: string;
  type: "callout";
  label: string;
  title?: string;
  content: string;
}

export type BScenarioBlock =
  | BMarkdownBlock
  | BTableBlock
  | BImageBlock
  | BDialogueBlock
  | BCalloutBlock;

export interface BCandidateItem {
  key: string;
  body: string;
}

export interface BChoice {
  id: number;
  label: string;
  cells?: string[];
  body?: string;
}

export interface BExplanationStep {
  slot: string;
  answer: string;
  refs: string[];
  detail: string;
}

export interface BCandidateNote {
  key: string;
  is_correct: boolean;
  detail: string;
}

export interface BExplanation {
  summary: string;
  steps: BExplanationStep[];
  candidate_notes?: BCandidateNote[];
  practice_tip?: string;
}

export interface BQuestion {
  id: string;
  position: number;
  question_type: BQuestionType;
  prompt: string;
  candidates?: BCandidateItem[];
  matrix_columns?: string[];
  choices: BChoice[];
  correct_choice_id: number;
  explanation: BExplanation;
}

export interface BCase {
  id: string;
  title: string;
  primary_category_id: string;
  category_ids: string[];
  origin: BOrigin;
  access_tier: BAccessTier;
  source: string;
  estimated_minutes: number;
  difficulty_level: 1 | 2 | 3;
  difficulty_reason?: string;
  exam_intent: string;
  related_a_categories: string[];
  scenario_blocks: BScenarioBlock[];
  questions: BQuestion[];
  published: boolean;
}

export interface BExerciseAnswer {
  question_id: string;
  selected_choice_id: number;
  correct: boolean;
  elapsed_seconds: number;
}

export interface BExerciseItem {
  id: string;
  case_data: BCase;
  answers: Record<string, BExerciseAnswer>;
  revealed: boolean;
}

export interface BExercise {
  id: string;
  items: BExerciseItem[];
  show_timer: boolean;
  enable_slot_filter: boolean;
}

/**
 * 科目Bカテゴリが選択済みカテゴリ（大項目・小項目）に該当するか判定する。
 */
export function includesBCategory(
  caseCategoryIds: readonly string[],
  selectedIds: readonly string[],
  categories: readonly BCategory[],
): boolean {
  if (!selectedIds.length) return true;
  const selectedSet = new Set(selectedIds);
  for (const cid of caseCategoryIds) {
    if (selectedSet.has(cid)) return true;
    const cat = categories.find((c) => c.id === cid);
    if (cat?.parent_id && selectedSet.has(cat.parent_id)) return true;
  }
  return false;
}

/**
 * マトリックス解答群の各列で選択可能な一意の候補値を出現順に返す。
 */
export function matrixColumnValues(question: BQuestion): string[][] {
  const cols = question.matrix_columns ?? [];
  return cols.map((_, colIdx) => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const choice of question.choices) {
      const val = choice.cells?.[colIdx];
      if (val && !seen.has(val)) {
        seen.add(val);
        values.push(val);
      }
    }
    return values;
  });
}

/**
 * 空欄別の絞り込み条件に選択肢が合致するかを返す。
 */
export function matchesMatrixFilter(
  choice: BChoice,
  slotFilters: Record<number, string>,
): boolean {
  for (const [colKey, expected] of Object.entries(slotFilters)) {
    if (!expected) continue;
    const colIdx = Number(colKey);
    if (choice.cells?.[colIdx] !== expected) return false;
  }
  return true;
}

/**
 * 経過秒数を MM:SS 形式に整形する。
 */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
