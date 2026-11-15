begin;
create table public.fdu_study (
 user_id uuid primary key references auth.users(id), version bigint not null default 0,
 data jsonb not null default '{"tasks":{},"blocks":{},"sessions":{},"records":{},"meta":{}}',
 updated_at timestamptz not null default now()
);
create table public.fdu_study_receipts (
 user_id uuid not null references auth.users(id), operation_id uuid not null,
 operation jsonb not null, result jsonb not null, primary key(user_id,operation_id)
);
alter table public.fdu_study enable row level security;
alter table public.fdu_study_receipts enable row level security;
revoke all on public.fdu_study,public.fdu_study_receipts from public,anon,authenticated;
grant select on public.fdu_study to authenticated;
create policy own_study on public.fdu_study for select to authenticated using(user_id=auth.uid());

create function public.fdu_study_validate(d jsonb) returns void
language plpgsql set search_path='' as $$
declare c text; k text; v jsonb; i jsonb; n integer:=0; a timestamptz; b timestamptz;
begin
 if octet_length(d::text)>15000000 then raise exception '学习数据超过容量限制'; end if;
 foreach c in array array['tasks','blocks','sessions','records','meta'] loop
  if jsonb_typeof(d->c) is distinct from 'object' then raise exception '学习数据格式错误'; end if;
  for k,v in select * from jsonb_each(d->c) loop
   if v->>'id' is distinct from k then raise exception '学习数据标识不匹配'; end if;
   if c='meta' then
    if k<>'plan-import' or jsonb_typeof(v->'imported') is distinct from 'boolean' then raise exception '导入标记错误'; end if;
    continue;
   end if;
   perform k::uuid;
   if c='tasks' then
    if length(btrim(v->>'name')) not between 1 and 200 or v->>'name' is null
     or jsonb_typeof(v->'category') is distinct from 'string' or length(v->>'category')>100
     or (v->>'mode') not in ('complete','timer') or v->>'mode' is null
     or coalesce((v->>'focus_minutes')::integer,0) not between 1 and 360 then raise exception '任务配置错误'; end if;
   elsif c='blocks' then
    if not (d->'tasks' ? (v->>'task_id')) then raise exception '关联任务已删除'; end if;
    if coalesce((v->>'day')::integer,-1) not between 0 and 6
     or coalesce((v->>'start')::integer,0) not between 450 and 1290 or (v->>'start')::integer%30<>0
     or coalesce((v->>'end')::integer,0) not between 480 and 1320 or (v->>'end')::integer%30<>0
     or (v->>'end')::integer<=(v->>'start')::integer then raise exception '预设时间范围错误'; end if;
    if exists(select 1 from jsonb_each(d->'blocks') o where o.key<>k
      and o.value->>'day'=v->>'day' and (o.value->>'start')::integer<(v->>'end')::integer
      and (o.value->>'end')::integer>(v->>'start')::integer) then raise exception '预设时间块不能重叠'; end if;
   else
    perform public.fdu_study_validate(jsonb_build_object('tasks',jsonb_build_object(v->'task'->>'id',v->'task'),'blocks','{}'::jsonb,'sessions','{}'::jsonb,'records','{}'::jsonb,'meta','{}'::jsonb));
    a:=(v->>'started_at')::timestamptz; b:=(v->>'ended_at')::timestamptz;
    if a is null then raise exception '缺少开始时间'; end if;
    if b<a then raise exception '结束时间早于开始时间'; end if;
    if c='sessions' then
     if coalesce(v->>'method','') not in ('stopwatch','pomodoro')
       or coalesce(v->>'status','') not in ('focus','paused','awaiting','rest','summary','saved')
       or coalesce((v->>'focus_minutes')::integer,0) not between 1 and 360
       or coalesce((v->>'rest_minutes')::integer,0) not between 1 and 120
       or coalesce((v->>'round')::integer,0)<1 or jsonb_typeof(v->'intervals') is distinct from 'array' then raise exception '会话格式错误'; end if;
     if v->>'status'<>'saved' then n:=n+1; end if;
     if v->>'status' in ('summary','saved') and b is null then raise exception '会话缺少结束时间'; end if;
     for i in select * from jsonb_array_elements(v->'intervals') loop
      if (i->>'start')::timestamptz is null or (i->>'end')::timestamptz<(i->>'start')::timestamptz
       or coalesce((i->>'round')::integer,0)<1 then raise exception '计时间隔错误'; end if;
     end loop;
    else
     perform (v->>'date')::date;
     if b is null or v->>'date' is null or coalesce(v->>'method','') not in ('complete','stopwatch','pomodoro')
      or coalesce((v->>'seconds')::integer,-1) not between 0 and 604800
      or coalesce((v->>'rounds')::integer,-1)<0 or jsonb_typeof(v->'early') is distinct from 'boolean'
      or (v->>'method'='complete' and ((v->>'seconds')::integer<>0 or (v->>'rounds')::integer<>0))
      or (v->>'seconds')::integer>ceil(extract(epoch from b-a)) then raise exception '学习记录时间错误'; end if;
    end if;
   end if;
  end loop;
 end loop;
 if n>1 then raise exception '另一设备已有学习会话，请先结束并确认总结'; end if;
