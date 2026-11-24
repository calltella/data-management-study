create or replace function public.dm_admin_questions()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not study.is_admin() then
    raise exception '管理者権限が必要です。';
  end if;

  return (
    select coalesce(jsonb_agg(
      study.question_json(q, true)
      || jsonb_build_object(
        'rating_count', ratings.total,
        'rating_average', ratings.average
      )
      || case when q.origin = 'ai_original' then jsonb_build_object(
        'difficulty_assessment', jsonb_build_object(
          'level', a.difficulty,
          'status', coalesce(a.status, case when exists (
            select 1 from study.question_difficulty_assessments history
            where history.question_id = q.id
          ) then 'stale' else 'unassessed' end),
          'reason', a.reason,
          'model', a.model,
          'rubric_version', a.rubric_version,
          'assessed_at', a.assessed_at
        )
      ) else '{}'::jsonb end
    ), '[]'::jsonb)
    from study.questions q
    left join study.question_difficulty_assessments a
      on a.question_id = q.id and a.content_revision = q.content_revision
    cross join lateral (
      select count(*) as total, avg(r.stars) as average
      from study.ratings r
      where r.question_id = q.id
    ) ratings
  );
end;
$$;
