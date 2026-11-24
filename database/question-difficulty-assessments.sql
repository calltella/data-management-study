begin;

alter table study.questions
  add column content_revision integer not null default 1 check (content_revision >= 1);

create function study.advance_question_content_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.content_revision := old.content_revision;
  if row(new.title, new.body, new.category_id, new.origin, new.source,
         new.choices, new.correct, new.explanation, new.asset_key)
     is distinct from
     row(old.title, old.body, old.category_id, old.origin, old.source,
         old.choices, old.correct, old.explanation, old.asset_key) then
    new.content_revision := old.content_revision + 1;
  end if;
  return new;
end;
$$;

revoke execute on function study.advance_question_content_revision() from public, anon, authenticated;
-- 同じ BEFORE UPDATE の句読点の正規化が終わってから内容を比較する。
create trigger zz_advance_question_content_revision
  before update on study.questions
  for each row execute function study.advance_question_content_revision();

create table study.question_difficulty_assessments (
  question_id text not null references study.questions(id) on delete cascade,
  content_revision integer not null check (content_revision >= 1),
  difficulty smallint check (difficulty between 1 and 3),
  status text not null check (status in ('ready', 'needs_review')),
  reason text not null check (btrim(reason) <> ''),
  model text not null check (btrim(model) <> ''),
  rubric_version text not null check (btrim(rubric_version) <> ''),
  assessed_at timestamptz not null,
  primary key (question_id, content_revision),
  check (status <> 'ready' or difficulty is not null)
);

alter table study.question_difficulty_assessments enable row level security;
revoke all on table study.question_difficulty_assessments from public, anon, authenticated;
grant select, insert, update on table study.question_difficulty_assessments to study_executor;

create policy question_difficulty_assessments_admin
  on study.question_difficulty_assessments
  for all to study_executor
  using ((select study.is_admin()))
  with check ((select study.is_admin()));

create function public.dm_admin_question_difficulty(question_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not study.is_admin() then
    raise exception '管理者権限が必要です。';
  end if;

  select jsonb_build_object(
    'question', to_jsonb(q),
    'status', coalesce(current_assessment.status,
      case when history.assessments is null then 'unassessed' else 'stale' end),
    'assessments', coalesce(history.assessments, '[]'::jsonb)
  ) into result
  from study.questions q
  left join study.question_difficulty_assessments current_assessment
    on current_assessment.question_id = q.id
    and current_assessment.content_revision = q.content_revision
  left join lateral (
    select jsonb_agg(to_jsonb(a) order by a.content_revision desc) as assessments
    from study.question_difficulty_assessments a
    where a.question_id = q.id
  ) history on true
  where q.id = dm_admin_question_difficulty.question_id and q.origin = 'ai_original';

  if not found then
    raise exception '対象のAI作成問題が見つかりません。';
  end if;
  return result;
end;
$$;

create function public.dm_admin_save_question_difficulty(
  question_id text, content_revision integer, difficulty integer, status text,
  reason text, model text, rubric_version text, assessed_at timestamptz
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare current_revision integer;
begin
  if not study.is_admin() then
    raise exception '管理者権限が必要です。';
  end if;

  select q.content_revision into current_revision
  from study.questions q
  where q.id = dm_admin_save_question_difficulty.question_id and q.origin = 'ai_original'
  for update;

  if not found then
    raise exception '対象のAI作成問題が見つかりません。';
  end if;
  if current_revision is distinct from content_revision then
    raise exception '問題の版が変わりました。現行版を再評価してください。';
  end if;

  insert into study.question_difficulty_assessments as saved
    (question_id, content_revision, difficulty, status, reason, model, rubric_version, assessed_at)
  values
    (question_id, content_revision, difficulty, status, reason, model, rubric_version, assessed_at)
  on conflict on constraint question_difficulty_assessments_pkey do update set
    difficulty = excluded.difficulty,
    status = excluded.status,
    reason = excluded.reason,
    model = excluded.model,
    rubric_version = excluded.rubric_version,
    assessed_at = excluded.assessed_at
  where (saved.status <> 'ready' or excluded.status = 'ready')
    and excluded.assessed_at >= saved.assessed_at;

  if not found then
    raise exception '採用済みの評価または新しい評価が既に保存されています。';
  end if;
end;
$$;

grant create on schema public to study_executor;
alter function public.dm_admin_question_difficulty(text) owner to study_executor;
alter function public.dm_admin_save_question_difficulty(text, integer, integer, text, text, text, text, timestamptz) owner to study_executor;
revoke create on schema public from study_executor;

revoke all on function public.dm_admin_question_difficulty(text) from public, anon, authenticated;
revoke all on function public.dm_admin_save_question_difficulty(text, integer, integer, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.dm_admin_question_difficulty(text) to authenticated;
grant execute on function public.dm_admin_save_question_difficulty(text, integer, integer, text, text, text, text, timestamptz) to authenticated;

commit;
