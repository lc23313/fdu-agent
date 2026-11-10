begin;
do $$ begin
 if to_regclass('storage.objects') is not null and not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='fdu_file_delete') then
  execute 'create policy fdu_file_delete on storage.objects for delete to authenticated using(bucket_id=''fdu-files'' and (storage.foldername(name))[1]=(select auth.uid())::text)';
 end if;
end $$;
commit;
