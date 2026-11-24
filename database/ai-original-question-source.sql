-- 実行モデル: GPT-6
-- AI作成問題には作成区分の表記だけを記録する。
update study.questions
set source = 'オリジナル演習問題（AI作成）'
where origin = 'ai_original'
  and source <> 'オリジナル演習問題（AI作成）';
