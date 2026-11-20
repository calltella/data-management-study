-- 公開用の問題IDを付与する。既存の主キーや回答履歴は維持する。
alter table study.questions
  add column if not exists public_id uuid not null default pg_catalog.gen_random_uuid() unique;

create or replace function study.question_json(q study.questions, reveal boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',q.id,'public_id',q.public_id,'title',q.title,'body',q.body,'category_id',q.category_id,'origin',q.origin,'source',q.source,'choices',q.choices,'asset_key',q.asset_key,'published',q.published,'my_rating',(select r.stars from study.ratings r where r.question_id=q.id and r.user_id=study.request_user_id()))
 || case when reveal then jsonb_build_object('correct',q.correct,'explanation',q.explanation) else '{}'::jsonb end
$$;
