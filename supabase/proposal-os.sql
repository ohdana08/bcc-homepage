-- BCC 기관 제안 운영실 v1
-- 관리자 전용 데이터. 프론트 직접 접근 정책은 만들지 않고 Vercel 관리자 API(service_role)만 사용한다.

create extension if not exists pgcrypto;

create table if not exists proposal_cases (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete restrict,
  institution_name  text not null,
  institution_type  text,
  contact_name      text,
  contact_email     text,
  contact_phone     text,
  inquiry_date      date default current_date,
  lecture_date      date,
  audience          text,
  audience_size     integer,
  duration_hours    numeric(6,2),
  budget            integer,
  inquiry_text      text not null,
  goals             text,
  constraints       text,
  status            text not null default 'inquiry'
                    check (status in ('inquiry','analyzing','drafted','reviewing','sent','waiting','won','lost','on_hold')),
  next_action       text,
  next_action_at    timestamptz,
  source            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists proposal_outputs (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references proposal_cases(id) on delete cascade,
  version            integer not null,
  demand_analysis    jsonb not null default '{}'::jsonb,
  recommendation     jsonb not null default '{}'::jsonb,
  proposal           jsonb not null default '{}'::jsonb,
  curriculum         jsonb not null default '[]'::jsonb,
  email_draft        jsonb not null default '{}'::jsonb,
  qa                 jsonb not null default '{}'::jsonb,
  knowledge_sources  jsonb not null default '[]'::jsonb,
  approved           boolean not null default false,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique(case_id, version)
);

create table if not exists proposal_learnings (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references proposal_cases(id) on delete cascade,
  output_id          uuid references proposal_outputs(id) on delete set null,
  category           text not null default '기타',
  observed_issue     text not null,
  correction_reason  text not null,
  corrected_text     text,
  recurrence_rule    text,
  rule_status        text not null default 'candidate'
                     check (rule_status in ('candidate','confirmed','retired')),
  recurrence_count   integer not null default 1,
  created_at         timestamptz not null default now()
);

create table if not exists proposal_knowledge (
  id           uuid primary key default gen_random_uuid(),
  source_path  text not null unique,
  source_hash  text not null,
  source_kind  text not null default 'lecture_record',
  title        text not null,
  content      text not null,
  metadata     jsonb not null default '{}'::jsonb,
  active       boolean not null default true,
  synced_at    timestamptz not null default now()
);

create index if not exists idx_proposal_cases_status_updated
  on proposal_cases(status, updated_at desc);
create index if not exists idx_proposal_cases_next_action
  on proposal_cases(next_action_at) where next_action_at is not null;
create index if not exists idx_proposal_outputs_case_version
  on proposal_outputs(case_id, version desc);
create index if not exists idx_proposal_learnings_case_created
  on proposal_learnings(case_id, created_at desc);
create index if not exists idx_proposal_knowledge_kind_active
  on proposal_knowledge(source_kind, active);

alter table proposal_cases enable row level security;
alter table proposal_outputs enable row level security;
alter table proposal_learnings enable row level security;
alter table proposal_knowledge enable row level security;

-- service_role만 서버에서 접근한다. anon/authenticated에 별도 정책을 만들지 않는다.
grant all on proposal_cases, proposal_outputs, proposal_learnings, proposal_knowledge to service_role;

