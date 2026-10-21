-- Additive migration. Existing proposal IDs, surveys and responses are preserved.
begin;
create table public.lecture_institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.proposal_cases add column institution_id uuid references public.lecture_institutions(id) on delete restrict;
alter table public.proposal_cases add column project_name text;
create index proposal_cases_institution on public.proposal_cases(institution_id,created_at desc);
create table public.lecture_requests (
  receipt uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.proposal_cases(id) on delete cascade,
  idempotency_key uuid not null unique,
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  revision integer not null default 1,
  consent_version text not null,
  consented_at timestamptz not null default now(),
  editable_until timestamptz not null default (now()+interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.lecture_request_revisions (
  receipt uuid not null references public.lecture_requests(receipt) on delete cascade,
  revision integer not null,
  payload jsonb not null,
  consent_version text not null,
  created_at timestamptz not null default now(),
  primary key(receipt,revision)
);
create table public.lecture_request_rate_buckets (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key(bucket,window_start)
);
alter table public.lecture_institutions enable row level security;
alter table public.lecture_requests enable row level security;
alter table public.lecture_request_revisions enable row level security;
alter table public.lecture_request_rate_buckets enable row level security;
revoke all on public.lecture_institutions,public.lecture_requests,public.lecture_request_revisions,public.lecture_request_rate_buckets from public,anon,authenticated;
grant all on public.lecture_institutions,public.lecture_requests,public.lecture_request_revisions,public.lecture_request_rate_buckets to service_role;

-- These are invoker functions, callable only by the server's service_role.
create function public.lecture_request_rate(p_bucket text,p_action text) returns jsonb
language plpgsql set search_path=public as $$
declare hits integer; global_hits integer; window_at timestamptz:=date_trunc('hour',now());
begin
  if p_action not in ('submit','get','update') or p_bucket !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid'); end if;
  -- Only abuse-control digests are aged out, never user submissions.
  delete from lecture_request_rate_buckets where window_start < now()-interval '2 days';
  insert into lecture_request_rate_buckets(bucket,window_start) values('global',window_at)
  on conflict(bucket,window_start) do update set count=lecture_request_rate_buckets.count+1 returning count into global_hits;
  insert into lecture_request_rate_buckets(bucket,window_start) values(p_action||':'||p_bucket,window_at)
  on conflict(bucket,window_start) do update set count=lecture_request_rate_buckets.count+1 returning count into hits;
  if global_hits>3000 or hits > (case when p_action='submit' then 20 else 120 end) then return jsonb_build_object('error','limit'); end if;
  return jsonb_build_object('ok',true);
end $$;

create function public.lecture_request_submit(p_key_hash text,p_idempotency uuid,p_payload jsonb,p_consent_version text) returns jsonb
language plpgsql set search_path=public as $$
declare existing lecture_requests; assigned_owner uuid; new_case uuid; result lecture_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency::text,0));
  select * into existing from lecture_requests where idempotency_key=p_idempotency;
  if found then
    if existing.key_hash<>p_key_hash or existing.editable_until<=now() then return jsonb_build_object('error','conflict'); end if;
    return jsonb_build_object('ok',true,'receipt',existing.receipt,'revision',existing.revision,'duplicate',true);
  end if;
  -- No anonymous caller can choose an owner or link an existing institution/case.
  select id into assigned_owner from profiles where is_admin=true order by id limit 1;
  if assigned_owner is null then return jsonb_build_object('error','configuration'); end if;
  insert into proposal_cases(owner_id,institution_name,contact_name,contact_email,contact_phone,project_name,
    lecture_date,audience,audience_size,duration_hours,budget,inquiry_text,goals,constraints,source,status)
  values(assigned_owner,p_payload->>'institution_name',p_payload->>'contact_name',p_payload->>'contact_email',nullif(p_payload->>'contact_phone',''),nullif(p_payload->>'project_name',''),
    nullif(p_payload->>'lecture_date','')::date,p_payload->>'audience',(p_payload->>'audience_size')::integer,(p_payload->>'duration_hours')::numeric,(p_payload->>'total_budget')::integer,
    '[담당자 강의의뢰 입력] 최신 수정 이력은 강의의뢰 관리에서 확인하세요.'||E'\n'||jsonb_pretty(p_payload),
    p_payload->>'purpose',concat_ws(E'\n',nullif(p_payload->>'special_notes',''),nullif(p_payload->>'location','')),'lecture_request','inquiry') returning id into new_case;
  insert into lecture_requests(case_id,idempotency_key,key_hash,payload,consent_version)
    values(new_case,p_idempotency,p_key_hash,p_payload,p_consent_version) returning * into result;
  insert into lecture_request_revisions(receipt,revision,payload,consent_version) values(result.receipt,1,p_payload,p_consent_version);
  return jsonb_build_object('ok',true,'receipt',result.receipt,'revision',1,'duplicate',false);
end $$;

create function public.lecture_request_get(p_receipt uuid,p_key_hash text) returns jsonb
language plpgsql set search_path=public as $$
declare result lecture_requests;
begin
  select * into result from lecture_requests where receipt=p_receipt and key_hash=p_key_hash and editable_until>now();
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('receipt',result.receipt,'payload',result.payload,'revision',result.revision,'editable_until',result.editable_until);
end $$;

