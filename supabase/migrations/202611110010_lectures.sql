begin;
create table public.fdu_lectures (
 id uuid primary key, user_id uuid not null references auth.users(id),
 title text not null check(length(title) between 1 and 200), name text not null check(length(name) between 1 and 200),
 size bigint not null check(size between 0 and 50000000), mime text not null default 'application/octet-stream',
 status text not null default 'LOCAL' check(status in ('LOCAL','SUBMITTING','PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 task text, error text, created_at timestamptz not null default now(), started_at timestamptz,
 transcript text not null default '' check(length(transcript)<=2000000)
);
create index on public.fdu_lectures(user_id,created_at desc);
create table public.fdu_lecture_versions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 job_id uuid not null references public.fdu_lectures(id) on delete cascade,
 kind text not null check(kind in ('filetrans','edit','realtime')), source_key text not null,
 text text not null check(length(text)<=2000000), segments jsonb not null default '[]' check(jsonb_typeof(segments)='array' and octet_length(segments::text)<=4000000),
 created_at timestamptz not null default now(), unique(user_id,job_id,source_key)
);
create table public.fdu_lecture_tickets (
 id uuid primary key, user_id uuid not null references auth.users(id), job_id uuid not null references public.fdu_lectures(id) on delete cascade,
 expires timestamptz not null default now()+interval '25 seconds'
);
create table public.fdu_lecture_usage(user_id uuid primary key references auth.users(id),day date not null,files integer not null default 0,live integer not null default 0);
alter table public.fdu_lectures enable row level security;
alter table public.fdu_lecture_versions enable row level security;
alter table public.fdu_lecture_tickets enable row level security;
alter table public.fdu_lecture_usage enable row level security;
revoke all on public.fdu_lectures,public.fdu_lecture_versions,public.fdu_lecture_tickets,public.fdu_lecture_usage from public,anon,authenticated;
grant select on public.fdu_lectures,public.fdu_lecture_versions to authenticated;
grant all on public.fdu_lectures,public.fdu_lecture_versions,public.fdu_lecture_tickets,public.fdu_lecture_usage to service_role;
create policy own_lectures on public.fdu_lectures for select to authenticated using(user_id=auth.uid());
create policy own_lecture_versions on public.fdu_lecture_versions for select to authenticated using(user_id=auth.uid());
create function public.fdu_lecture_claim(p_user uuid,p_id uuid,p_live boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; u public.fdu_lecture_usage%rowtype; j public.fdu_lectures%rowtype;
begin
 insert into public.fdu_lecture_usage(user_id,day) values(p_user,today) on conflict do nothing;
 select * into u from public.fdu_lecture_usage where user_id=p_user for update;
 select * into j from public.fdu_lectures where id=p_id and user_id=p_user for update;
 if not found then return false; end if;
 if u.day<>today then u.files:=0;u.live:=0;end if;
 if p_live then
  delete from public.fdu_lecture_tickets where expires<clock_timestamp();
  if u.live>=180 then return false;end if;
  update public.fdu_lecture_usage set day=today,files=u.files,live=u.live+1 where user_id=p_user;
 else
  if j.status<>'LOCAL' or j.size=0 or u.files>=30 then return false;end if;
  update public.fdu_lecture_usage set day=today,files=u.files+1,live=u.live where user_id=p_user;
  update public.fdu_lectures set status='SUBMITTING',started_at=clock_timestamp(),error=null where id=p_id;
 end if;
 return true;
end $$;
create function public.fdu_lecture_consume_ticket(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.fdu_lecture_tickets%rowtype;
begin
 delete from public.fdu_lecture_tickets where id=p_ticket returning * into t;
 if not found or t.expires<clock_timestamp() then return null;end if;
 return jsonb_build_object('user_id',t.user_id,'job_id',t.job_id);
end $$;
revoke all on function public.fdu_lecture_claim(uuid,uuid,boolean),public.fdu_lecture_consume_ticket(uuid) from public,anon,authenticated;
grant execute on function public.fdu_lecture_claim(uuid,uuid,boolean),public.fdu_lecture_consume_ticket(uuid) to service_role;
commit;
