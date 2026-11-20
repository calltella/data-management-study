import type { Question, Category } from "./model.ts";
export const demoCategories: Category[] = [
  { id: "data", parent_id: null, name: "データマネジメント", level: 1 },
  { id: "quality", parent_id: "data", name: "データ品質", level: 2 },
  { id: "quality-basic", parent_id: "quality", name: "品質の改善", level: 3 },
  { id: "db", parent_id: null, name: "データベース", level: 1 },
  { id: "design", parent_id: "db", name: "設計", level: 2 },
  { id: "normal", parent_id: "design", name: "正規化", level: 3 },
];
export const demoQuestions: Question[] = [
  {
    id: "demo-normal",
    title: "正規化の目的",
    body: "関係データベースの正規化の目的として、最も適切なものはどれか。",
    category_id: "normal",
    origin: "ai_original",
    source: "動作確認用サンプル（本番問題ではありません）",
    correct: 1,
    explanation:
      "正規化は、データの重複と、更新・挿入・削除時に生じる不整合を抑えます。",
    choices: [
      { id: 1, body: "データの重複と更新時の不整合を抑える。" },
      { id: 2, body: "すべての表を一つにまとめる。" },
      { id: 3, body: "暗号化を不要にする。" },
      { id: 4, body: "検索結果を必ず一件にする。" },
    ],
  },
  {
    id: "demo-quality",
    title: "データ品質の改善",
    body: "顧客マスターに同じ顧客が複数登録されている。最初に検討する対応として、最も適切なものはどれか。",
    category_id: "quality-basic",
    origin: "ai_original",
    source: "動作確認用サンプル（本番問題ではありません）",
    correct: 2,
    explanation: "同一顧客の判定基準を定め、名寄せと重複の発生防止を進めます。",
    choices: [
      { id: 1, body: "登録済みのデータをすべて削除する。" },
      { id: 2, body: "同一顧客の判定基準を定めて名寄せする。" },
      { id: 3, body: "重複件数が増えるまで放置する。" },
      { id: 4, body: "顧客名の入力を禁止する。" },
    ],
  },
  {
    id: "demo-dependency",
    title: "関数従属性",
    body: "社員番号によって社員名が一意に決まるとき、適切な関数従属性はどれか。",
    category_id: "normal",
    origin: "ai_original",
    source: "動作確認用サンプル（本番問題ではありません）",
    correct: 3,
    explanation: "社員番号が決定項となり、社員名が従属します。",
    choices: [
      { id: 1, body: "社員名 → 社員番号が常に成立する。" },
      { id: 2, body: "社員番号と社員名は独立である。" },
      { id: 3, body: "社員番号 → 社員名が成立する。" },
      { id: 4, body: "関数従属性は表現できない。" },
    ],
  },
];
