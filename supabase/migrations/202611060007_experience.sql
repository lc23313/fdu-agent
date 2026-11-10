begin;
alter table public.fdu_tasks add column if not exists time_kind text check (time_kind is null or time_kind in ('day','deadline','range'));
alter table public.fdu_tasks add column if not exists repeat jsonb check (repeat is null or jsonb_typeof(repeat)='object');
create or replace function public.fdu_push_task(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  op_id uuid;
  task_id uuid;
  base bigint;
  action text;
  patch jsonb;
  receipt public.fdu_task_operations%rowtype;
  old_task public.fdu_tasks%rowtype;
  next_task public.fdu_tasks%rowtype;
  result jsonb;
  seq bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_operation) <> 'object'
    or not (p_operation ?& array['operation_id','entity_id','base_version','action'])
    or exists (select 1 from jsonb_object_keys(p_operation) k where k <> all(array['operation_id','entity_id','base_version','action','patch']))
    or jsonb_typeof(p_operation->'base_version') <> 'number'
    or not (p_operation->>'base_version' ~ '^(0|[1-9][0-9]*)$')
    or octet_length(p_operation::text) > 100000 then
    raise exception 'Invalid operation' using errcode = '22023';
  end if;
  op_id := (p_operation->>'operation_id')::uuid;
  task_id := (p_operation->>'entity_id')::uuid;
  base := (p_operation->>'base_version')::bigint;
  action := p_operation->>'action';
  patch := p_operation->'patch';
  if op_id is null or task_id is null or base > 9007199254740991 or action not in ('create','patch','delete','restore') then
    raise exception 'Invalid operation identity' using errcode = '22023';
  end if;
  if action in ('create','patch') then
    if patch is null or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb
      or exists (select 1 from jsonb_object_keys(patch) k where k <> all(array['title','description','status','priority','start_at','due_at','parent_id','course_id','list_id','tags','notes','reminders','time_kind','repeat'])) then
      raise exception 'Invalid task patch' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(patch) f where
      (f.key in ('title','description','status','notes') and jsonb_typeof(f.value) <> 'string')
      or (f.key in ('start_at','due_at','parent_id','course_id','list_id') and jsonb_typeof(f.value) not in ('null','string'))
      or (f.key = 'priority' and jsonb_typeof(f.value) <> 'number')
      or (f.key in ('tags','reminders') and jsonb_typeof(f.value) <> 'array')) then
      raise exception 'Invalid field type' using errcode = '22023';
    end if;
    if patch ? 'time_kind' and patch->'time_kind' <> 'null'::jsonb and (jsonb_typeof(patch->'time_kind') <> 'string' or patch->>'time_kind' not in ('day','deadline','range')) then raise exception 'Invalid time kind'; end if;
    if patch ? 'repeat' and patch->'repeat' <> 'null'::jsonb and (jsonb_typeof(patch->'repeat') is distinct from 'object' or not ((patch->'repeat') ?& array['frequency','interval']) or jsonb_typeof(patch->'repeat'->'interval') is distinct from 'number' or (patch->'repeat'->>'interval') !~ '^[1-9][0-9]*$' or (patch->'repeat') - array['frequency','interval','until'] <> '{}'::jsonb or patch->'repeat'->>'frequency' not in ('daily','weekly','monthly') or (patch->'repeat'->>'interval')::integer not between 1 and 52) then raise exception 'Invalid repeat'; end if;
    if patch ? 'tags' and exists(select 1 from jsonb_array_elements(patch->'tags') t where jsonb_typeof(t) <> 'string') then
      raise exception 'Invalid tag type' using errcode = '22023';
    end if;
  elsif patch is not null then
    raise exception 'Delete and restore do not accept a patch' using errcode = '22023';
  end if;
  insert into public.fdu_sync_heads(user_id) values (uid) on conflict do nothing;
  perform 1 from public.fdu_sync_heads where user_id = uid for update;
  select * into receipt from public.fdu_task_operations where user_id = uid and operation_id = op_id;
  if found then
    if receipt.request <> p_operation then raise exception 'Operation ID reused with different payload' using errcode = '22023'; end if;
    return receipt.result;
  end if;
  select * into old_task from public.fdu_tasks where user_id = uid and id = task_id;
  if (action = 'create' and (old_task.id is not null or base <> 0))
    or (action <> 'create' and (old_task.id is null or old_task.version <> base)) then
    result := jsonb_build_object('status','conflict','task',case when old_task.id is null then null else to_jsonb(old_task) end);
  else
    if action = 'create' then
      insert into public.fdu_tasks(user_id,id,title) values(uid,task_id,patch->>'title') returning * into old_task;
    end if;
    if action = 'patch' and old_task.deleted_at is not null then
      raise exception 'Restore deleted task explicitly' using errcode = '22023';
    end if;
    if action = 'restore' and old_task.deleted_at is null then
      raise exception 'Task is not deleted' using errcode = '22023';
    end if;
    next_task := jsonb_populate_record(old_task, coalesce(patch,'{}'::jsonb));
    if next_task.parent_id is not null and (action = 'create' or patch ? 'parent_id') then
      if exists (
        with recursive ancestors as (
          select id,parent_id from public.fdu_tasks where user_id = uid and id = next_task.parent_id and deleted_at is null
          union
          select t.id,t.parent_id from public.fdu_tasks t join ancestors a on t.id = a.parent_id where t.user_id = uid
        ) select 1 from ancestors where id = task_id
      ) then raise exception 'Parent cycle' using errcode = '23514'; end if;
      if not exists (select 1 from public.fdu_tasks where user_id = uid and id = next_task.parent_id and deleted_at is null) then
        raise exception 'Parent not available' using errcode = '23503';
      end if;
    end if;
    if exists(select 1 from unnest(next_task.tags) tag where tag is null or length(btrim(tag)) not between 1 and 60) then
      raise exception 'Invalid tag' using errcode = '23514';
    end if;
    if jsonb_typeof(next_task.reminders) <> 'array' then raise exception 'Invalid reminders' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements(next_task.reminders) r where jsonb_typeof(r) <> 'object'
      or jsonb_typeof(r->'minutes_before') is distinct from 'number'
      or not (r->>'minutes_before' ~ '^(0|[1-9][0-9]*)$')
      or (r->>'minutes_before')::numeric > 525600
      or r - 'minutes_before' <> '{}'::jsonb) then
      raise exception 'Invalid reminder' using errcode = '23514';
    end if;
    update public.fdu_tasks set
      title=btrim(next_task.title), description=next_task.description, status=next_task.status,
      priority=next_task.priority, start_at=next_task.start_at, due_at=next_task.due_at,
      parent_id=next_task.parent_id, course_id=next_task.course_id, list_id=next_task.list_id,
      tags=next_task.tags, notes=next_task.notes, reminders=next_task.reminders, time_kind=next_task.time_kind, repeat=next_task.repeat,
      version=old_task.version + case when action='create' then 0 else 1 end,
      updated_at=clock_timestamp(),
      completed_at=case when next_task.status='completed' then coalesce(old_task.completed_at,clock_timestamp()) else null end,
      deleted_at=case when action='delete' then coalesce(old_task.deleted_at,clock_timestamp()) when action='restore' then null else old_task.deleted_at end
    where user_id=uid and id=task_id returning * into next_task;
    update public.fdu_sync_heads set last_sequence=last_sequence+1 where user_id=uid returning last_sequence into seq;
    insert into public.fdu_task_changes(user_id,sequence,task) values(uid,seq,to_jsonb(next_task));
    result := jsonb_build_object('status','ok','task',to_jsonb(next_task));
  end if;
  insert into public.fdu_task_operations(user_id,operation_id,request,result) values(uid,op_id,p_operation,result);
  return result;
