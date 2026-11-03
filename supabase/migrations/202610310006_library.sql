begin;
create table public.fdu_files(user_id uuid not null references auth.users(id),hash text not null check(hash~'^[a-f0-9]{64}$'),version bigint not null,data jsonb not null,primary key(user_id,hash));
alter table public.fdu_files enable row level security;
revoke all on public.fdu_files from public,anon,authenticated;
grant select on public.fdu_files to authenticated;
create policy own_files on public.fdu_files for select to authenticated using(user_id=(select auth.uid()));
create function public.fdu_save_file(p_data jsonb,p_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); old public.fdu_files%rowtype; key text:=p_data->>'hash'; begin
 if uid is null then raise exception 'Authentication required';end if;
 if key !~ '^[a-f0-9]{64}$' or octet_length(p_data::text)>300000 or jsonb_typeof(p_data->'course_ids') is distinct from 'array' or length(p_data->>'name') not between 1 and 200 or (p_data->>'size')::bigint not between 0 and 20971520 or p_data->>'type' not in('pdf','docx','pptx','md','txt','doc','ppt') or length(p_data->>'text')>60000 or p_data-array['hash','name','size','type','course_ids','text','uploaded','created_at','version']<>'{}'::jsonb then raise exception 'Invalid file metadata';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||key,0));
 select * into old from public.fdu_files where user_id=uid and hash=key;
 if found and old.version<>p_version and old.data-(array['version'])<>p_data-(array['version']) then return jsonb_build_object('conflict',true,'data',old.data);end if;
 if old.data-array['version'] is not distinct from p_data-array['version'] then return jsonb_build_object('conflict',false,'data',old.data);end if;
 p_data:=jsonb_set(p_data,'{version}',to_jsonb(coalesce(old.version,0)+1));
 insert into public.fdu_files values(uid,key,coalesce(old.version,0)+1,p_data) on conflict(user_id,hash) do update set version=excluded.version,data=excluded.data;
 return jsonb_build_object('conflict',false,'data',p_data);
end $$;
revoke all on function public.fdu_save_file(jsonb,bigint) from public,anon;
grant execute on function public.fdu_save_file(jsonb,bigint) to authenticated;
create table public.fdu_materials(user_id uuid not null references auth.users(id),external_id text not null,course_external_id text not null,data jsonb not null,primary key(user_id,external_id,course_external_id));
alter table public.fdu_materials enable row level security;
revoke all on public.fdu_materials from public,anon,authenticated;
grant select on public.fdu_materials to authenticated;
create policy own_materials on public.fdu_materials for select to authenticated using(user_id=(select auth.uid()));
create function public.fdu_import_materials(p_user uuid,p_rows jsonb) returns void language plpgsql security definer set search_path='' as $$ declare item jsonb; begin
 if jsonb_typeof(p_rows)<>'array' or octet_length(p_rows::text)>3000000 then raise exception 'Invalid materials';end if;
 for item in select * from jsonb_array_elements(p_rows) loop
 insert into public.fdu_materials values(p_user,item->>'external_id',item->>'course_external_id',item) on conflict(user_id,external_id,course_external_id) do update set data=excluded.data;
 end loop;
end $$;
revoke all on function public.fdu_import_materials(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fdu_import_materials(uuid,jsonb) to service_role;
commit;
