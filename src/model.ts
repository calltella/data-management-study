export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  level: number;
}
export interface Choice {
  id: number;
  body: string;
  explanation?: string;
  diagram_key?: string;
}
export interface Question {
  id: string;
  public_id?: string;
  title: string;
  body: string;
  category_id: string;
  origin: string;
  source: string;
  choices: Choice[];
  asset_key?: string | null;
  my_rating?: number | null;
  rating_count?: number;
  rating_average?: number | null;
  published?: boolean;
  correct?: number;
  explanation?: string;
  diagram_key?: string;
  difficulty_level?: 1 | 2 | 3 | null;
  difficulty_reason?: string | null;
}
export interface ExerciseItem {
  id: string;
  sequence: number;
  question: Question;
  choice_order: number[];
  previous_correct?: boolean | null;
  answer_history?: boolean[];
  answer?: {
    selected: number;
    correct: boolean;
    explanation: string;
    correct_choice: number;
  } | null;
}
export interface Exercise {
  id: string;
  items: ExerciseItem[];
  requested: number;
  available: number;
}
export function shuffled<T>(values: readonly T[], random = Math.random): T[] {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
export function includesCategory(
  id: string,
  selected: string[],
  categories: Category[],
): boolean {
  if (!selected.length) return true;
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    if (selected.includes(current)) return true;
    seen.add(current);
    current = categories.find((c) => c.id === current)?.parent_id ?? null;
  }
  return false;
}

export function orderedCategories(values: Category[]): Category[] {
  const out: Category[] = [];
  const seen = new Set<string>();
  function visit(parent: string | null) {
    for (const c of values.filter((c) => c.parent_id === parent)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      visit(c.id);
    }
  }
  visit(null);
  return out;
}
export function relabelExplanation(text: string, order: number[]): string {
  return text.replace(
    /([「『（(])([アイウエ])([」』）)])|選択肢([アイウエ])/g,
    (_, open, label, close, bare) => {
      const original = "アイウエ".indexOf(label ?? bare) + 1;
      const display = "アイウエ"[order.indexOf(original)] ?? label ?? bare;
      return bare ? "選択肢" + display : open + display + close;
    },
  );
}
