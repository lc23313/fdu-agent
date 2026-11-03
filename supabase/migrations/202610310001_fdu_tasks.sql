begin;

create table public.fdu_lists (
  user_id uuid not null references auth.users(id),
  id uuid not null,
  name text not null check (length(name) between 1 and 200),
  primary key (user_id, id)
);
create table public.fdu_courses (
  user_id uuid not null references auth.users(id),
  id uuid not null,
  origin text not null,
  external_id text not null,
  name text not null,
  primary key (user_id, id),
  unique (user_id, origin, external_id)
);
create table public.fdu_assignments (
  user_id uuid not null,
  id uuid not null,
  course_id uuid not null,
  external_id text not null,
  original_title text not null,
  original_due_at timestamptz,
  submission_state text not null default 'unknown',
  submitted_at timestamptz,
  last_success_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, course_id) references public.fdu_courses(user_id, id),
  unique (user_id, course_id, external_id)
);
create table public.fdu_tasks (
  user_id uuid not null references auth.users(id),
  id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 20000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'completed')),
  priority integer not null default 0 check (priority between 0 and 3),
  start_at timestamptz check (start_at is null or isfinite(start_at)),
  due_at timestamptz check (due_at is null or isfinite(due_at)),
  parent_id uuid,
  course_id uuid,
  list_id uuid,
  tags text[] not null default '{}' check (cardinality(tags) <= 50),
  notes text not null default '' check (length(notes) <= 20000),
  reminders jsonb not null default '[]' check (jsonb_typeof(reminders) = 'array' and jsonb_array_length(reminders) <= 10),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  deleted_at timestamptz,
  primary key (user_id, id),
  foreign key (user_id, parent_id) references public.fdu_tasks(user_id, id),
  foreign key (user_id, course_id) references public.fdu_courses(user_id, id),
  foreign key (user_id, list_id) references public.fdu_lists(user_id, id),
  check (parent_id is distinct from id),
  check ((status = 'completed') = (completed_at is not null))
);
create index fdu_tasks_due on public.fdu_tasks(user_id, due_at) where deleted_at is null;
create table public.fdu_sync_heads (
  user_id uuid primary key references auth.users(id),
  last_sequence bigint not null default 0
);
create table public.fdu_task_changes (
  user_id uuid not null references auth.users(id),
  sequence bigint not null,
  task jsonb not null,
  primary key (user_id, sequence)
);
create table public.fdu_task_operations (
  user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  request jsonb not null,
  result jsonb not null,
  primary key (user_id, operation_id)
);

alter table public.fdu_lists enable row level security;
alter table public.fdu_courses enable row level security;
alter table public.fdu_assignments enable row level security;
alter table public.fdu_tasks enable row level security;
alter table public.fdu_sync_heads enable row level security;
alter table public.fdu_task_changes enable row level security;
alter table public.fdu_task_operations enable row level security;
revoke all on public.fdu_lists, public.fdu_courses, public.fdu_assignments, public.fdu_tasks,
  public.fdu_sync_heads, public.fdu_task_changes, public.fdu_task_operations from public, anon, authenticated;
grant select on public.fdu_lists, public.fdu_courses, public.fdu_assignments, public.fdu_tasks,
  public.fdu_sync_heads, public.fdu_task_changes, public.fdu_task_operations to authenticated;
create policy own_lists on public.fdu_lists for select to authenticated using (user_id = (select auth.uid()));
create policy own_courses on public.fdu_courses for select to authenticated using (user_id = (select auth.uid()));
create policy own_assignments on public.fdu_assignments for select to authenticated using (user_id = (select auth.uid()));
create policy own_tasks on public.fdu_tasks for select to authenticated using (user_id = (select auth.uid()));
create policy own_heads on public.fdu_sync_heads for select to authenticated using (user_id = (select auth.uid()));
create policy own_changes on public.fdu_task_changes for select to authenticated using (user_id = (select auth.uid()));
create policy own_operations on public.fdu_task_operations for select to authenticated using (user_id = (select auth.uid()));

create function public.fdu_push_task(p_operation jsonb) returns jsonb
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
      or exists (select 1 from jsonb_object_keys(patch) k where k <> all(array['title','description','status','priority','start_at','due_at','parent_id','course_id','list_id','tags','notes','reminders'])) then
      raise exception 'Invalid task patch' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(patch) f where
      (f.key in ('title','description','status','notes') and jsonb_typeof(f.value) <> 'string')
      or (f.key in ('start_at','due_at','parent_id','course_id','list_id') and jsonb_typeof(f.value) not in ('null','string'))
      or (f.key = 'priority' and jsonb_typeof(f.value) <> 'number')
      or (f.key in ('tags','reminders') and jsonb_typeof(f.value) <> 'array')) then
      raise exception 'Invalid field type' using errcode = '22023';
    end if;
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
      tags=next_task.tags, notes=next_task.notes, reminders=next_task.reminders,
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

create function public.fdu_pull_tasks(p_cursor text default '0', p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cursor_value bigint;
  head bigint;
  next_value bigint;
  items jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_cursor is null or not (p_cursor ~ '^(0|[1-9][0-9]*)$') or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid cursor or page size' using errcode = '22023';
  end if;
  cursor_value := p_cursor::bigint;
  select coalesce((select last_sequence from public.fdu_sync_heads where user_id=uid),0) into head;
  if cursor_value > head then raise exception 'Cursor exceeds server head' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sequence',sequence::text,'task',task) order by sequence),'[]'::jsonb), coalesce(max(sequence),cursor_value)
    into items,next_value from (
      select sequence,task from public.fdu_task_changes where user_id=uid and sequence > cursor_value and sequence <= head order by sequence limit p_limit
    ) page;
  return jsonb_build_object('changes',items,'next_cursor',next_value::text,'has_more',next_value < head);
end $$;

revoke all on function public.fdu_push_task(jsonb) from public, anon;
revoke all on function public.fdu_pull_tasks(text,integer) from public, anon;
grant execute on function public.fdu_push_task(jsonb) to authenticated;
grant execute on function public.fdu_pull_tasks(text,integer) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.fdu_sync_heads;
  end if;
end $$;
commit;
