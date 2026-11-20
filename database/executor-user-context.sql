create function study.request_user_id() returns uuid language sql stable security invoker set search_path='' as $$ select coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
revoke all on function study.request_user_id() from public,anon,authenticated;
grant execute on function study.request_user_id() to study_executor;
CREATE OR REPLACE FUNCTION public.dm_rate_question(question_id text, stars integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 if not exists(select 1 from study.questions q where q.id=question_id and q.origin='ai_original' and q.published) then raise exception 'AI作成の公開問題のみ評価できます。';end if;
 insert into study.ratings values(study.request_user_id(),question_id,stars) on conflict on constraint ratings_pkey do update set stars=excluded.stars;
end $function$
;
CREATE OR REPLACE FUNCTION public.dm_reset_history()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 delete from study.latest where user_id=study.request_user_id();delete from study.exercises where user_id=study.request_user_id();
end $function$
;
CREATE OR REPLACE FUNCTION public.dm_prepare_account_deletion()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if study.request_user_id() is null then raise exception 'ログインが必要です。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 -- 子データを削除してからブロック。以後のアクセスは既発行JWTでも拒否。
 delete from study.latest where user_id=study.request_user_id();delete from study.ratings where user_id=study.request_user_id();delete from study.exercises where user_id=study.request_user_id();
 insert into study.accounts(user_id,blocked)values(study.request_user_id(),true)on conflict(user_id)do update set blocked=true;
end $function$
;
CREATE OR REPLACE FUNCTION public.dm_start_exercise(category_ids text[] DEFAULT '{}'::text[], question_count integer DEFAULT 10, wrong_only boolean DEFAULT false, shuffle_choices boolean DEFAULT false, replace_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare eid uuid;ids text[];qid text;ord int[];pos int:=0;begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 if question_count<1 or question_count>100 then raise exception '出題数は1〜100問で指定してください。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 if exists(select 1 from study.exercises where user_id=study.request_user_id() and status='active') and not replace_existing then raise exception '中断中の演習があります。再開するか、置き換えを選択してください。';end if;
 with recursive selected as(select id from study.categories where id=any(category_ids) union all select c.id from study.categories c join selected s on c.parent_id=s.id)
 select array_agg(x.id) into ids from(select q.id from study.questions q where q.published and (cardinality(category_ids)=0 or q.category_id in(select id from selected)) and (not wrong_only or exists(select 1 from study.latest l where l.user_id=study.request_user_id() and l.question_id=q.id and not l.correct)) order by random() limit question_count)x;
 if ids is null then raise exception '条件に合う問題がありません。';end if;
 update study.exercises set status='replaced' where user_id=study.request_user_id() and status='active';
 insert into study.exercises(user_id,requested) values(study.request_user_id(),question_count) returning id into eid;
 foreach qid in array ids loop
 pos:=pos+1; if shuffle_choices then select array_agg(n order by random()) into ord from generate_series(1,4)n;else ord:=array[1,2,3,4];end if;
 insert into study.items(exercise_id,question_id,position,choice_order)values(eid,qid,pos,ord);
 end loop;
 return study.exercise_json(eid);
end $function$
;
CREATE OR REPLACE FUNCTION public.dm_active_exercise()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select study.exercise_json(id) from study.exercises where user_id=study.request_user_id() and status='active' $function$
;
CREATE OR REPLACE FUNCTION public.dm_submit_answer(item_id uuid, selected_choice integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i study.items;q study.questions;a study.answers;begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 select * into i from study.items where id=item_id;if not found then raise exception '出題が見つかりません。';end if;
 select * into q from study.questions where id=i.question_id;if not found then raise exception '問題は非公開です。';end if;
 select * into a from study.answers where study.answers.item_id=dm_submit_answer.item_id;
 if not found then
 if selected_choice not between 1 and 4 then raise exception '選択肢が不正です。';end if;
 insert into study.answers(item_id,user_id,question_id,sequence,selected,correct,correct_choice,explanation)values(i.id,study.request_user_id(),q.id,i.sequence,selected_choice,selected_choice=q.correct,q.correct,q.explanation) returning * into a;
 insert into study.latest(user_id,question_id,sequence,correct)values(study.request_user_id(),q.id,i.sequence,a.correct) on conflict(user_id,question_id)do update set sequence=excluded.sequence,correct=excluded.correct where excluded.sequence>study.latest.sequence;
 end if;
 if not exists(select 1 from study.items x join study.questions z on z.id=x.question_id where x.exercise_id=i.exercise_id and not exists(select 1 from study.answers b where b.item_id=x.id)) then update study.exercises set status='completed' where id=i.exercise_id;end if;
 return jsonb_build_object('selected',a.selected,'correct',a.correct,'correct_choice',a.correct_choice,'explanation',a.explanation);
end $function$
;
alter policy "account_own" on study."accounts" using ((user_id = study.request_user_id())) with check ((user_id = study.request_user_id()));
alter policy "exercises_own" on study."exercises" using (((user_id = study.request_user_id()) AND study.is_active())) with check (((user_id = study.request_user_id()) AND study.is_active()));
alter policy "answers_own" on study."answers" using (((user_id = study.request_user_id()) AND study.is_active())) with check (((user_id = study.request_user_id()) AND study.is_active()));
alter policy "latest_own" on study."latest" using (((user_id = study.request_user_id()) AND study.is_active())) with check (((user_id = study.request_user_id()) AND study.is_active()));
alter policy "ratings_own" on study."ratings" using (((user_id = study.request_user_id()) AND study.is_active())) with check (((user_id = study.request_user_id()) AND study.is_active()));

