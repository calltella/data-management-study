
create function public.dm_account_status() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('active',study.is_active(),'admin',study.is_admin())$$;
create function public.dm_admin_set_asset(question_id text,object_key text) returns void language plpgsql security definer set search_path='' as $$begin
 if not study.is_admin() then raise exception '管理者権限が必要です。';end if;
 update study.questions set asset_key=object_key where id=question_id;if not found then raise exception '問題が見つかりません。';end if;
end $$;
grant create on schema public to study_executor;
alter function public.dm_account_status() owner to study_executor;
alter function public.dm_admin_set_asset(text,text) owner to study_executor;
revoke all on function public.dm_account_status() from public,anon,authenticated;
revoke all on function public.dm_admin_set_asset(text,text) from public,anon,authenticated;
grant execute on function public.dm_account_status() to authenticated;
grant execute on function public.dm_admin_set_asset(text,text) to authenticated;
revoke create on schema public from study_executor;
