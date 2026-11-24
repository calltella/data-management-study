-- Data API/RPC用。既存オブジェクトを上書きせず、新規アプリのDBへ適用する。
-- study_executorはRLSを回避しない実行専用ロール。公開関数のみにEXECUTEを付与する。
create role study_executor nologin noinherit nobypassrls;
-- 所有者変更のためのSET権限。一般利用者へのメンバー付与はしない。
grant study_executor to postgres;
create schema study;
revoke all on schema study from public;
grant usage on schema study, public to study_executor;
create function study.request_user_id() returns uuid language sql stable security invoker set search_path='' as $$ select coalesce(nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),''),(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid $$;
revoke all on function study.request_user_id() from public,anon,authenticated;
grant execute on function study.request_user_id() to study_executor;
create table study.categories(id text primary key,parent_id text references study.categories(id),name text not null,level int not null check(level between 1 and 3));
create table study.questions(id text primary key,public_id uuid not null default pg_catalog.gen_random_uuid() unique,title text not null,body text not null,category_id text not null references study.categories(id),origin text not null check(origin in('ipa_past','ai_original','ipa_sample')),source text not null default '',choices jsonb not null,correct int not null check(correct between 1 and 4),explanation text not null,asset_key text,published boolean not null default true,check(jsonb_array_length(choices)=4));
create table study.accounts(user_id uuid primary key references auth.users(id) on delete cascade,blocked boolean not null default false);
create table study.exercises(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,requested int not null,status text not null default 'active' check(status in('active','completed','replaced')),created_at timestamptz not null default now());
create unique index one_active_exercise on study.exercises(user_id) where status='active';
create table study.items(id uuid primary key default gen_random_uuid(),sequence bigint generated always as identity unique,exercise_id uuid not null references study.exercises(id) on delete cascade,question_id text not null references study.questions(id),position int not null,choice_order int[] not null,unique(exercise_id,question_id),unique(exercise_id,position));
create table study.answers(item_id uuid primary key references study.items(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,question_id text not null references study.questions(id),sequence bigint not null,selected int not null,correct boolean not null,correct_choice int not null,explanation text not null,answered_at timestamptz not null default now());
create table study.latest(user_id uuid not null references auth.users(id) on delete cascade,question_id text not null references study.questions(id),sequence bigint not null,correct boolean not null,primary key(user_id,question_id));
create table study.ratings(user_id uuid not null references auth.users(id) on delete cascade,question_id text not null references study.questions(id),stars int not null check(stars between 1 and 5),primary key(user_id,question_id));
create index questions_category on study.questions(category_id,published);
create index answers_history on study.answers(user_id,sequence desc);
create index if not exists answers_question_history on study.answers(user_id, question_id, sequence desc);
create index exercises_owner on study.exercises(user_id);
create index items_exercise on study.items(exercise_id,position);
create index latest_wrong on study.latest(user_id,correct);
-- API利用者にはテーブル書き込みを許可せず、検証付きRPCに限定。
grant select,insert,update,delete on all tables in schema study to study_executor;
grant usage,select on all sequences in schema study to study_executor;
-- Auth管理テーブルのRLSを変更せず、本人の権限だけを返す限定ヘルパー。
create function study.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.users where id=study.request_user_id() and raw_app_meta_data->>'dm_study_admin'='true' and not exists(select 1 from study.accounts where user_id=study.request_user_id() and blocked)) $$;
create function study.is_active() returns boolean language sql stable security definer set search_path='' as $$ select study.request_user_id() is not null and exists(select 1 from auth.users where id=study.request_user_id()) and not exists(select 1 from study.accounts where user_id=study.request_user_id() and blocked) $$;
alter table study.categories enable row level security;
alter table study.questions enable row level security;
alter table study.accounts enable row level security;
alter table study.exercises enable row level security;
alter table study.items enable row level security;
alter table study.answers enable row level security;
alter table study.latest enable row level security;
alter table study.ratings enable row level security;
create policy categories_read on study.categories for select to study_executor using(true);
create policy questions_read on study.questions for select to study_executor using(published or study.is_admin());
create policy questions_admin on study.questions for all to study_executor using(study.is_admin()) with check(study.is_admin());
create policy account_own on study.accounts for all to study_executor using(user_id=study.request_user_id()) with check(user_id=study.request_user_id());
create policy exercises_own on study.exercises for all to study_executor using(user_id=study.request_user_id() and study.is_active()) with check(user_id=study.request_user_id() and study.is_active());
create policy items_own on study.items for all to study_executor using(exists(select 1 from study.exercises e where e.id=exercise_id)) with check(exists(select 1 from study.exercises e where e.id=exercise_id));
create policy answers_own on study.answers for all to study_executor using(user_id=study.request_user_id() and study.is_active()) with check(user_id=study.request_user_id() and study.is_active());
create policy latest_own on study.latest for all to study_executor using(user_id=study.request_user_id() and study.is_active()) with check(user_id=study.request_user_id() and study.is_active());
create policy ratings_own on study.ratings for all to study_executor using(user_id=study.request_user_id() and study.is_active()) with check(user_id=study.request_user_id() and study.is_active());

create function study.question_json(q study.questions, reveal boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',q.id,'public_id',q.public_id,'title',q.title,'body',q.body,'category_id',q.category_id,'origin',q.origin,'source',q.source,'choices',q.choices,'asset_key',q.asset_key,'published',q.published,'my_rating',(select r.stars from study.ratings r where r.question_id=q.id and r.user_id=study.request_user_id()))
 || case when reveal then jsonb_build_object('correct',q.correct,'explanation',q.explanation) else '{}'::jsonb end
$$;
create function public.dm_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from study.categories c),'questions',(select coalesce(jsonb_agg(study.question_json(q)),'[]') from study.questions q where published))
$$;
create function public.dm_reveal_question(question_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q study.questions;begin select * into q from study.questions where id=question_id;if not found then raise exception '問題は非公開または削除されています。';end if;return study.question_json(q,true);end $$;
create or replace function study.exercise_json(eid uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'id', e.id,
    'requested', e.requested,
    'available', count(i.id),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'sequence', i.sequence,
      'question', study.question_json(q),
      'choice_order', i.choice_order,
      'previous_correct', previous.results->-1,
      'answer_history', coalesce(previous.results, '[]'::jsonb),
      'answer', case when a.item_id is not null then jsonb_build_object(
        'selected', a.selected, 'correct', a.correct,
        'correct_choice', a.correct_choice, 'explanation', a.explanation
      ) end
    ) order by i.position) filter (where i.id is not null), '[]')
  )
  from study.exercises e
  left join (study.items i join study.questions q on q.id = i.question_id)
    on i.exercise_id = e.id
  left join study.answers a on a.item_id = i.id
  left join lateral (
    select jsonb_agg(history.correct order by history.answered_at, history.sequence) as results
    from study.answers history
    where history.user_id = e.user_id
      and history.question_id = i.question_id
      and history.sequence < i.sequence
  ) previous on true
  where e.id = eid and e.user_id = study.request_user_id()
  group by e.id
