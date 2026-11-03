-- Apply separately after review; creates only the private file bucket and its policies.
insert into storage.buckets(id,name,public,file_size_limit) values('fdu-files','fdu-files',false,20971520) on conflict(id) do nothing;
create policy fdu_file_read on storage.objects for select to authenticated using(bucket_id='fdu-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy fdu_file_upload on storage.objects for insert to authenticated with check(bucket_id='fdu-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
