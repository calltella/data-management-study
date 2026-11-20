-- 本人の未回答、誤答、正解の順に出題し、同じ優先度内をランダムにする。
create or replace function public.dm_start_exercise(category_ids text[] default '{}',question_count int default 10,wrong_only boolean default false,shuffle_choices boolean default false,replace_existing boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid;ids text[];qid text;ord int[];pos int:=0;begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 if question_count is null or question_count<0 or question_count>100 then raise exception '出題数は1〜100問、または全部で指定してください。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 if exists(select 1 from study.exercises where user_id=study.request_user_id() and status='active') and not replace_existing then raise exception '中断中の演習があります。再開するか、置き換えを選択してください。';end if;
 with recursive selected as(select id from study.categories where id=any(category_ids) union all select c.id from study.categories c join selected s on c.parent_id=s.id)
 select array_agg(candidate.id order by candidate.priority, candidate.draw)
 into ids
 from (
   select q.id,
     case when last_answer.correct is null then 0
          when last_answer.correct = false then 1
          else 2 end as priority,
     random() as draw
   from study.questions q
   left join study.latest last_answer
     on last_answer.question_id = q.id and last_answer.user_id = study.request_user_id()
   where q.published
     and (cardinality(category_ids) = 0 or q.category_id in (select id from selected))
     and (not wrong_only or last_answer.correct is false)
   order by priority, draw
   limit case when question_count = 0 then null else question_count end
 ) candidate;
 if ids is null then raise exception '条件に合う問題がありません。';end if;
 update study.exercises set status='replaced' where user_id=study.request_user_id() and status='active';
 insert into study.exercises(user_id,requested) values(study.request_user_id(),case when question_count=0 then cardinality(ids) else question_count end) returning id into eid;
 foreach qid in array ids loop
 pos:=pos+1; if shuffle_choices then select array_agg(n order by random()) into ord from generate_series(1,4)n;else ord:=array[1,2,3,4];end if;
 insert into study.items(exercise_id,question_id,position,choice_order)values(eid,qid,pos,ord);
 end loop;
 return study.exercise_json(eid);
end $$;
