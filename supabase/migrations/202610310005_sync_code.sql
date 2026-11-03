begin;
create table public.fdu_sync_code_attempts(owner_id uuid primary key,window_start timestamptz not null,attempts integer not null);
alter table public.fdu_sync_code_attempts enable row level security;
revoke all on public.fdu_sync_code_attempts from public,anon,authenticated;
create function public.fdu_sync_code_attempt(p_user uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare current public.fdu_sync_code_attempts%rowtype; begin
 insert into public.fdu_sync_code_attempts values(p_user,clock_timestamp(),0) on conflict do nothing;
 select * into current from public.fdu_sync_code_attempts where owner_id=p_user for update;
 if current.window_start>clock_timestamp()-interval '1 minute' and current.attempts>=10 then return false;end if;
 update public.fdu_sync_code_attempts set attempts=case when current.window_start<=clock_timestamp()-interval '1 minute' then 1 else current.attempts+1 end,window_start=case when current.window_start<=clock_timestamp()-interval '1 minute' then clock_timestamp() else current.window_start end where owner_id=p_user;
 return true;
end $$;
revoke all on function public.fdu_sync_code_attempt(uuid) from public,anon,authenticated;
grant execute on function public.fdu_sync_code_attempt(uuid) to service_role;
commit;
