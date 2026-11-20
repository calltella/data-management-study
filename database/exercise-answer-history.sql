create index if not exists answers_question_history on study.answers(user_id, question_id, sequence desc);

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
