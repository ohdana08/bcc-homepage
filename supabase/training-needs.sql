-- BCC 교육생 니즈분석 v1
-- 응답은 실명·이메일을 받지 않고, Vercel API(service_role)로만 저장한다.

create extension if not exists pgcrypto;

create table if not exists training_need_surveys (
  id                       uuid primary key default gen_random_uuid(),
  case_id                  uuid references proposal_cases(id) on delete set null,
  created_by               uuid not null references auth.users(id) on delete restrict,
  public_code              text not null unique,
  institution_label        text not null,
  title                    text not null,
  audience_label           text,
  lecture_date             date,
  response_deadline        date,
  expected_response_count  integer check (expected_response_count is null or expected_response_count >= 0),
  is_sample                boolean not null default false,
  status                   text not null default 'open'
                           check (status in ('draft','open','closed','analyzed')),
  analysis                 jsonb not null default '{}'::jsonb,
  analysis_generated_at    timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists training_need_responses (
  id               bigint generated always as identity primary key,
  survey_id        uuid not null references training_need_surveys(id) on delete cascade,
  idempotency_key  uuid not null,
  answers          jsonb not null,
  submitted_at     timestamptz not null default now(),
  unique(survey_id, idempotency_key)
);

create index if not exists idx_training_need_surveys_updated
  on training_need_surveys(updated_at desc);
create index if not exists idx_training_need_responses_survey
  on training_need_responses(survey_id, submitted_at);

alter table training_need_surveys enable row level security;
alter table training_need_responses enable row level security;

-- anon/authenticated 정책은 만들지 않는다. 공개 제출도 서버 API가 검증한 후 service_role로만 저장한다.
grant all on training_need_surveys, training_need_responses to service_role;
grant all on sequence training_need_responses_id_seq to service_role;
