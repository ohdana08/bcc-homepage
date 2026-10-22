-- Business project only. Additive, no modifications to intake payloads or legacy dates.
begin;
create table public.lecture_operations (
  case_id uuid primary key references public.proposal_cases(id) on delete restrict,
  revision integer not null check(revision > 0),
  sessions jsonb not null default '[]' check(jsonb_typeof(sessions)='array' and jsonb_array_length(sessions)<=50),
  checklist jsonb not null default '{}' check(jsonb_typeof(checklist)='object'),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
create table public.lecture_operations_history (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.proposal_cases(id) on delete restrict,
  action text not null check(action in ('save_operations','case_update')),
  revision integer,
  actor_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index lecture_operations_history_case on public.lecture_operations_history(case_id,created_at desc);
create table public.lecture_operations_mutations (
  id uuid primary key,
  case_id uuid not null references public.proposal_cases(id) on delete restrict,
  actor_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.lecture_operations enable row level security;
alter table public.lecture_operations_history enable row level security;
alter table public.lecture_operations_mutations enable row level security;
revoke all on public.lecture_operations,public.lecture_operations_history,public.lecture_operations_mutations from public,anon,authenticated;
grant all on public.lecture_operations,public.lecture_operations_history,public.lecture_operations_mutations to service_role;

create function public.lecture_ops_save(p_case_id uuid,p_admin uuid,p_revision integer,p_mutation uuid,p_payload jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare old lecture_operations; prior lecture_operations_mutations; saved lecture_operations; item jsonb; result jsonb;
 identity_payload jsonb := jsonb_build_object('revision',p_revision,'data',p_payload);
begin
  if not exists(select 1 from profiles where id=p_admin and is_admin=true) then return jsonb_build_object('error','forbidden'); end if;
  if p_mutation is null or p_revision is null or p_revision<0 or jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('error','invalid'); end if;
  perform 1 from proposal_cases where id=p_case_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into prior from lecture_operations_mutations where id=p_mutation;
  if found then
    if prior.case_id<>p_case_id or prior.actor_id<>p_admin or prior.action<>'save_operations' or prior.payload<>identity_payload then return jsonb_build_object('error','conflict'); end if;
    return prior.result || jsonb_build_object('duplicate',true);
  end if;
  select * into old from lecture_operations where case_id=p_case_id;
  if coalesce(old.revision,0)<>p_revision then return jsonb_build_object('error','conflict'); end if;
  if jsonb_typeof(p_payload->'sessions') is distinct from 'array' or jsonb_typeof(p_payload->'checklist') is distinct from 'object'
    or jsonb_array_length(p_payload->'sessions')>50 or (p_payload - array['sessions','checklist'])<>'{}'::jsonb then return jsonb_build_object('error','invalid'); end if;
  if exists(select 1 from jsonb_each(p_payload->'checklist') where key not in ('materials_ready','venue_ready','documents_ready','completed','notes'))
    or jsonb_typeof(p_payload#>'{checklist,materials_ready}') is distinct from 'boolean'
    or jsonb_typeof(p_payload#>'{checklist,venue_ready}') is distinct from 'boolean'
    or jsonb_typeof(p_payload#>'{checklist,documents_ready}') is distinct from 'boolean'
    or jsonb_typeof(p_payload#>'{checklist,completed}') is distinct from 'boolean'
    or jsonb_typeof(p_payload#>'{checklist,notes}') is distinct from 'string'
    or length(p_payload#>>'{checklist,notes}')>3000 then return jsonb_build_object('error','invalid'); end if;
  for item in select value from jsonb_array_elements(p_payload->'sessions') loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'status' not in ('confirmed','completed','cancelled')
      or coalesce(length(trim(item->>'title')),0) not between 1 and 160 or coalesce(length(trim(item->>'instructor')),0) not between 1 and 100
      or coalesce(length(item->>'location'),0)>500 or (item-array['id','title','start_at','end_at','location','instructor','status'])<>'{}'::jsonb
      or item->>'id' is null or item->>'start_at' is null or item->>'end_at' is null or item->>'status' is null
      or (item->>'end_at')::timestamptz <= (item->>'start_at')::timestamptz
      or (item->>'end_at')::timestamptz - (item->>'start_at')::timestamptz > interval '24 hours'
      then return jsonb_build_object('error','invalid'); end if;
    perform (item->>'id')::uuid;
  end loop;
  if (select count(*) from jsonb_array_elements(p_payload->'sessions'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_payload->'sessions')) then return jsonb_build_object('error','invalid'); end if;
  -- One low-volume scheduling lock covers distinct cases, preventing overlap races.
  perform pg_advisory_xact_lock(hashtextextended('bcc:lecture-schedule',0));
  if exists(
    select 1 from jsonb_array_elements(p_payload->'sessions') with ordinality a(value,n)
      cross join jsonb_array_elements(p_payload->'sessions') with ordinality b(value,n)
    where a.n<b.n and a.value->>'status'<>'cancelled' and b.value->>'status'<>'cancelled'
      and lower(trim(a.value->>'instructor'))=lower(trim(b.value->>'instructor'))
      and (a.value->>'start_at')::timestamptz<(b.value->>'end_at')::timestamptz
      and (a.value->>'end_at')::timestamptz>(b.value->>'start_at')::timestamptz
  ) or exists(
    select 1 from jsonb_array_elements(p_payload->'sessions') a
      cross join lecture_operations o cross join lateral jsonb_array_elements(o.sessions) b
    where o.case_id<>p_case_id and a->>'status'<>'cancelled' and b->>'status'<>'cancelled'
      and lower(trim(a->>'instructor'))=lower(trim(b->>'instructor'))
      and (a->>'start_at')::timestamptz<(b->>'end_at')::timestamptz
      and (a->>'end_at')::timestamptz>(b->>'start_at')::timestamptz
  ) then return jsonb_build_object('error','schedule_conflict'); end if;
  insert into lecture_operations(case_id,revision,sessions,checklist,updated_by)
    values(p_case_id,p_revision+1,p_payload->'sessions',p_payload->'checklist',p_admin)
    on conflict(case_id) do update set revision=excluded.revision,sessions=excluded.sessions,checklist=excluded.checklist,updated_by=p_admin,updated_at=clock_timestamp()
    returning * into saved;
  insert into lecture_operations_history(case_id,action,revision,actor_id,snapshot) values(p_case_id,'save_operations',saved.revision,p_admin,to_jsonb(saved));
  result:=jsonb_build_object('operation',to_jsonb(saved));
  insert into lecture_operations_mutations(id,case_id,actor_id,action,payload,result) values(p_mutation,p_case_id,p_admin,'save_operations',identity_payload,result);
  return result;
exception when unique_violation then return jsonb_build_object('error','conflict');
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return jsonb_build_object('error','invalid');
end $$;

create function public.lecture_ops_case_update(p_case_id uuid,p_admin uuid,p_updated_at timestamptz,p_mutation uuid,p_fields jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare old proposal_cases; saved proposal_cases; prior lecture_operations_mutations; result jsonb;
 identity_payload jsonb:=jsonb_build_object('updated_at',p_updated_at,'fields',p_fields);
begin
  if not exists(select 1 from profiles where id=p_admin and is_admin=true) then return jsonb_build_object('error','forbidden'); end if;
  if p_mutation is null or p_updated_at is null or jsonb_typeof(p_fields) is distinct from 'object'
    or p_fields->>'status' is null or p_fields->>'status' not in ('inquiry','analyzing','drafted','reviewing','sent','waiting','won','lost','on_hold')
    or length(coalesce(p_fields->>'next_action',''))>1000
    or (p_fields-array['status','next_action','next_action_at'])<>'{}'::jsonb then return jsonb_build_object('error','invalid'); end if;
  select * into old from proposal_cases where id=p_case_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into prior from lecture_operations_mutations where id=p_mutation;
  if found then
    if prior.case_id<>p_case_id or prior.actor_id<>p_admin or prior.action<>'case_update' or prior.payload<>identity_payload then return jsonb_build_object('error','conflict'); end if;
    return prior.result || jsonb_build_object('duplicate',true);
  end if;
  if old.updated_at is distinct from p_updated_at then return jsonb_build_object('error','conflict'); end if;
  update proposal_cases set status=p_fields->>'status',next_action=nullif(p_fields->>'next_action',''),next_action_at=(p_fields->>'next_action_at')::timestamptz,updated_at=clock_timestamp()
    where id=p_case_id returning * into saved;
  insert into lecture_operations_history(case_id,action,actor_id,snapshot) values(p_case_id,'case_update',p_admin,jsonb_build_object('before',jsonb_build_object('status',old.status,'next_action',old.next_action,'next_action_at',old.next_action_at),'after',p_fields));
  result:=jsonb_build_object('case',to_jsonb(saved));
  insert into lecture_operations_mutations(id,case_id,actor_id,action,payload,result) values(p_mutation,p_case_id,p_admin,'case_update',identity_payload,result);
  return result;
exception when unique_violation then return jsonb_build_object('error','conflict');
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return jsonb_build_object('error','invalid');
end $$;
revoke all on function public.lecture_ops_save(uuid,uuid,integer,uuid,jsonb),public.lecture_ops_case_update(uuid,uuid,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.lecture_ops_save(uuid,uuid,integer,uuid,jsonb),public.lecture_ops_case_update(uuid,uuid,timestamptz,uuid,jsonb) to service_role;
commit;
