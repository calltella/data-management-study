-- 科目Aの基本用語を一通り学んだ初回受験者向け。評価時の問題内容と照合する。
do $pilot$
declare
  sample record;
  target study.questions%rowtype;
begin
  for sample in select * from (values
    ('DMQ-0135', '5c2a87360854f2f4b6817ba0f500c1c1', 1, 'needs_review', '照会に必要な操作と許可されたAPIを照合すれば解ける。誤答はいずれも更新権限を残すうえ、三つとも同じ語句で始まり正答だけが短い。選択肢の外形だけで絞れるため要レビュー。'),
    ('DMQ-0136', '50c0212d40ac733a536c554514ad9622', 1, 'ready', '測定していない値を実測として報告した点から、ねつ造を選ぶ。推定と明示した補完や既存値の書換えと区別する一つの基準で解ける。'),
    ('DMQ-0145', 'e2dbeb8e2cf0d71e7808c2a29b503e59', 2, 'ready', '稼働前の0件と稼働後の複数件から一方向の多重度を定め、記録側が設備1件を指す逆方向も確認する。誤答は下限・上限・逆方向のいずれかを取り違える。'),
    ('DMQ-0164', 'ead772c35ec007f30210b9061b66ebd6', 2, 'ready', '分母を全明細200件に固定し、登録済みの180件に変換済み12件だけを加える。空欄8件の扱いと変換の前後を区別して90％と96％を求める。'),
    ('DMQ-0173', 'c41537dd71a7101ab30215c9b65d786b', 1, 'ready', '業務再開を直接確かめたかという一つの基準で、復元後に発注を試す案を選べる。バックアップ取得確認、損失補償、リスク受容は再開の実証にならない。'),
    ('DMQ-0178', '44023a75538207e7c1f7463ca6dbea14', 2, 'ready', 'パン購入者中のスープ購入率40/200と全体の100/1000を求め、その比2を選ぶ。両方を買った割合や途中の条件付き確率が誤答になる。'),
    ('DMQ-0181', '629e786ca723ebe1c5c66877ac701964', 3, 'ready', '組立と包装の両制約で候補を選別してから利益を比較する。A7個・B3個は組立17時間で除外し、実行可能な候補の利益24、26、24千円から選ぶ。'),
    ('DMQ-0192', '0c430dc07c0710dbc8257b25afa0bb02', 1, 'ready', '多い順に並んだ件数を累計し、65件から83件へ初めて75件を超える3分類を選ぶ。判断基準はしきい値に初めて達する位置だけである。'),
    ('DMQ-0203', '61800094eac50aa9752f27443fe129cd', 2, 'needs_review', '工場内での伝票番号と伝票内での行番号の有効範囲を組み合わせる。各二項目案に重複例を考えられるが、正解だけが三項目であり選択肢構成は要レビュー。'),
    ('DMQ-0218', '771c1a36a637741c39d7a6f61591f68d', 2, 'ready', '日次出荷表から補充表へ数量の依存をたどり、同じ明細を使う配送件数表は伝票数のみを参照すると判断する。直接・間接の参照と計算対象を照合する。')
  ) as v(id, content_hash, level, status, reason)
  loop
    select * into strict target from study.questions
      where id = sample.id and origin = 'ai_original' and published for update;
    if target.content_revision <> 1 or md5(jsonb_build_array(target.title, target.body,
      target.choices, target.correct, target.explanation, target.asset_key)::text) <> sample.content_hash then
      raise exception '評価時と問題の内容が異なります。%', sample.id;
    end if;
    insert into study.question_difficulty_assessments
      (question_id, content_revision, difficulty, status, reason, model, rubric_version, assessed_at)
    values (sample.id, target.content_revision, sample.level, sample.status, sample.reason,
      'gpt-6.2-astra', 'dm-a-2026-11-22-v1', '2026-11-22T07:33:12Z')
    on conflict (question_id, content_revision) do nothing;
  end loop;
end;
$pilot$;
