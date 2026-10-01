-- Design SQL for the BCC homepage project only. Apply explicitly after review.
-- No document content, filenames, raw IP addresses or API keys are persisted.
-- Hard daily ceilings: 12 analyses per daily HMAC identity and 120 globally.
begin;

create table if not exists public.document_mate_quota (
  quota_day date not null,
  identity_digest text not null check (identity_digest ~ '^[0-9a-f]{64}$'),
  used_count integer not null default 0 check (used_count between 0 and 12),
  primary key (quota_day, identity_digest)
);
alter table public.document_mate_quota enable row level security;
revoke all on table public.document_mate_quota from public, anon, authenticated;
grant select, insert, update, delete on table public.document_mate_quota to service_role;

create or replace function public.document_mate_claim_quota(p_identity text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day date := (current_timestamp at time zone 'UTC')::date;
  v_used integer := 0;
  v_total integer := 0;
begin
  if p_identity is null or p_identity !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid quota identity';
  end if;

  -- Every claim for the day shares a transaction lock, including new identities.
  -- The ceiling check and increment cannot race across serverless instances.
  perform pg_catalog.pg_advisory_xact_lock(817492, (v_day - date '2000-01-01')::integer);
  delete from public.document_mate_quota where quota_day < v_day - 2;
  select coalesce(sum(used_count), 0)::integer into v_total
    from public.document_mate_quota where quota_day = v_day;
  select used_count into v_used from public.document_mate_quota
    where quota_day = v_day and identity_digest = p_identity;
  v_used := coalesce(v_used, 0);
  if v_total >= 120 or v_used >= 12 then
    return jsonb_build_object('allowed', false, 'remaining', 0);
  end if;
  insert into public.document_mate_quota (quota_day, identity_digest, used_count)
    values (v_day, p_identity, 1)
    on conflict (quota_day, identity_digest)
    do update set used_count = public.document_mate_quota.used_count + 1;
  return jsonb_build_object('allowed', true, 'remaining', least(12 - v_used - 1, 120 - v_total - 1));
end;
$$;
revoke all on function public.document_mate_claim_quota(text) from public, anon, authenticated;
grant execute on function public.document_mate_claim_quota(text) to service_role;

comment on table public.document_mate_quota is 'AI문서메이트 일별 이용 횟수만 저장. 일별 HMAC 식별자. 자료 본문 저장 금지.';
commit;