$$;
create or replace function public.dm_start_exercise(category_ids text[],question_count int,wrong_only boolean,shuffle_choices boolean,replace_existing boolean,question_origins text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid;ids text[];qid text;ord int[];pos int:=0;begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 if question_count is null or question_count<0 or question_count>100 then raise exception '出題数は1〜100問、または全部で指定してください。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 if exists(select 1 from study.exercises where user_id=study.request_user_id() and status='active') and not replace_existing then raise exception '中断中の演習があります。再開するか、置き換えを選択してください。';end if;
 with recursive selected as(select id from study.categories where id=any(category_ids) union all select c.id from study.categories c join selected s on c.parent_id=s.id)
 select array_agg(candidate.id order by candidate.priority, candidate.answered_at_order asc nulls last, candidate.draw)
 into ids
 from (
   select q.id,
     case when last_answer.correct is null then 0
          when last_answer.correct = false then 1
          else 2 end as priority,
     case when last_answer.correct is true then ans.answered_at else null end as answered_at_order,
     random() as draw
   from study.questions q
   left join study.latest last_answer
     on last_answer.question_id = q.id and last_answer.user_id = study.request_user_id()
   left join lateral (
     select a.answered_at
     from study.answers a
     where a.user_id = study.request_user_id()
       and a.question_id = q.id
     order by a.sequence desc
     limit 1
   ) ans on last_answer.correct is true
   where q.published
     and q.origin = any(question_origins)
     and (cardinality(category_ids) = 0 or q.category_id in (select id from selected))
     and (not wrong_only or last_answer.correct is false)
   order by priority, answered_at_order asc nulls last, draw
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
create or replace function public.dm_start_exercise(category_ids text[] default '{}',question_count int default 10,wrong_only boolean default false,shuffle_choices boolean default false,replace_existing boolean default false) returns jsonb
language sql security invoker set search_path='' as $$
  select public.dm_start_exercise(category_ids, question_count, wrong_only, shuffle_choices,
    replace_existing, array['ipa_past', 'ipa_sample', 'ai_original']::text[])
$$;
create function public.dm_active_exercise() returns jsonb language sql stable security definer set search_path='' as $$ select study.exercise_json(id) from study.exercises where user_id=study.request_user_id() and status='active' $$;
create function public.dm_submit_answer(item_id uuid,selected_choice int) returns jsonb language plpgsql security definer set search_path='' as $$
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
create function public.dm_history(page_number int default 0) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('answers',coalesce((select jsonb_agg(x) from(select a.question_id,q.title,q.category_id,a.selected,a.correct,a.answered_at from study.answers a left join study.questions q on q.id=a.question_id order by a.sequence desc limit 50 offset greatest(0,least(page_number,10000))*50)x),'[]'),'summary',coalesce((select jsonb_agg(x) from(select q.category_id,count(*) as answered,count(*)filter(where a.correct) as correct from study.answers a join study.questions q on q.id=a.question_id group by q.category_id)x),'[]'))
$$;
create function public.dm_rate_question(question_id text,stars int) returns void language plpgsql security definer set search_path='' as $$begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 if not exists(select 1 from study.questions q where q.id=question_id and q.origin='ai_original' and q.published) then raise exception 'AI作成の公開問題のみ評価できます。';end if;
 insert into study.ratings values(study.request_user_id(),question_id,stars) on conflict on constraint ratings_pkey do update set stars=excluded.stars;
end $$;
create function public.dm_reset_history() returns void language plpgsql security definer set search_path='' as $$begin
 if not study.is_active() then raise exception 'ログインが必要です。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 delete from study.latest where user_id=study.request_user_id();delete from study.exercises where user_id=study.request_user_id();
end $$;
create function public.dm_prepare_account_deletion() returns void language plpgsql security definer set search_path='' as $$begin
 if study.request_user_id() is null then raise exception 'ログインが必要です。';end if;
 perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text,0));
 -- 子データを削除してからブロック。以後のアクセスは既発行JWTでも拒否。
 delete from study.latest where user_id=study.request_user_id();delete from study.ratings where user_id=study.request_user_id();delete from study.exercises where user_id=study.request_user_id();
 insert into study.accounts(user_id,blocked)values(study.request_user_id(),true)on conflict(user_id)do update set blocked=true;
