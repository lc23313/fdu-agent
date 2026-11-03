begin;
create table public.fdu_catalogs(user_id uuid primary key references auth.users(id),version bigint not null default 1,data jsonb not null);
alter table public.fdu_catalogs enable row level security;
revoke all on public.fdu_catalogs from public,anon,authenticated;
grant select on public.fdu_catalogs to authenticated;
create policy own_catalog on public.fdu_catalogs for select to authenticated using(user_id=(select auth.uid()));
create function public.fdu_catalog(p_data jsonb default null,p_version bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
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
    if item - array['id','name']<>'{}'::jsonb or length(btrim(item->>'name')) not between 1 and 200 then raise exception 'Invalid course' using errcode='22023';end if;
    insert into public.fdu_courses(user_id,id,origin,external_id,name) values(uid,(item->>'id')::uuid,'personal',item->>'id',item->>'name') on conflict(user_id,id) do update set name=excluded.name;
   end loop;
   insert into public.fdu_catalogs(user_id,version,data) values(uid,coalesce(current.version,0)+1,p_data) on conflict(user_id) do update set version=excluded.version,data=excluded.data;
   update public.fdu_sync_heads set last_sequence=last_sequence where user_id=uid;
   select * into current from public.fdu_catalogs where user_id=uid;
  end if;
 end if;
 return jsonb_build_object('version',coalesce(current.version,0),'data',coalesce(current.data,'{"courses":[],"theme":"system","plans":[]}'::jsonb),'conflict',false);
end $$;
revoke all on function public.fdu_catalog(jsonb,bigint) from public,anon;
grant execute on function public.fdu_catalog(jsonb,bigint) to authenticated;
commit;
