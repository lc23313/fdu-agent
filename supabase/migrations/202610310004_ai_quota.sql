begin;
create table public.fdu_ai_usage(user_id uuid primary key references auth.users(id),day date not null,used integer not null,last_at timestamptz not null);
alter table public.fdu_ai_usage enable row level security;
revoke all on public.fdu_ai_usage from public,anon,authenticated;
create function public.fdu_ai_claim(p_user uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare current public.fdu_ai_usage%rowtype; today date:=(clock_timestamp() at time zone 'Asia/Shanghai')::date; begin
 insert into public.fdu_ai_usage values(p_user,today,0,'-infinity') on conflict do nothing;
 select * into current from public.fdu_ai_usage where user_id=p_user for update;
 if current.last_at>clock_timestamp()-interval '10 seconds' or(current.day=today and current.used>=30) then return false;end if;
 update public.fdu_ai_usage set day=today,used=case when current.day=today then current.used+1 else 1 end,last_at=clock_timestamp() where user_id=p_user;
 return true;
end $$;
revoke all on function public.fdu_ai_claim(uuid) from public,anon,authenticated;
grant execute on function public.fdu_ai_claim(uuid) to service_role;
commit;
