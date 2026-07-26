-- Threads 완전 자동 운영: 하루 5개 + 0분/5분/15분/6시간/24시간 루틴
-- Supabase SQL Editor에서 한 번 실행한다.

create extension if not exists pgcrypto;

create table if not exists public.threads_autopilot_config (
  id text primary key default 'default',
  enabled boolean not null default false,
  profile_username text not null default 'ai_crazy_lab_1201',
  timezone text not null default 'Asia/Seoul',
  publish_times jsonb not null default '["08:30","11:30","14:30","18:30","21:30"]'::jsonb,
  campaign_context text not null default
    'AI 강사의 기관 수주 백스테이지. 기관 강의 제안, 커리큘럼, 견적, 운영 업무를 실제로 줄이는 실무 콘텐츠를 제공하고 필요한 사람에게 기관 AI 강의 제안·커리큘럼 실무팩을 연결한다.',
  start_date date,
  next_sequence integer not null default 1,
  last_generated_date date,
  updated_at timestamptz not null default now()
);

insert into public.threads_autopilot_config (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.threads_autopilot_posts (
  id uuid primary key default gen_random_uuid(),
  sequence integer not null unique,
  schedule_date date not null,
  slot_index integer not null check (slot_index between 0 and 4),
  scheduled_at timestamptz not null,
  content_type text not null,
  text text not null,
  self_comment_0 text not null,
  self_comment_6h text not null,
  search_queries jsonb not null default '[]'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'published', 'failed')),
  attempts integer not null default 0,
  thread_id text unique,
  permalink text,
  published_at timestamptz,
  zero_comment_id text,
  external_due_at timestamptz,
  external_done_at timestamptz,
  external_comment_count integer not null default 0,
  reply_due_at timestamptz,
  reply_done_at timestamptz,
  reply_count integer not null default 0,
  six_hour_due_at timestamptz,
  six_hour_done_at timestamptz,
  six_hour_comment_id text,
  twenty_four_due_at timestamptz,
  twenty_four_done_at timestamptz,
  performance_comment text,
  performance_comment_id text,
  metrics jsonb,
  next_post_id uuid references public.threads_autopilot_posts(id) on delete set null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_date, slot_index)
);

create index if not exists threads_autopilot_posts_due_idx
  on public.threads_autopilot_posts(status, scheduled_at);
create index if not exists threads_autopilot_posts_external_idx
  on public.threads_autopilot_posts(external_due_at)
  where external_done_at is null;
create index if not exists threads_autopilot_posts_reply_idx
  on public.threads_autopilot_posts(reply_due_at)
  where reply_done_at is null;
create index if not exists threads_autopilot_posts_six_hour_idx
  on public.threads_autopilot_posts(six_hour_due_at)
  where six_hour_done_at is null;
create index if not exists threads_autopilot_posts_twenty_four_idx
  on public.threads_autopilot_posts(twenty_four_due_at)
  where twenty_four_done_at is null;

create table if not exists public.threads_autopilot_interactions (
  id bigint generated always as identity primary key,
  source_post_id uuid not null references public.threads_autopilot_posts(id) on delete cascade,
  interaction_type text not null
    check (interaction_type in ('external_comment', 'inbound_reply')),
  target_thread_id text not null,
  target_username text,
  target_permalink text,
  response_thread_id text,
  response_text text,
  created_at timestamptz not null default now(),
  unique (interaction_type, target_thread_id)
);

create index if not exists threads_autopilot_interactions_source_idx
  on public.threads_autopilot_interactions(source_post_id, created_at desc);

alter table public.threads_autopilot_config enable row level security;
alter table public.threads_autopilot_posts enable row level security;
alter table public.threads_autopilot_interactions enable row level security;

-- 정책 없음: 브라우저의 anon/authenticated 직접 접근 금지.
-- Vercel 서버의 service_role만 읽고 쓴다.
grant all on public.threads_autopilot_config to service_role;
grant all on public.threads_autopilot_posts to service_role;
grant all on public.threads_autopilot_interactions to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 계정 연결과 테스트가 끝난 뒤에만 실행:
-- update public.threads_autopilot_config
-- set enabled = true, start_date = (now() at time zone 'Asia/Seoul')::date + 1
-- where id = 'default';

