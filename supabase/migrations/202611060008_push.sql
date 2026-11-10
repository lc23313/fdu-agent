begin;
create table if not exists public.fdu_push_subscriptions(user_id uuid not null references auth.users(id), endpoint text not null, data jsonb not null, updated_at timestamptz not null default now(), primary key(user_id,endpoint));
create table if not exists public.fdu_push_deliveries(key text primary key, lease uuid not null, leased_at timestamptz not null default now(), delivered boolean not null default false);
alter table public.fdu_push_subscriptions enable row level security;
alter table public.fdu_push_deliveries enable row level security;
revoke all on public.fdu_push_subscriptions, public.fdu_push_deliveries from public,anon,authenticated;
grant all on public.fdu_push_subscriptions,public.fdu_push_deliveries to service_role;
create or replace function public.fdu_claim_push(p_key text) returns uuid language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid(); begin
 if length(p_key) not between 1 and 500 then raise exception 'Invalid key'; end if;
 insert into public.fdu_push_deliveries(key,lease) values(p_key,token) on conflict(key) do update set lease=token,leased_at=now() where not public.fdu_push_deliveries.delivered and public.fdu_push_deliveries.leased_at < now()-interval '2 minutes';
 if found then return token; end if; return null;
end $$;
create or replace function public.fdu_finish_push(p_key text,p_lease uuid,p_delivered boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 update public.fdu_push_deliveries set delivered=p_delivered,leased_at=case when p_delivered then now() else '-infinity'::timestamptz end where key=p_key and lease=p_lease;
end $$;
revoke all on function public.fdu_claim_push(text),public.fdu_finish_push(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.fdu_claim_push(text),public.fdu_finish_push(text,uuid,boolean) to service_role;
commit;