end $$;

create or replace function public.fdu_catalog(p_data jsonb default null,p_version bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); current public.fdu_catalogs%rowtype; item jsonb; begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.fdu_sync_heads(user_id) values(uid) on conflict do nothing;
 perform 1 from public.fdu_sync_heads where user_id=uid for update;
 select * into current from public.fdu_catalogs where user_id=uid;
 if p_data is not null then
  if jsonb_typeof(p_data)<>'object' or p_data - array['courses','theme','plans'] <> '{}'::jsonb or jsonb_typeof(p_data->'courses') is distinct from 'array' or jsonb_typeof(p_data->'plans') is distinct from 'array' or p_data->>'theme' not in ('system','light','dark') or octet_length(p_data::text)>200000 then raise exception 'Invalid personal catalog' using errcode='22023'; end if;
  if current.user_id is not null and current.version<>p_version and current.data<>p_data then return jsonb_build_object('version',current.version,'data',current.data,'conflict',true);end if;
  if current.data is distinct from p_data then
   for item in select * from jsonb_array_elements(p_data->'courses') loop
    if item - array['id','name','archived']<>'{}'::jsonb or length(btrim(item->>'name')) not between 1 and 200 then raise exception 'Invalid course' using errcode='22023';end if;
    insert into public.fdu_courses(user_id,id,origin,external_id,name) values(uid,(item->>'id')::uuid,'personal',item->>'id',item->>'name') on conflict(user_id,id) do update set name=excluded.name;
   end loop;
   insert into public.fdu_catalogs(user_id,version,data) values(uid,coalesce(current.version,0)+1,p_data) on conflict(user_id) do update set version=excluded.version,data=excluded.data;
   update public.fdu_sync_heads set last_sequence=last_sequence where user_id=uid;
   select * into current from public.fdu_catalogs where user_id=uid;
  end if;
 end if;
 return jsonb_build_object('version',coalesce(current.version,0),'data',coalesce(current.data,'{"courses":[],"theme":"system","plans":[]}'::jsonb),'conflict',false);