create function public.lecture_request_update(p_receipt uuid,p_key_hash text,p_payload jsonb,p_revision integer,p_consent_version text) returns jsonb
language plpgsql set search_path=public as $$
declare result lecture_requests; previous jsonb;
begin
  select * into result from lecture_requests where receipt=p_receipt and key_hash=p_key_hash and editable_until>now() for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  -- A network retry of the identical update succeeds without a second revision.
  if result.payload=p_payload and result.revision=p_revision+1 then return jsonb_build_object('ok',true,'receipt',result.receipt,'revision',result.revision,'duplicate',true); end if;
  if result.revision<>p_revision then return jsonb_build_object('error','conflict'); end if;
  if result.revision>=100 then return jsonb_build_object('error','limit'); end if;
  previous := result.payload;
  update lecture_requests set payload=p_payload,revision=revision+1,consent_version=p_consent_version,consented_at=now(),updated_at=now() where receipt=p_receipt returning * into result;
  insert into lecture_request_revisions(receipt,revision,payload,consent_version) values(result.receipt,result.revision,p_payload,p_consent_version);
  -- Keep admin's status, notes, canonical institution and proposals intact.
  -- Refresh public fields only when an admin has not changed them since the last submission.
  update proposal_cases c set
    contact_name=case when c.contact_name is not distinct from nullif(previous->>'contact_name','') then nullif(p_payload->>'contact_name','') else c.contact_name end,
    contact_email=case when c.contact_email is not distinct from nullif(previous->>'contact_email','') then nullif(p_payload->>'contact_email','') else c.contact_email end,
    contact_phone=case when c.contact_phone is not distinct from nullif(previous->>'contact_phone','') then nullif(p_payload->>'contact_phone','') else c.contact_phone end,
    project_name=case when c.project_name is not distinct from nullif(previous->>'project_name','') then nullif(p_payload->>'project_name','') else c.project_name end,
    audience=case when c.audience is not distinct from nullif(previous->>'audience','') then nullif(p_payload->>'audience','') else c.audience end,
    lecture_date=case when c.lecture_date is not distinct from nullif(previous->>'lecture_date','')::date then nullif(p_payload->>'lecture_date','')::date else c.lecture_date end,
    audience_size=case when c.audience_size is not distinct from nullif(previous->>'audience_size','')::integer then nullif(p_payload->>'audience_size','')::integer else c.audience_size end,
    duration_hours=case when c.duration_hours is not distinct from nullif(previous->>'duration_hours','')::numeric then nullif(p_payload->>'duration_hours','')::numeric else c.duration_hours end,
    institution_name=case when c.institution_id is null and c.institution_name=previous->>'institution_name' then p_payload->>'institution_name' else c.institution_name end,
    budget=case when c.budget is not distinct from (previous->>'total_budget')::integer then (p_payload->>'total_budget')::integer else c.budget end,
    goals=case when c.goals=previous->>'purpose' then p_payload->>'purpose' else c.goals end,
    constraints=case when c.constraints=concat_ws(E'\n',nullif(previous->>'special_notes',''),nullif(previous->>'location','')) then concat_ws(E'\n',nullif(p_payload->>'special_notes',''),nullif(p_payload->>'location','')) else c.constraints end,
    inquiry_text=case when c.inquiry_text='[담당자 강의의뢰 입력] 최신 수정 이력은 강의의뢰 관리에서 확인하세요.'||E'\n'||jsonb_pretty(previous) then '[담당자 강의의뢰 입력] 최신 수정 이력은 강의의뢰 관리에서 확인하세요.'||E'\n'||jsonb_pretty(p_payload) else c.inquiry_text end,
    updated_at=now()
  where c.id=result.case_id;
  return jsonb_build_object('ok',true,'receipt',result.receipt,'revision',result.revision);
end $$;

create function public.lecture_request_ensure_survey(p_case_id uuid,p_admin uuid) returns jsonb
language plpgsql set search_path=public as $$
declare lecture proposal_cases; survey training_need_surveys;
begin
  if not exists(select 1 from profiles where id=p_admin and is_admin=true) then return jsonb_build_object('error','not_found'); end if;
  select * into lecture from proposal_cases where id=p_case_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into survey from training_need_surveys where case_id=p_case_id order by created_at desc limit 1;
  if not found then
    insert into training_need_surveys(case_id,created_by,public_code,institution_label,title,audience_label,lecture_date,expected_response_count,status)
    values(lecture.id,p_admin,upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),lecture.institution_name,
      coalesce(nullif(lecture.project_name,''),'교육생 사전 수요조사'),lecture.audience,lecture.lecture_date,lecture.audience_size,'open') returning * into survey;
  end if;
  return jsonb_build_object('survey',to_jsonb(survey));
end $$;

revoke all on function public.lecture_request_rate(text,text), public.lecture_request_submit(text,uuid,jsonb,text),public.lecture_request_get(uuid,text),public.lecture_request_update(uuid,text,jsonb,integer,text),public.lecture_request_ensure_survey(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lecture_request_rate(text,text),public.lecture_request_submit(text,uuid,jsonb,text),public.lecture_request_get(uuid,text),public.lecture_request_update(uuid,text,jsonb,integer,text),public.lecture_request_ensure_survey(uuid,uuid) to service_role;
commit;
