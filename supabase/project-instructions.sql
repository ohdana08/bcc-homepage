-- AI 업무지시서: private, service_role-only storage. No existing tables/policies changed.
-- Apply with the database owner's account after review. UTC calendar retention: three years.
begin;

create table if not exists public.project_instruction_classes (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique check (public_code ~ '^[A-Za-z0-9_-]{8,64}$'),
  institution text not null check (char_length(institution) between 1 and 120),
  course text not null check (char_length(course) between 1 and 120),
  session text not null check (char_length(session) between 1 and 120),
  is_open boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists public.project_instruction_submissions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  receipt_token_hash text not null check (receipt_token_hash ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  class_id uuid references public.project_instruction_classes(id) on delete restrict,
  participation jsonb not null check (jsonb_typeof(participation) = 'object'),
  title text not null check (char_length(title) between 1 and 120),
  document text not null check (char_length(document) between 1 and 60000),
  consent_version text not null check (consent_version = '2026-10-01-v1'),
  age14 boolean not null default true check (age14 = true),
  internal_consent boolean not null default true check (internal_consent = true),
  overseas_consent boolean not null default true check (overseas_consent = true),
  case_study boolean not null default false,
  case_draft text not null default '' check (char_length(case_draft) <= 60000),
  case_updated_at timestamptz,
  case_withdrawn_at timestamptz,
  submitted_at timestamptz not null default now(),
  expires_at timestamptz not null default ((now() at time zone 'UTC' + interval '3 years') at time zone 'UTC'),
  check (expires_at > submitted_at),
  check (case_study or (case_draft = '' and case_updated_at is null))
);
-- Deleted source contents and receipt hashes do not survive deletion. This key
-- alone prevents a delayed identical POST from recreating the deleted document.
create table if not exists public.project_instruction_tombstones (
  idempotency_key uuid primary key,
  expires_at timestamptz not null
);
-- Durable, content-free quota counters cannot be reset by deleting submissions.
create table if not exists public.project_instruction_write_windows (
  scope text not null,
  bucket_start timestamptz not null,
  expires_at timestamptz not null,
  used integer not null check (used >= 0),
  primary key (scope, bucket_start)
);
create table if not exists public.project_instruction_retention_status (
  id boolean primary key default true check (id = true),
  last_success_at timestamptz not null,
  deleted_count bigint not null check (deleted_count >= 0)
);
alter table public.project_instruction_retention_status enable row level security;
revoke all on public.project_instruction_retention_status from public, anon, authenticated;
grant select, insert, update on public.project_instruction_retention_status to service_role;

create index if not exists project_instruction_submissions_expires_idx on public.project_instruction_submissions(expires_at);
create index if not exists project_instruction_submissions_class_time_idx on public.project_instruction_submissions(class_id, submitted_at desc);
create index if not exists project_instruction_submissions_time_idx on public.project_instruction_submissions(submitted_at desc);
create index if not exists project_instruction_tombstones_expires_idx on public.project_instruction_tombstones(expires_at);
create index if not exists project_instruction_windows_expires_idx on public.project_instruction_write_windows(expires_at);

alter table public.project_instruction_classes enable row level security;
alter table public.project_instruction_submissions enable row level security;
alter table public.project_instruction_tombstones enable row level security;
alter table public.project_instruction_write_windows enable row level security;
revoke all on public.project_instruction_classes, public.project_instruction_submissions, public.project_instruction_tombstones, public.project_instruction_write_windows from public, anon, authenticated;
grant select, insert, update, delete on public.project_instruction_classes, public.project_instruction_submissions, public.project_instruction_tombstones, public.project_instruction_write_windows to service_role;

create or replace function public.project_instruction_submit(
  p_key uuid, p_receipt_hash text, p_payload_hash text, p_class_code text,
  p_participation jsonb, p_document text, p_title text, p_consent_version text, p_case_study boolean
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  old_row public.project_instruction_submissions%rowtype;
  class_row public.project_instruction_classes%rowtype;
  new_row public.project_instruction_submissions%rowtype;
  metadata jsonb;
  hour_bucket timestamptz := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  day_bucket timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  global_used integer;
  class_used integer;
  class_scope text;
begin
  if p_key is null or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
     or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
     or p_document is null or char_length(p_document) not between 1 and 60000
     or p_title is null or char_length(p_title) not between 1 and 120
     or p_consent_version is distinct from '2026-10-01-v1' or p_case_study is null
     or p_participation is null or jsonb_typeof(p_participation) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  -- Shared with delete: prevents the delete/retry race from recreating a row.
  perform pg_advisory_xact_lock(771463920015::bigint);
  if exists(select 1 from public.project_instruction_tombstones where idempotency_key = p_key and expires_at > now()) then
    return jsonb_build_object('status', 'conflict');
  end if;
  select * into old_row from public.project_instruction_submissions where idempotency_key = p_key;
  if found then
    if old_row.expires_at <= now() or old_row.receipt_token_hash <> p_receipt_hash or old_row.payload_hash <> p_payload_hash then
      return jsonb_build_object('status', 'conflict');
    end if;
    -- A replay never updates content or revives previously withdrawn consent.
    return jsonb_build_object('status', 'replayed', 'id', old_row.id, 'submittedAt', old_row.submitted_at, 'expiresAt', old_row.expires_at);
  end if;
  metadata := p_participation;
  if coalesce(p_class_code, '') <> '' then
    select * into class_row from public.project_instruction_classes where public_code = p_class_code for share;
    if not found then return jsonb_build_object('status', 'class_missing'); end if;
    if not class_row.is_open then return jsonb_build_object('status', 'class_closed'); end if;
    metadata := metadata || jsonb_build_object('institution', class_row.institution, 'course', class_row.course, 'session', class_row.session);
    class_scope := 'class:' || class_row.id::text;
  end if;
  select used into global_used from public.project_instruction_write_windows where scope = 'global' and bucket_start = hour_bucket;
  if coalesce(global_used, 0) >= 300 then return jsonb_build_object('status', 'rate_limited'); end if;
  if class_scope is not null then
    select used into class_used from public.project_instruction_write_windows where scope = class_scope and bucket_start = day_bucket;
    if coalesce(class_used, 0) >= 500 then return jsonb_build_object('status', 'rate_limited'); end if;
  end if;
  insert into public.project_instruction_write_windows(scope, bucket_start, expires_at, used)
    values ('global', hour_bucket, hour_bucket + interval '1 hour', 1)
    on conflict (scope, bucket_start) do update set used = public.project_instruction_write_windows.used + 1;
  if class_scope is not null then
    insert into public.project_instruction_write_windows(scope, bucket_start, expires_at, used)
      values (class_scope, day_bucket, day_bucket + interval '1 day', 1)
      on conflict (scope, bucket_start) do update set used = public.project_instruction_write_windows.used + 1;
  end if;
  insert into public.project_instruction_submissions(idempotency_key, receipt_token_hash, payload_hash, class_id,
    participation, title, document, consent_version, case_study)
    values (p_key, p_receipt_hash, p_payload_hash, class_row.id, metadata, p_title, p_document, p_consent_version, p_case_study)
    returning * into new_row;
  return jsonb_build_object('status', 'created', 'id', new_row.id, 'submittedAt', new_row.submitted_at, 'expiresAt', new_row.expires_at);
end;
$$;

create or replace function public.project_instruction_delete(p_id uuid, p_receipt_hash text, p_admin boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare old_row public.project_instruction_submissions%rowtype;
begin
  perform pg_advisory_xact_lock(771463920015::bigint);
  select * into old_row from public.project_instruction_submissions
    where id = p_id and expires_at > now() and (p_admin is true or receipt_token_hash = p_receipt_hash) for update;
  if not found then return false; end if;
  insert into public.project_instruction_tombstones(idempotency_key, expires_at)
    values (old_row.idempotency_key, old_row.expires_at)
    on conflict (idempotency_key) do update set expires_at = greatest(public.project_instruction_tombstones.expires_at, excluded.expires_at);
  delete from public.project_instruction_submissions where id = old_row.id;
  return true;
end;
$$;

create or replace function public.purge_project_instructions()
returns bigint language plpgsql security invoker set search_path = '' as $$
declare removed bigint;
begin
  -- Same boundary as all API reads; no account/course/payment deletion calls.
  with deleted as (delete from public.project_instruction_submissions where expires_at <= now() returning id)
  select count(*) into removed from deleted;
  delete from public.project_instruction_tombstones where expires_at <= now();
  delete from public.project_instruction_write_windows where expires_at <= now();
  insert into public.project_instruction_retention_status(id, last_success_at, deleted_count)
    values (true, clock_timestamp(), removed)
    on conflict (id) do update set last_success_at = excluded.last_success_at, deleted_count = excluded.deleted_count;
  return removed;
end;
$$;
-- Exact full-scope aggregates; no client-side row cap or document content.
create or replace function public.project_instruction_stats(p_class_id uuid, p_q text, p_at timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select participation, case_study from public.project_instruction_submissions
    where expires_at > p_at and (p_class_id is null or class_id = p_class_id)
      and (coalesce(p_q, '') = '' or strpos(lower(title), lower(p_q)) > 0)
  ), answers as (
    select key, value from filtered,
      lateral jsonb_each_text(participation) as item(key, value)
      where key in ('ageRange','gender','occupation','aiExperience') and value <> ''
  ), distributions as (
    select key, jsonb_agg(jsonb_build_object('value', value, 'count', frequency) order by value) as items
    from (select key, value, count(*) as frequency from answers group by key, value) counts group by key
  )
  select jsonb_build_object(
    'total', count(*), 'caseStudy', count(*) filter (where case_study),
    'ageAnswered', count(*) filter (where coalesce(participation->>'ageRange', '') <> ''),
    'genderAnswered', count(*) filter (where coalesce(participation->>'gender', '') <> ''),
    'occupationAnswered', count(*) filter (where coalesce(participation->>'occupation', '') <> ''),
    'aiExperienceAnswered', count(*) filter (where coalesce(participation->>'aiExperience', '') <> ''),
    'distributions', coalesce((select jsonb_object_agg(key, items) from distributions), '{}'::jsonb)
  ) from filtered;
$$;
revoke all on function public.project_instruction_stats(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.project_instruction_stats(uuid,text,timestamptz) to service_role;

revoke all on function public.project_instruction_submit(uuid,text,text,text,jsonb,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.project_instruction_delete(uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.purge_project_instructions() from public, anon, authenticated;
grant execute on function public.project_instruction_submit(uuid,text,text,text,jsonb,text,text,text,boolean) to service_role;
grant execute on function public.project_instruction_delete(uuid,text,boolean) to service_role;
grant execute on function public.purge_project_instructions() to service_role;

comment on table public.project_instruction_submissions is 'Private consented instruction submissions. Exact reviewed document separate from participation metadata; expires after three UTC calendar years.';
comment on table public.project_instruction_tombstones is 'Deletion replay prevention only: random idempotency key and original expiration; no source, person or receipt token.';
comment on function public.purge_project_instructions() is 'Delete expired project-instruction rows, tombstones and quota windows only. No unrelated account cleanup.';
commit;
-- Scheduling is a separate reviewed deployment step. Example for an owner with pg_cron:
-- select cron.schedule('bcc-project-instruction-retention', '17 * * * *', 'select public.purge_project_instructions()');
