import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const user1 = "11111111-1111-4111-8111-111111111111",
  user2 = "22222222-2222-4222-8222-222222222222";
test("RLS、重複回答、最新順序、リセット、削除後のJWTを検証", async () => {
  const db = new PGlite();
  await db.exec(
    `create schema auth;create role anon;create role authenticated;revoke all on schema auth from public;grant usage on schema auth to authenticated;create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');alter table auth.users enable row level security;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users(id)values('${user1}'),('${user2}');`,
  );
  await db.exec(await readFile("database/schema.sql", "utf8"));
  await db.exec(await readFile("database/seed.sql", "utf8"));
  const additions = [...JSON.parse(await readFile("database/questions-2024.json", "utf8")), ...JSON.parse(await readFile("database/questions-ipa-sample.json", "utf8"))];
  assert.equal(additions.length, 21);
  assert.equal((await db.query("select count(*)::int as n from study.questions")).rows[0].n, 39);
  for (const question of additions) {
    const saved = (await db.query("select * from study.questions where id=$1", [question.id])).rows[0];
    assert.equal(saved.correct, question.correct);
    assert.deepEqual(saved.choices, question.choices);
    assert.equal(saved.body, question.body);
    assert.equal(saved.category_id, question.category_id);
    assert.equal(saved.published, true);
    assert.equal(question.reference.question_pdf.startsWith("https://www.ipa.go.jp/"), true);
    assert.equal(saved.body.includes("，") || saved.explanation.includes("，") || JSON.stringify(saved.choices).includes("，"), false);
  }
  // DB経由の今後の編集でも統一され、数値の桁区切りは変わらない。
  await db.exec("begin; update study.questions set body='例，金額1,000円。', explanation='説明，確認。', choices=jsonb_set(choices,'{0,body}',to_jsonb('選択肢，確認。'::text)) where id='DMQ-0017';");
  const normalized = (await db.query("select body,explanation,choices from study.questions where id='DMQ-0017'")).rows[0];
  assert.equal(normalized.body, "例、金額1,000円。");
  assert.equal(normalized.explanation, "説明、確認。");
  assert.equal(normalized.choices[0].body, "選択肢、確認。");
  await db.exec("rollback;");

  assert.equal((await db.query("select has_schema_privilege('study_executor','auth','usage') as allowed")).rows[0].allowed,false);
  assert.equal((await db.query("select rolbypassrls from pg_roles where rolname='study_executor'")).rows[0].rolbypassrls,false);
  const select = async (q, args = []) => (await db.query(q, args)).rows;
  const as = async (id) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  await db.exec(
    `update study.questions set published=(id = 'DMQ-0014');`,
  );
  await db.exec("set role anon");
  assert.equal(
    (await select("select public.dm_catalog() as data"))[0].data.questions
      .length,
    1,
  );
  await db.exec("reset role");
  await as(user1);
  await assert.rejects(() => select("select public.dm_rate_question('DMQ-0037',4)"), /AI作成の公開問題/);
  const start = async () =>
    (
      await select(
        "select public.dm_start_exercise(question_count=>1,replace_existing=>true) as data",
      )
    )[0].data;
  const old = await start(),
    fresh = await start();
  const oldItem = old.items[0],
    freshItem = fresh.items[0];
  const correct = (
    await select("select public.dm_reveal_question($1) as q", [
      freshItem.question.id,
    ])
  )[0].q.correct;
  const a = (
    await select("select public.dm_submit_answer($1,$2) as a", [
      freshItem.id,
      correct,
    ])
  )[0].a;
  assert.equal(a.correct, true);
  const category = (await select("select public.dm_reveal_question($1) as q", [freshItem.question.id]))[0].q.category_id;
  assert.equal((await select("select public.dm_history_by_category($1::text[]) as h", [[category]]))[0].h.answers.length, 1);
  assert.equal((await select("select public.dm_history_by_category($1::text[]) as h", [["nonexistent"]]))[0].h.answers.length, 0);
  assert.equal((await select("select public.dm_history_by_category($1::text[],1) as h", [[category]]))[0].h.answers.length, 0);

  const retry = (
    await select("select public.dm_submit_answer($1,$2) as a", [
      freshItem.id,
      (correct % 4) + 1,
    ])
  )[0].a;
  assert.equal(retry.selected, correct);
  await as(user2);
  assert.equal((await select("select public.dm_history_by_category($1::text[]) as h", [[category]]))[0].h.answers.length, 0);

  await assert.rejects(
    () => select("select public.dm_submit_answer($1,1)", [freshItem.id]),
    /見つかりません/,
  );
  assert.equal(
    (await select("select public.dm_history() as h"))[0].h.answers.length,
    0,
  );
  await assert.rejects(
    () => select("select * from study.answers"),
    /permission denied/,
  );
  await assert.rejects(
    () => select("select public.dm_admin_questions()"),
    /管理者/,
  );
  await as(user1);
  await select("select public.dm_submit_answer($1,$2)", [
    oldItem.id,
    (correct % 4) + 1,
  ]);
  await db.exec("reset role");
  assert.equal(
    (await select("select count(*)::int as n from study.answers"))[0].n,
    2,
  );
  const latest = await select(
    "select sequence from study.latest where user_id=$1 and question_id=$2",
    [user1, freshItem.question.id],
  );
  assert.equal(Number(latest[0].sequence), freshItem.sequence);
  await as(user1);
  await select("select public.dm_rate_question($1,4)", [freshItem.question.id]);
  await select("select public.dm_rate_question($1,5)", [freshItem.question.id]);
  assert.equal((await select("select public.dm_reveal_question($1) as q", [freshItem.question.id]))[0].q.my_rating, 5);
  await as(user2);
  assert.equal((await select("select public.dm_reveal_question($1) as q", [freshItem.question.id]))[0].q.my_rating, null);
  await as(user1);

  await select("select public.dm_reset_history()");
  assert.equal(
    (await select("select public.dm_history() as h"))[0].h.answers.length,
    0,
  );
  await start();
  await select("select public.dm_prepare_account_deletion()");
  await assert.rejects(() => start(), /ログイン/);
  assert.equal(
    (await select("select public.dm_active_exercise() as e"))[0].e,
    null,
  );
  await db.exec("reset role");
  await db.exec(`insert into study.questions(id,title,body,category_id,origin,source,choices,correct,explanation,published)
    select 'all-test-'||n,q.title,q.body,q.category_id,q.origin,q.source,q.choices,q.correct,q.explanation,true
    from study.questions q cross join generate_series(1,101) n where q.id='DMQ-0014'`);
  await as(user2);
  const all = (await select("select public.dm_start_exercise(question_count=>0,replace_existing=>true) as data"))[0].data;
  assert.equal(all.items.length, 102);
  assert.equal(all.requested, 102);
  assert.equal(new Set(all.items.map(i => i.question.id)).size, 102);
  const limited = (await select("select public.dm_start_exercise(question_count=>10,replace_existing=>true) as data"))[0].data;
  assert.equal(limited.items.length, 10);
  await assert.rejects(() => select("select public.dm_start_exercise(question_count=>0,wrong_only=>true,replace_existing=>true)"), /条件に合う問題/);
  const answeredIds = new Set(all.items.slice(0,100).map(i => i.question.id));
  await select("select public.dm_submit_answer((v->>'id')::uuid,2) from jsonb_array_elements($1::jsonb) v", [JSON.stringify(all.items.slice(0,100))]);
  const preferred = (await select("select public.dm_start_exercise(question_count=>10,replace_existing=>true) as data"))[0].data;
  assert.equal(preferred.items.length, 10);
  assert.equal(preferred.items.slice(0,2).every(i => !answeredIds.has(i.question.id)),true);
  assert.equal(preferred.items.slice(2).every(i => answeredIds.has(i.question.id)),true);
  const preferredAll = (await select("select public.dm_start_exercise(question_count=>0,replace_existing=>true) as data"))[0].data;
  assert.equal(preferredAll.items.length, 102);
  assert.equal(preferredAll.items.slice(0,2).every(i => !answeredIds.has(i.question.id)),true);
  await select("select public.dm_submit_answer((v->>'id')::uuid,2) from jsonb_array_elements($1::jsonb) v", [JSON.stringify(preferredAll.items.slice(0,2))]);
  const fallback = (await select("select public.dm_start_exercise(question_count=>10,replace_existing=>true) as data"))[0].data;
  assert.equal(fallback.items.length,10);
  await select("select public.dm_submit_answer($1,3)", [fallback.items[0].id]);
  const wrongOnly = (await select("select public.dm_start_exercise(question_count=>10,wrong_only=>true,replace_existing=>true) as data"))[0].data;
  assert.equal(wrongOnly.items.length,1);
  assert.equal(wrongOnly.items[0].question.id,fallback.items[0].question.id);
  await db.close();
});
