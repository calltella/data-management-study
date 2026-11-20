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
