-- BCC 잇툴즈 도구 이용 신청 (2026-11-12)
-- 공개 제출은 Vercel API(service_role)가 검증한 뒤에만 저장한다. anon/authenticated 정책은 만들지 않는다.

create table if not exists tool_leads (
  id                 bigint generated always as identity primary key,
  tool               text not null check (tool ~ '^[a-z0-9-]{1,40}$'),
  name               text not null check (char_length(name) between 1 and 40),
  phone              text not null check (phone ~ '^01[0-9]{8,9}$'),
  email              text check (email is null or char_length(email) <= 254),
  marketing_consent  boolean not null default false,
  consent_version    text not null,
  overseas_consent   boolean not null check (overseas_consent),
  source             jsonb not null default '{}'::jsonb,
  ip_bucket          text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_tool_leads_created on tool_leads(created_at desc);
create index if not exists idx_tool_leads_bucket on tool_leads(ip_bucket, created_at) where ip_bucket is not null;
create index if not exists idx_tool_leads_phone_tool on tool_leads(phone, tool, created_at);

alter table tool_leads enable row level security;
revoke all on tool_leads from public, anon, authenticated;
grant all on tool_leads to service_role;
grant all on sequence tool_leads_id_seq to service_role;
