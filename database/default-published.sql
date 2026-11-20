alter table study.questions alter column published set default true;
update study.questions set published=true where not published;
