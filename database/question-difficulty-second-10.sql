-- 未評価の公開AI問題10問に対する第2回評価。同一評価の再適用はスキップする。
do $assessment$
declare
  sample record;
  target study.questions%rowtype;
begin
  for sample in select * from (values
    ('DMQ-0141', 1, 'a6c326fbea13e36d3b5f5d4b201fe635', 3, 2, 'ready', '規程が現行版であること、所属別の閲覧権限、根拠の提示、入力できる量を照合する。全文投入では容量条件を満たせず、回答後に出典を確認する案では生成時に権限外の規程を参照し得る。'),
    ('DMQ-0146', 1, '6b9ee51081194a6616a8d2ac31861248', 3, 1, 'ready', '判断基準は点検時点の所属を後から特定できるかどうかである。点検の記録に所属を残せば、設備が何度移設されても当時の拠点を特定できる。'),
    ('DMQ-0151', 1, '3412943122098e786c33782b0af27343', 4, 1, 'ready', '保守と価格検討は別の利用目的であると読み取れば、契約に明記された事前承諾を選べる。識別番号の削除や社内の権限管理では提供元の承諾は得られない。'),
    ('DMQ-0154', 1, '51e26fd8266b5ac926e85688a723b053', 2, 2, 'ready', '明細と入金がそれぞれ複数行あり得るため、注文単位に集計してから結合する必要がある。同額の別取引も数えるという条件から、金額の重複を除く案も退ける。'),
    ('DMQ-0158', 1, '6ca919eb7a05c2a054223c4c7aba3f77', 1, 1, 'ready', '原本で数値と主張の対応を確かめるという基準を適用する。報告書の実在、別のAIの回答、同じ数値の発見だけでは、その数値が対象企業の導入率を示すか確認できない。'),
    ('DMQ-0165', 1, '845b22d1b1c4882bb77c1883325555d2', 1, 1, 'ready', '変更する列から帳票まで依存関係をたどれる資料を選ぶ。用語集、列の定義書、運用日誌のどれにも、加工を経て値がどこへ渡るかは示されていない。'),
    ('DMQ-0171', 1, 'e9b0a252fc3fceb234e5f70133e91878', 2, 1, 'ready', '設問に示された同じ式で年間損失を求めて比較する。各案は順に160万、200万、150万、120万円となり、発生回数だけで優先順位を付けると誤る。'),
    ('DMQ-0180', 1, '480bf90823382800ae12f5375fa8d516', 3, 1, 'ready', '箱の両端が第1・第3四分位数を、箱内の線が中央値を示すと知っていれば選べる。合計、平均、両端の値だけからは中央50％の広がりを読み取れない。'),
    ('DMQ-0190', 1, 'da8d2c4c8b7779b7ec45926b0c53d20b', 3, 1, 'needs_review', '昨夜分の取込実績を確かめるという一つの基準で解ける。正解だけが対象日・完了時刻・結果・件数を列挙して際立って長く、内容を比較する前に推測できるため要レビュー。'),
    ('DMQ-0219', 1, '17b03a47f493bc50aeb8219edf209e34', 1, 2, 'ready', '訂正対象の速報を直接受け取った購買部と、その速報を取り込んだ週報を配布した営業部を特定する。経理部の月報は独立した台帳を使うので連絡先から外す。')
  ) as v(id, revision, content_hash, answer, level, status, reason)
  loop
    select * into strict target from study.questions
      where id = sample.id and origin = 'ai_original' and published for update;
    if target.content_revision <> sample.revision or target.correct <> sample.answer
      or md5(jsonb_build_array(target.title, target.body, target.choices,
        target.correct, target.explanation, target.asset_key)::text) <> sample.content_hash then
      raise exception '評価時と問題の内容が異なります。%', sample.id;
    end if;
    if exists (
      select 1 from study.question_difficulty_assessments
      where question_id = target.id and content_revision = sample.revision
        and difficulty = sample.level and status = sample.status and reason = sample.reason
        and model = 'gpt-6.2-astra' and rubric_version = 'dm-a-2026-11-22-v1'
    ) then
      continue;
    end if;
    if exists (select 1 from study.question_difficulty_assessments where question_id = target.id) then
      raise exception '別の評価が既に登録されています。%', target.id;
    end if;
    insert into study.question_difficulty_assessments
      (question_id, content_revision, difficulty, status, reason, model, rubric_version, assessed_at)
    values (target.id, sample.revision, sample.level, sample.status, sample.reason,
      'gpt-6.2-astra', 'dm-a-2026-11-22-v1', '2026-11-22T07:49:06Z');
  end loop;
end;
$assessment$;