end $$;
create or replace function public.fdu_save_file(p_data jsonb,p_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); old public.fdu_files%rowtype; key text:=p_data->>'hash'; begin
 if uid is null then raise exception 'Authentication required';end if;
 if key !~ '^[a-f0-9]{64}$' or octet_length(p_data::text)>300000 or jsonb_typeof(p_data->'course_ids') is distinct from 'array' or length(p_data->>'name') not between 1 and 200 or (p_data->>'size')::bigint not between 0 and 20971520 or p_data->>'type' not in('pdf','docx','pptx','md','txt','doc','ppt') or length(p_data->>'text')>60000 or p_data-array['hash','name','size','type','course_ids','text','uploaded','created_at','version','document_id','previous_hash','deleted_at']<>'{}'::jsonb then raise exception 'Invalid file metadata';end if;
 if p_data ? 'document_id' then perform (p_data->>'document_id')::uuid; end if;
 if p_data ? 'previous_hash' and p_data->'previous_hash' <> 'null'::jsonb and p_data->>'previous_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid previous version'; end if;
 if p_data ? 'deleted_at' and p_data->'deleted_at' <> 'null'::jsonb then perform (p_data->>'deleted_at')::timestamptz; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||key,0));
 select * into old from public.fdu_files where user_id=uid and hash=key;
 if found and old.version<>p_version and old.data-(array['version'])<>p_data-(array['version']) then return jsonb_build_object('conflict',true,'data',old.data);end if;
 if old.data-array['version'] is not distinct from p_data-array['version'] then return jsonb_build_object('conflict',false,'data',old.data);end if;
 p_data:=jsonb_set(p_data,'{version}',to_jsonb(coalesce(old.version,0)+1));
 insert into public.fdu_files values(uid,key,coalesce(old.version,0)+1,p_data) on conflict(user_id,hash) do update set version=excluded.version,data=excluded.data;
 return jsonb_build_object('conflict',false,'data',p_data);
end $$;

create or replace function public.fdu_capabilities() returns jsonb language sql stable security invoker set search_path='' as $$ select jsonb_build_object('experience',1); $$;
revoke all on function public.fdu_capabilities() from public,anon;
grant execute on function public.fdu_capabilities() to authenticated;
commit;
