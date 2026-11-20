-- 公式サンプルは本試験の過去問と区別する。既存データとRLSは維持。
alter table study.questions drop constraint questions_origin_check;
alter table study.questions add constraint questions_origin_check check(origin in('ipa_past','ai_original','ipa_sample'));
