-- Private opt-in tool usage. Shares parent retention and existing content-free quotas.
-- Parent delete/retry and usage mutations acquire the same advisory lock, then parent row lock.
begin;

create or replace function public.project_instruction_usage_valid_event(e jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare n integer; k text;
begin
  if e is null or jsonb_typeof(e) <> 'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(e) as x(key) where key not in
    ('eventId','mode','outcome','durationMs','review','endUserConsent','baselineSeconds','workSeconds','workTimeSource','comparableTask','checkedItems','correctItems','checkMethod','criteriaVersion')) then return false; end if;
  if not e ?& array['eventId','mode','outcome','durationMs','review','endUserConsent'] then return false; end if;
  if jsonb_typeof(e->'eventId') <> 'string' or (e->>'eventId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (e->>'mode') not in ('test','live') or (e->>'outcome') not in ('completed','failed')
    or (e->>'review') not in ('not_reviewed','accepted','corrected','rejected') or (e->'endUserConsent') is distinct from 'true'::jsonb then return false; end if;
  if jsonb_typeof(e->'durationMs') <> 'number' or (e->>'durationMs') !~ '^[0-9]{1,8}$' or (e->>'durationMs')::numeric > 86400000 then return false; end if;
  select count(*) into n from unnest(array['baselineSeconds','workSeconds','workTimeSource','comparableTask']) x(key) where e ? key;
  if n not in (0,4) then return false; end if;
  if n = 4 then
    foreach k in array array['baselineSeconds','workSeconds'] loop
      if jsonb_typeof(e->k) <> 'number' or (e->>k) !~ '^[0-9]{1,5}$' or (e->>k)::numeric > 86400 then return false; end if;
    end loop;
    if (e->>'baselineSeconds')::numeric < 1 or (e->>'workTimeSource') not in ('measured','self_reported') or (e->'comparableTask') is distinct from 'true'::jsonb then return false; end if;
  end if;
  select count(*) into n from unnest(array['checkedItems','correctItems','checkMethod','criteriaVersion']) x(key) where e ? key;
  if n not in (0,4) then return false; end if;
  if n = 4 then
    foreach k in array array['checkedItems','correctItems'] loop
      if jsonb_typeof(e->k) <> 'number' or (e->>k) !~ '^[0-9]{1,5}$' or (e->>k)::numeric > 10000 then return false; end if;
    end loop;
    if (e->>'checkedItems')::numeric < 1 or (e->>'correctItems')::numeric > (e->>'checkedItems')::numeric
      or (e->>'checkMethod') not in ('human_review','reference_check') or jsonb_typeof(e->'criteriaVersion') <> 'string'
      or (e->>'criteriaVersion') !~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,2}$' then return false; end if;
  end if;
  if (e->>'outcome') = 'failed' and ((e->>'review') <> 'not_reviewed' or e ? 'baselineSeconds' or e ? 'checkedItems') then return false; end if;
  -- JSON null values cannot pass SQL's three-valued comparisons.
  if exists(select 1 from jsonb_each(e) x where value = 'null'::jsonb) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create table public.project_instruction_usage_connections (
  submission_id uuid primary key references public.project_instruction_submissions(id) on delete cascade,
  write_token_hash text check(write_token_hash ~ '^[a-f0-9]{64}$'),
  generation integer not null default 1 check(generation > 0),
  consent_version text not null check(consent_version = '2026-10-02-usage-v1'),
  consent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check((revoked_at is null and write_token_hash is not null) or (revoked_at is not null and write_token_hash is null))
);
create table public.project_instruction_usage_events (
  submission_id uuid not null references public.project_instruction_usage_connections(submission_id) on delete cascade,
  event_id uuid not null,
  event jsonb not null check(public.project_instruction_usage_valid_event(event)),
  received_at timestamptz not null default now(),
  primary key(submission_id,event_id),
  check(event_id::text = event->>'eventId')
);
create index project_instruction_usage_events_time_idx on public.project_instruction_usage_events(submission_id,received_at desc,event_id desc);
alter table public.project_instruction_usage_connections enable row level security;
alter table public.project_instruction_usage_events enable row level security;
revoke all on public.project_instruction_usage_connections,public.project_instruction_usage_events from public,anon,authenticated;
grant select,insert,update,delete on public.project_instruction_usage_connections,public.project_instruction_usage_events to service_role;