end $$;
create function public.dm_admin_questions() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not study.is_admin() then raise exception '管理者権限が必要です。';end if;
 return (select coalesce(jsonb_agg(study.question_json(q,true)||jsonb_build_object('rating_count',(select count(*) from study.ratings r where r.question_id=q.id),'rating_average',(select avg(stars) from study.ratings r where r.question_id=q.id))),'[]') from study.questions q);
end $$;
create function public.dm_admin_save_question(question jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 if not study.is_admin() then raise exception '管理者権限が必要です。';end if;
 if length(trim(question->>'title'))=0 or length(trim(question->>'body'))=0 or jsonb_array_length(question->'choices')<>4 or (question->>'correct')::int not between 1 and 4 then raise exception '問題・選択肢・正答を確認してください。';end if;
 if (select count(distinct (c->>'id')::int) from jsonb_array_elements(question->'choices')c where (c->>'id')::int between 1 and 4 and length(trim(c->>'body'))>0)<>4 then raise exception '選択肢IDは1〜4を各一つ指定してください。';end if;
 update study.questions set title=question->>'title',body=question->>'body',category_id=question->>'category_id',choices=question->'choices',correct=(question->>'correct')::int,explanation=question->>'explanation',published=(question->>'published')::boolean where id=question->>'id';
 if not found then raise exception '問題が見つかりません。';end if;
end $$;
-- 関数の所有者はBYPASSRLSを持たない専用ロール。private helperにも匿名実行権を付けない。
create or replace function public.dm_question_history(category_ids text[] default '{}'::text[])
returns jsonb language sql stable security definer set search_path='' as $$
  with recursive selected as (
    select id from study.categories where id = any(category_ids)
    union all
    select c.id from study.categories c join selected s on c.parent_id = s.id
  )
  select coalesce(jsonb_agg(row_data order by row_data->>'latest_answered_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'question_id', a.question_id,
      'title', q.title,
      'category_id', q.category_id,
      'published', true,
      'answered_count', count(*),
      'correct_count', count(*) filter (where a.correct),
      'latest_correct', (array_agg(a.correct order by a.sequence desc))[1],
      'latest_answered_at', max(a.answered_at),
      'results', jsonb_agg(a.correct order by a.sequence asc)
    ) as row_data
    from study.answers a
    join study.questions q on q.id = a.question_id
    where a.user_id = study.request_user_id()
      and q.published = true
      and (cardinality(category_ids) = 0 or q.category_id in (select id from selected))
    group by a.question_id, q.title, q.category_id
  ) t;
$$;
create or replace function public.dm_start_single_question(target_question_id text, shuffle_choices boolean default false, replace_existing boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare eid uuid; ord int[];
begin
  if not study.is_active() then raise exception 'ログインが必要です。'; end if;
  if not exists(select 1 from study.questions q where q.id = target_question_id and q.published) then raise exception 'この問題は現在公開されていないため出題できません。'; end if;
  perform pg_advisory_xact_lock(hashtextextended(study.request_user_id()::text, 0));
  if exists(select 1 from study.exercises where user_id = study.request_user_id() and status = 'active') and not replace_existing then raise exception '中断中の演習があります。再開するか、置き換えを選択してください。'; end if;
  update study.exercises set status = 'replaced' where user_id = study.request_user_id() and status = 'active';
  insert into study.exercises(user_id, requested) values(study.request_user_id(), 1) returning id into eid;
  if shuffle_choices then select array_agg(n order by random()) into ord from generate_series(1, 4) n; else ord := array[1, 2, 3, 4]; end if;
  insert into study.items(exercise_id, question_id, position, choice_order) values(eid, target_question_id, 1, ord);
  return study.exercise_json(eid);
end $$;
grant execute on all functions in schema study to study_executor;
revoke execute on all functions in schema study from public, anon, authenticated;
grant create on schema public to study_executor;
alter function public.dm_question_history(text[]) owner to study_executor;
revoke all on function public.dm_question_history(text[]) from public, anon, authenticated;
grant execute on function public.dm_question_history(text[]) to authenticated;
alter function public.dm_start_single_question(text,boolean,boolean) owner to study_executor;
revoke all on function public.dm_start_single_question(text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.dm_start_single_question(text,boolean,boolean) to authenticated;
alter function public.dm_catalog() owner to study_executor;
revoke all on function public.dm_catalog() from public, anon, authenticated;
grant execute on function public.dm_catalog() to authenticated, anon;
alter function public.dm_reveal_question(text) owner to study_executor;
revoke all on function public.dm_reveal_question(text) from public, anon, authenticated;
grant execute on function public.dm_reveal_question(text) to authenticated, anon;
alter function public.dm_start_exercise(text[],integer,boolean,boolean,boolean,text[]) owner to study_executor;
revoke all on function public.dm_start_exercise(text[],integer,boolean,boolean,boolean,text[]) from public, anon, authenticated;
grant execute on function public.dm_start_exercise(text[],integer,boolean,boolean,boolean,text[]) to authenticated;
alter function public.dm_start_exercise(text[],integer,boolean,boolean,boolean) owner to study_executor;
revoke all on function public.dm_start_exercise(text[],integer,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.dm_start_exercise(text[],integer,boolean,boolean,boolean) to authenticated;
alter function public.dm_active_exercise() owner to study_executor;
revoke all on function public.dm_active_exercise() from public, anon, authenticated;
grant execute on function public.dm_active_exercise() to authenticated;
alter function public.dm_submit_answer(uuid,integer) owner to study_executor;
revoke all on function public.dm_submit_answer(uuid,integer) from public, anon, authenticated;
grant execute on function public.dm_submit_answer(uuid,integer) to authenticated;
alter function public.dm_history(integer) owner to study_executor;
revoke all on function public.dm_history(integer) from public, anon, authenticated;
grant execute on function public.dm_history(integer) to authenticated;
alter function public.dm_rate_question(text,integer) owner to study_executor;
revoke all on function public.dm_rate_question(text,integer) from public, anon, authenticated;
grant execute on function public.dm_rate_question(text,integer) to authenticated;
alter function public.dm_reset_history() owner to study_executor;
revoke all on function public.dm_reset_history() from public, anon, authenticated;
grant execute on function public.dm_reset_history() to authenticated;
alter function public.dm_prepare_account_deletion() owner to study_executor;
revoke all on function public.dm_prepare_account_deletion() from public, anon, authenticated;
grant execute on function public.dm_prepare_account_deletion() to authenticated;
alter function public.dm_admin_questions() owner to study_executor;
revoke all on function public.dm_admin_questions() from public, anon, authenticated;
grant execute on function public.dm_admin_questions() to authenticated;
alter function public.dm_admin_save_question(jsonb) owner to study_executor;
revoke all on function public.dm_admin_save_question(jsonb) from public, anon, authenticated;
grant execute on function public.dm_admin_save_question(jsonb) to authenticated;
revoke create on schema public from study_executor;
create policy ratings_admin_read on study.ratings for select to study_executor using(study.is_admin());

create function public.dm_account_status() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('active',study.is_active(),'admin',study.is_admin())$$;
create function public.dm_admin_set_asset(question_id text,object_key text) returns void language plpgsql security definer set search_path='' as $$begin
 if not study.is_admin() then raise exception '管理者権限が必要です。';end if;
 update study.questions set asset_key=object_key where id=question_id;if not found then raise exception '問題が見つかりません。';end if;
end $$;
grant create on schema public to study_executor;
alter function public.dm_account_status() owner to study_executor;
alter function public.dm_admin_set_asset(text,text) owner to study_executor;
revoke all on function public.dm_account_status() from public,anon,authenticated;
revoke all on function public.dm_admin_set_asset(text,text) from public,anon,authenticated;
grant execute on function public.dm_account_status() to authenticated;
grant execute on function public.dm_admin_set_asset(text,text) to authenticated;
revoke create on schema public from study_executor;

-- 分類の絞り込みはページ分割より先に適用する。所有者とRLSは既存RPCと同じ。
create or replace function public.dm_history_by_category(category_ids text[], page_number int default 0)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'answers', coalesce((select jsonb_agg(
     (to_jsonb(x) - 'sequence') || jsonb_build_object('previous_results', coalesce((
       select jsonb_agg(previous.correct order by previous.sequence desc)
       from study.answers previous
       where previous.user_id=study.request_user_id()
         and previous.question_id=x.question_id and previous.sequence<x.sequence
     ), '[]'::jsonb)) order by x.sequence desc
   ) from (
     select a.question_id,q.title,q.category_id,a.selected,a.correct,a.answered_at,a.sequence
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

-- 読点だけを統一。数字の桁区切りなどのASCIIカンマは維持する。
create or replace function study.normalize_question_punctuation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.title:=replace(new.title,'，','、');
 new.body:=replace(new.body,'，','、');
 new.choices:=replace(new.choices::text,'，','、')::jsonb;
 new.explanation:=replace(new.explanation,'，','、');
 return new;
end $$;
revoke all on function study.normalize_question_punctuation() from public,anon,authenticated;
grant execute on function study.normalize_question_punctuation() to study_executor;
drop trigger if exists normalize_question_punctuation on study.questions;
create trigger normalize_question_punctuation before insert or update of title,body,choices,explanation
on study.questions for each row execute function study.normalize_question_punctuation();
update study.questions set title=replace(title,'，','、'),body=replace(body,'，','、'),
 choices=replace(choices::text,'，','、')::jsonb,explanation=replace(explanation,'，','、')
where title like '%，%' or body like '%，%' or choices::text like '%，%' or explanation like '%，%';
-- 回答時に保存した既存の解説にも適用。正誤・回答順・回答日時には触れない。
update study.answers set explanation=replace(explanation,'，','、') where explanation like '%，%';
