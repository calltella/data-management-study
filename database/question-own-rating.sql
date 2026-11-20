create or replace function study.question_json(q study.questions, reveal boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',q.id,'title',q.title,'body',q.body,'category_id',q.category_id,'origin',q.origin,'source',q.source,'choices',q.choices,'asset_key',q.asset_key,'published',q.published,'my_rating',(select r.stars from study.ratings r where r.question_id=q.id and r.user_id=study.request_user_id()))
 || case when reveal then jsonb_build_object('correct',q.correct,'explanation',q.explanation) else '{}'::jsonb end
$$;