create or replace function public.project_instruction_usage_manage(
  p_action text,p_id uuid,p_receipt_hash text,p_write_hash text default null,p_expected_generation integer default null,p_consent_version text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare parent public.project_instruction_submissions%rowtype; link public.project_instruction_usage_connections%rowtype;
begin
  if p_action is null or p_action not in ('enable','rotate','revoke') or p_id is null or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','invalid'); end if;
  if p_action in ('enable','rotate') and (p_write_hash is null or p_write_hash !~ '^[a-f0-9]{64}$' or p_write_hash = p_receipt_hash) then return jsonb_build_object('status','invalid'); end if;
  if p_action = 'enable' and p_consent_version is distinct from '2026-10-02-usage-v1' then return jsonb_build_object('status','invalid'); end if;
  if p_action = 'rotate' and (p_expected_generation is null or p_expected_generation not between 1 and 2147483646) then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(771463920015::bigint);
  select * into parent from public.project_instruction_submissions where id=p_id and receipt_token_hash=p_receipt_hash and expires_at>now() for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  select * into link from public.project_instruction_usage_connections where submission_id=p_id for update;
  if p_action = 'enable' then
    if found then
      if link.revoked_at is not null or link.write_token_hash <> p_write_hash then return jsonb_build_object('status','conflict'); end if;
      return jsonb_build_object('status','replayed');
    end if;
    insert into public.project_instruction_usage_connections(submission_id,write_token_hash,consent_version,expires_at)
      values(p_id,p_write_hash,p_consent_version,parent.expires_at);
    return jsonb_build_object('status','created');
  end if;
  if not found then return jsonb_build_object('status','missing'); end if;
  if p_action = 'revoke' then
    -- A permanent marker remains until the original parent expiry. Delayed enables cannot resurrect it.
    update public.project_instruction_usage_connections set write_token_hash=null,revoked_at=coalesce(revoked_at,now()) where submission_id=p_id;
    delete from public.project_instruction_usage_events where submission_id=p_id;
    return jsonb_build_object('status','revoked');
  end if;
  if link.revoked_at is not null then return jsonb_build_object('status','missing'); end if;
  if link.generation = p_expected_generation+1 and link.write_token_hash = p_write_hash then return jsonb_build_object('status','replayed'); end if;
  if link.generation <> p_expected_generation or link.write_token_hash = p_write_hash then return jsonb_build_object('status','conflict'); end if;
  update public.project_instruction_usage_connections set write_token_hash=p_write_hash,generation=generation+1 where submission_id=p_id;
  return jsonb_build_object('status','updated');
end;
$$;

create or replace function public.project_instruction_usage_ingest(p_id uuid,p_write_hash text,p_event jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare parent public.project_instruction_submissions%rowtype; link public.project_instruction_usage_connections%rowtype;
  old public.project_instruction_usage_events%rowtype; inserted public.project_instruction_usage_events%rowtype;
  bucket timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  global_used integer; connection_used integer; connection_scope text;
begin
  if p_id is null or p_write_hash is null or p_write_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','missing'); end if;
  if not public.project_instruction_usage_valid_event(p_event) then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(771463920015::bigint);
  select * into parent from public.project_instruction_submissions where id=p_id and expires_at>now() for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  select * into link from public.project_instruction_usage_connections where submission_id=p_id and expires_at>now() and revoked_at is null and write_token_hash=p_write_hash for update;
  if not found then return jsonb_build_object('status','missing'); end if;
  select * into old from public.project_instruction_usage_events where submission_id=p_id and event_id=(p_event->>'eventId')::uuid;
  if found then
    if old.event <> p_event then return jsonb_build_object('status','conflict'); end if;
    return jsonb_build_object('status','replayed','eventId',old.event_id,'receivedAt',old.received_at,'mode',old.event->>'mode');
  end if;
  connection_scope := 'usage:connection:'||p_id::text;
  select used into global_used from public.project_instruction_write_windows where scope='usage:global' and bucket_start=bucket;
  select used into connection_used from public.project_instruction_write_windows where scope=connection_scope and bucket_start=bucket;
  if coalesce(global_used,0)>=10000 or coalesce(connection_used,0)>=1000
    or (select count(*) from public.project_instruction_usage_events where submission_id=p_id)>=30000 then return jsonb_build_object('status','rate_limited'); end if;
  insert into public.project_instruction_write_windows(scope,bucket_start,expires_at,used) values('usage:global',bucket,bucket+interval '1 day',1)
    on conflict(scope,bucket_start) do update set used=public.project_instruction_write_windows.used+1;
  insert into public.project_instruction_write_windows(scope,bucket_start,expires_at,used) values(connection_scope,bucket,bucket+interval '1 day',1)
    on conflict(scope,bucket_start) do update set used=public.project_instruction_write_windows.used+1;
  insert into public.project_instruction_usage_events(submission_id,event_id,event) values(p_id,(p_event->>'eventId')::uuid,p_event) returning * into inserted;
  return jsonb_build_object('status','created','eventId',inserted.event_id,'receivedAt',inserted.received_at,'mode',inserted.event->>'mode');
end;
$$;

-- Every group is computed in PostgreSQL across the full authorized scope, not a capped event list.
create or replace function public.project_instruction_usage_stats(p_class_id uuid,p_q text,p_id uuid,p_at timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with scope as (
    select e.submission_id,e.event from public.project_instruction_usage_events e
      join public.project_instruction_usage_connections c on c.submission_id=e.submission_id
      join public.project_instruction_submissions s on s.id=e.submission_id
    where s.expires_at>p_at and c.expires_at>p_at and c.revoked_at is null
      and (p_id is null or s.id=p_id) and (p_class_id is null or s.class_id=p_class_id)
      and (coalesce(p_q,'')='' or strpos(lower(s.title),lower(p_q))>0)
  ), live as (select * from scope where event->>'mode'='live'), times as (
    select event->>'workTimeSource' as source,count(*) as n,sum((event->>'baselineSeconds')::bigint) as baseline,
      sum((event->>'workSeconds')::bigint) as work from live where event ? 'baselineSeconds' group by event->>'workTimeSource'
  ), checks as (
    -- Equal version labels from unrelated tools are not comparable criteria.
    select submission_id,event->>'checkMethod' as method,event->>'criteriaVersion' as version,count(*) as n,
      sum((event->>'checkedItems')::bigint) as checked,sum((event->>'correctItems')::bigint) as correct
    from live where event ? 'checkedItems' group by submission_id,event->>'checkMethod',event->>'criteriaVersion'
  )
  select jsonb_build_object('liveCount',count(*),'testCount',(select count(*) from scope where event->>'mode'='test'),
    'completed',count(*) filter(where event->>'outcome'='completed'),'failed',count(*) filter(where event->>'outcome'='failed'),
    'reviewed',count(*) filter(where event->>'review'<>'not_reviewed'),'accepted',count(*) filter(where event->>'review'='accepted'),
    'corrected',count(*) filter(where event->>'review'='corrected'),'rejected',count(*) filter(where event->>'review'='rejected'),
    'averageDurationMs',avg((event->>'durationMs')::numeric),
    'timeComparisons',coalesce((select jsonb_agg(jsonb_build_object('source',source,'count',n,'baselineSeconds',baseline,'workSeconds',work,'savedSeconds',baseline-work) order by source) from times),'[]'::jsonb),
    'checks',coalesce((select jsonb_agg(jsonb_build_object('submissionId',submission_id,'method',method,'criteriaVersion',version,'runs',n,'checkedItems',checked,'correctItems',correct) order by submission_id,method,version) from checks),'[]'::jsonb)
  ) from live;
$$;

create or replace function public.project_instruction_usage_detail(p_id uuid,p_receipt_hash text,p_admin boolean,p_at timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare parent public.project_instruction_submissions%rowtype; link jsonb; events jsonb;
begin
  select * into parent from public.project_instruction_submissions where id=p_id and expires_at>p_at and (p_admin is true or receipt_token_hash=p_receipt_hash);
  if not found then return null; end if;
  select jsonb_build_object('submissionId',submission_id,'consentAt',consent_at,'expiresAt',expires_at,'revokedAt',revoked_at,'generation',generation)
    into link from public.project_instruction_usage_connections where submission_id=p_id and expires_at>p_at;
  select coalesce(jsonb_agg(event||jsonb_build_object('receivedAt',received_at) order by received_at desc,event_id desc),'[]'::jsonb) into events
    from (select e.event,e.received_at,e.event_id from public.project_instruction_usage_events e
      join public.project_instruction_usage_connections c on c.submission_id=e.submission_id
      where e.submission_id=p_id and c.revoked_at is null and c.expires_at>p_at order by e.received_at desc,e.event_id desc limit 30) recent;
  return jsonb_build_object('connection',link,'stats',public.project_instruction_usage_stats(null,'',p_id,p_at),'events',events);
end;
$$;

create or replace function public.project_instruction_usage_summary(p_class_id uuid,p_q text,p_at timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with scope as (select c.submission_id,c.revoked_at from public.project_instruction_usage_connections c
    join public.project_instruction_submissions s on s.id=c.submission_id where s.expires_at>p_at and c.expires_at>p_at
      and (p_class_id is null or s.class_id=p_class_id) and (coalesce(p_q,'')='' or strpos(lower(s.title),lower(p_q))>0))
  select jsonb_build_object('connections',count(*),'activeConnections',count(*) filter(where revoked_at is null),
    'liveConnections',count(*) filter(where revoked_at is null and exists(select 1 from public.project_instruction_usage_events e where e.submission_id=scope.submission_id and e.event->>'mode'='live')),
    'stats',public.project_instruction_usage_stats(p_class_id,p_q,null,p_at)) from scope;
$$;

revoke all on function public.project_instruction_usage_valid_event(jsonb) from public,anon,authenticated;
revoke all on function public.project_instruction_usage_manage(text,uuid,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.project_instruction_usage_ingest(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.project_instruction_usage_stats(uuid,text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.project_instruction_usage_detail(uuid,text,boolean,timestamptz) from public,anon,authenticated;
revoke all on function public.project_instruction_usage_summary(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.project_instruction_usage_valid_event(jsonb) to service_role;
grant execute on function public.project_instruction_usage_manage(text,uuid,text,text,integer,text) to service_role;
grant execute on function public.project_instruction_usage_ingest(uuid,text,jsonb) to service_role;
grant execute on function public.project_instruction_usage_stats(uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.project_instruction_usage_detail(uuid,text,boolean,timestamptz) to service_role;
grant execute on function public.project_instruction_usage_summary(uuid,text,timestamptz) to service_role;
comment on table public.project_instruction_usage_connections is 'Private owner-only opt-in. Parent fixed expiry; permanent revoke marker prevents replay re-enrolment. Stores write token hash only.';
comment on table public.project_instruction_usage_events is 'Allowlisted numeric/enumerated usage only. Test data excluded from live metrics; no document/person/error strings. Final immutable event per tool execution.';
commit;
