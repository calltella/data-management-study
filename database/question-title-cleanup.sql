-- AI作成の区分はoriginに保持し、タイトルの接頭辞だけを除去する。
update study.questions set title=regexp_replace(title,'^AI原案[：:][[:space:]]*','')
where origin='ai_original' and title ~ '^AI原案[：:]';
