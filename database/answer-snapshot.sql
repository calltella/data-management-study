alter table study.answers add column correct_choice int;
alter table study.answers add column explanation text;
update study.answers a set correct_choice=q.correct,explanation=q.explanation from study.questions q where q.id=a.question_id;
alter table study.answers alter column correct_choice set not null;
alter table study.answers alter column explanation set not null;
create or replace function study.exercise_json(eid uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',e.id,'requested',e.requested,'available',(select count(*) from study.items i join study.questions q on q.id=i.question_id where i.exercise_id=e.id),'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sequence',i.sequence,'question',study.question_json(q),'choice_order',i.choice_order,'answer',case when a.item_id is null then null else jsonb_build_object('selected',a.selected,'correct',a.correct,'correct_choice',a.correct_choice,'explanation',a.explanation) end) order by i.position) from study.items i join study.questions q on q.id=i.question_id left join study.answers a on a.item_id=i.id where i.exercise_id=e.id),'[]')) from study.exercises e where e.id=eid
$$;
create or replace function public.dm_submit_answer(item_id uuid,selected_choice int) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;