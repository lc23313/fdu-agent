begin;
alter table public.fdu_courses add column code text not null default '',
 add column workflow_state text not null default 'unknown',
 add column availability text not null default 'available',
 add column error text,
 add column last_success_at timestamptz;
alter table public.fdu_assignments add column original_description text not null default '',
 add column grading_state text not null default 'unknown',
 add column official_url text not null default '',
 add column available boolean not null default true,
 add column task_id uuid,
 add constraint assignment_task foreign key(user_id,task_id) references public.fdu_tasks(user_id,id),
 add constraint one_assignment_per_task unique(user_id,task_id);
create table public.fdu_elearning_state(
 user_id uuid primary key references auth.users(id), canvas_user_id text,
 last_attempt_at timestamptz, last_success_at timestamptz,
 next_attempt_at timestamptz not null default '-infinity', error text
);
alter table public.fdu_elearning_state enable row level security;
revoke all on public.fdu_elearning_state from public,anon,authenticated;
grant select on public.fdu_elearning_state to authenticated;
create policy own_elearning on public.fdu_elearning_state for select to authenticated using(user_id=(select auth.uid()));

create function public.fdu_begin_elearning(p_user uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare started timestamptz:=clock_timestamp(); begin
 insert into public.fdu_elearning_state(user_id) values(p_user) on conflict do nothing;
 update public.fdu_elearning_state set last_attempt_at=started,next_attempt_at=started+interval '2 minutes'
 where user_id=p_user and next_attempt_at<=started;
 if not found then return null; end if;
 return started;
end $$;

create function public.fdu_fail_elearning(p_user uuid,p_started timestamptz,p_error text,p_retry integer default 60) returns void
language plpgsql security definer set search_path='' as $$ begin
 update public.fdu_elearning_state set error=left(p_error,200),next_attempt_at=clock_timestamp()+make_interval(secs=>greatest(60,least(p_retry,3600)))
 where user_id=p_user and last_attempt_at=p_started;
end $$;

create function public.fdu_import_elearning(p_user uuid,p_identity text,p_started timestamptz,p_courses jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb; a jsonb; cid uuid; aid uuid; tid uuid; identity text; previous_sub text; imported integer:=0; begin
 if jsonb_typeof(p_courses) is distinct from 'array' or jsonb_array_length(p_courses)>200 or octet_length(p_courses::text)>6000000 or p_identity !~ '^[0-9]+$' then raise exception 'Invalid import';end if;
 insert into public.fdu_sync_heads(user_id) values(p_user) on conflict do nothing;
 perform 1 from public.fdu_sync_heads where user_id=p_user for update;
 select canvas_user_id into identity from public.fdu_elearning_state where user_id=p_user and last_attempt_at=p_started for update;
 if not found then raise exception 'Stale connector run';end if;
 if identity is not null and identity<>p_identity then raise exception 'Canvas identity differs from the bound account';end if;
 previous_sub:=current_setting('request.jwt.claim.sub',true);
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 update public.fdu_courses set availability='not_returned' where user_id=p_user and origin='canvas';
 for c in select * from jsonb_array_elements(p_courses) loop
  if c->>'external_id' !~ '^[0-9]+$' or length(c->>'name') not between 1 and 200 then raise exception 'Invalid course';end if;
  insert into public.fdu_courses(user_id,id,origin,external_id,name,code,workflow_state,availability,error,last_success_at)
   values(p_user,gen_random_uuid(),'canvas',c->>'external_id',c->>'name',c->>'code',c->>'workflow_state',case when c->>'error' is null then 'available' else 'stale' end,c->>'error',case when c->>'error' is null then p_started else null end)
   on conflict(user_id,origin,external_id) do update set name=excluded.name,code=excluded.code,workflow_state=excluded.workflow_state,availability=excluded.availability,error=excluded.error,last_success_at=coalesce(excluded.last_success_at,public.fdu_courses.last_success_at)
   returning id into cid;
  if jsonb_typeof(c->'assignments')='array' then
   update public.fdu_assignments set available=false where user_id=p_user and course_id=cid;
   for a in select * from jsonb_array_elements(c->'assignments') loop
    select id,task_id into aid,tid from public.fdu_assignments where user_id=p_user and course_id=cid and external_id=a->>'external_id';
    if not found then aid:=gen_random_uuid();tid:=gen_random_uuid();end if;
    if tid is null then tid:=gen_random_uuid();end if;
    if not exists(select 1 from public.fdu_tasks where user_id=p_user and id=tid) then
     perform public.fdu_push_task(jsonb_build_object('operation_id',gen_random_uuid(),'entity_id',tid,'base_version',0,'action','create','patch',jsonb_build_object('title',a->>'original_title','description',a->>'original_description','due_at',a->'original_due_at','course_id',cid)));
     imported:=imported+1;
    end if;
    insert into public.fdu_assignments(user_id,id,course_id,external_id,original_title,original_description,original_due_at,submission_state,submitted_at,grading_state,official_url,last_success_at,task_id,available)
     values(p_user,aid,cid,a->>'external_id',a->>'original_title',a->>'original_description',(a->>'original_due_at')::timestamptz,a->>'submission_state',(a->>'submitted_at')::timestamptz,a->>'grading_state',a->>'official_url',p_started,tid,true)
     on conflict(user_id,course_id,external_id) do update set original_title=excluded.original_title,original_description=excluded.original_description,original_due_at=excluded.original_due_at,submission_state=excluded.submission_state,submitted_at=excluded.submitted_at,grading_state=excluded.grading_state,official_url=excluded.official_url,last_success_at=excluded.last_success_at,available=true,task_id=excluded.task_id;
   end loop;
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
 update public.fdu_elearning_state set canvas_user_id=p_identity,last_success_at=p_started,next_attempt_at=clock_timestamp()+interval '60 seconds',error=null where user_id=p_user;
 update public.fdu_sync_heads set last_sequence=last_sequence where user_id=p_user;
 return jsonb_build_object('imported',imported);
end $$;

create function public.fdu_elearning_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'external_id',external_id,'name',name,'code',code,'workflow_state',workflow_state,'availability',availability,'error',error,'last_success_at',last_success_at) order by name) from public.fdu_courses where user_id=auth.uid() and origin='canvas'),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'course_id',course_id,'external_id',external_id,'task_id',task_id,'original_title',original_title,'original_description',original_description,'original_due_at',original_due_at,'submission_state',submission_state,'submitted_at',submitted_at,'grading_state',grading_state,'official_url',official_url,'available',available,'last_success_at',last_success_at)) from public.fdu_assignments where user_id=auth.uid() and task_id is not null),'[]'::jsonb),
  'last_success_at',(select last_success_at from public.fdu_elearning_state where user_id=auth.uid()),
  'error',(select error from public.fdu_elearning_state where user_id=auth.uid())
 );
$$;
revoke all on function public.fdu_begin_elearning(uuid),public.fdu_fail_elearning(uuid,timestamptz,text,integer),public.fdu_import_elearning(uuid,text,timestamptz,jsonb),public.fdu_elearning_snapshot() from public,anon,authenticated;
grant execute on function public.fdu_begin_elearning(uuid),public.fdu_fail_elearning(uuid,timestamptz,text,integer),public.fdu_import_elearning(uuid,text,timestamptz,jsonb) to service_role;
grant execute on function public.fdu_elearning_snapshot() to authenticated;
commit;