end $$;

create function public.fdu_study_sync(p_operation jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s public.fdu_study%rowtype; r public.fdu_study_receipts%rowtype;
 d jsonb; c jsonb; collection text; entity text; result jsonb; reason text; op uuid;
begin
 if u is null then raise exception '需要登录' using errcode='42501'; end if;
 insert into public.fdu_study(user_id) values(u) on conflict do nothing;
 select * into s from public.fdu_study where user_id=u for update;
 if p_operation is null then return jsonb_build_object('status','ok','version',s.version,'data',s.data); end if;
 if jsonb_typeof(p_operation) is distinct from 'object' or jsonb_typeof(p_operation->'changes') is distinct from 'array'
   or jsonb_array_length(p_operation->'changes') not between 1 and 1000 or octet_length(p_operation::text)>5000000 then raise exception '操作格式错误' using errcode='22023'; end if;
 op:=(p_operation->>'id')::uuid;
 if op is null or (p_operation->>'at')::timestamptz is null then raise exception '操作标识错误' using errcode='22023'; end if;
 select * into r from public.fdu_study_receipts where user_id=u and operation_id=op;
 if found then
  if r.operation<>p_operation then raise exception '重复操作标识的内容不同' using errcode='22023'; end if;
  return r.result || jsonb_build_object('data',s.data,'version',s.version);
 end if;
 d:=s.data;
 begin
  for c in select * from jsonb_array_elements(p_operation->'changes') loop
   if c->>'collection'='sessions' and c->'after'<>'null'::jsonb and exists (
    select 1 from jsonb_each(d->'sessions') s2,
     lateral jsonb_array_elements(c->'after'->'intervals') i1,
     lateral jsonb_array_elements(s2.value->'intervals') i2
    where s2.key<>c->>'id'
     and (i1->>'start')::timestamptz<coalesce((i2->>'end')::timestamptz,'infinity'::timestamptz)
     and (i2->>'start')::timestamptz<coalesce((i1->>'end')::timestamptz,'infinity'::timestamptz)
   ) then raise exception '跨设备学习时间重叠，请核对原始记录后处理'; end if;
   collection:=c->>'collection'; entity:=c->>'id';
   if collection is null or collection not in ('tasks','blocks','sessions','records','meta') or entity is null or length(entity)>80 or not(c ? 'before' and c ? 'after') then raise exception '操作字段错误'; end if;
   if coalesce(d->collection->entity,'null'::jsonb)<>c->'before' then raise exception '另一设备已修改此数据，原始操作已保留'; end if;
   if c->'after'='null'::jsonb then d:=d #- array[collection,entity];
   else d:=jsonb_set(d,array[collection,entity],c->'after'); end if;
  end loop;
  perform public.fdu_study_validate(d);
  for c in select * from jsonb_array_elements(p_operation->'changes') loop
   if c->>'collection'='records' and c->'before'='null'::jsonb and c->'after'->>'method'='complete'
     and exists(select 1 from jsonb_each(d->'sessions') s2 where s2.value->>'status'<>'saved'
       and (s2.value->>'started_at')::timestamptz<=(c->'after'->>'started_at')::timestamptz) then
     raise exception '另一设备已有学习会话，请先结束并确认总结';
   end if;
  end loop;
 exception when others then reason:=sqlerrm;
 end;
 if reason is null then
  update public.fdu_study set data=d,version=version+1,updated_at=clock_timestamp() where user_id=u returning * into s;
  result:=jsonb_build_object('status','ok','version',s.version,'data',s.data);
 else result:=jsonb_build_object('status','conflict','version',s.version,'data',s.data,'reason',reason);
 end if;
 insert into public.fdu_study_receipts values(u,op,p_operation,result-'data');
 return result;
end $$;
revoke all on function public.fdu_study_validate(jsonb),public.fdu_study_sync(jsonb) from public,anon,authenticated;
grant execute on function public.fdu_study_sync(jsonb) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.fdu_study;
 end if;
end $$;
commit;
