-- 分類の絞り込みはページ分割より先に適用する。所有者とRLSは既存RPCと同じ。
create or replace function public.dm_history_by_category(category_ids text[], page_number int default 0)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'answers', coalesce((select jsonb_agg(x) from (
     select a.question_id,q.title,q.category_id,a.selected,a.correct,a.answered_at
     from study.answers a left join study.questions q on q.id=a.question_id
     where a.user_id=study.request_user_id() and q.category_id=any(category_ids)
     order by a.sequence desc limit 50 offset greatest(0,least(page_number,10000))*50
   ) x),'[]'::jsonb),
   'summary',public.dm_history(0)->'summary'
 )
$$;
grant create on schema public to study_executor;
alter function public.dm_history_by_category(text[],integer) owner to study_executor;
revoke all on function public.dm_history_by_category(text[],integer) from public, anon, authenticated;
grant execute on function public.dm_history_by_category(text[],integer) to authenticated;
revoke create on schema public from study_executor;
