-- Additive desk overlay. Original inquiries, proposals, lecture materials and finance are untouched.
create table public.lecture_desk_state (
 case_id uuid primary key references public.proposal_cases(id) on delete restrict,
 revision integer not null default 0 check(revision>=0),
 stage text not null default 'inquiry' check(stage in ('inquiry','proposal_ready','waiting','confirmed','preparing','on_site','completed','closed','on_hold')),
 fields jsonb not null default '{}' check(jsonb_typeof(fields)='object'),
 prepared jsonb not null default '{}' check(jsonb_typeof(prepared)='object'),
 prepared_stale boolean not null default false,
 proposal_pending boolean not null default false,
 followup_on date,
 followup_suggested boolean not null default false,
 actual_lecture_date date,
 milestones jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
create table public.lecture_desk_events (
 event_id uuid primary key, case_id uuid not null references public.proposal_cases(id) on delete restrict,
 revision integer not null, actor_id uuid not null references auth.users(id),
 payload jsonb not null, fingerprint text not null, created_at timestamptz not null default now(),
 unique(case_id,revision)
);
create table public.lecture_desk_settings (
 id boolean primary key default true check(id), settings jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.lecture_desk_state enable row level security;
alter table public.lecture_desk_events enable row level security;
alter table public.lecture_desk_settings enable row level security;
revoke all on public.lecture_desk_state,public.lecture_desk_events,public.lecture_desk_settings from public,anon,authenticated;
grant select,insert,update on public.lecture_desk_state,public.lecture_desk_settings to service_role;
grant select,insert on public.lecture_desk_events to service_role;
create index lecture_desk_events_case on public.lecture_desk_events(case_id,revision desc);
create index lecture_desk_followup on public.lecture_desk_state(followup_on) where followup_on is not null;

create function public.bcc_lecture_desk_apply(p_event jsonb,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 eid uuid; cid uuid; expected integer; kind text; day date; f jsonb; prep jsonb; oldevent lecture_desk_events;
 s lecture_desk_state; base proposal_cases; fingerprint text; k text; v jsonb; target text; oldrank integer; newrank integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and is_admin is true) then return jsonb_build_object('error','forbidden'); end if;
 if jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text)>240000 then return jsonb_build_object('error','invalid'); end if;
 for k in select jsonb_object_keys(p_event) loop
  if k not in ('event_id','case_id','expected_revision','kind','occurred_on','source_ref','raw_text','fields','prepared') then return jsonb_build_object('error','invalid'); end if;
 end loop;
 begin
  eid:=(p_event->>'event_id')::uuid; cid:=nullif(p_event->>'case_id','')::uuid; expected:=(p_event->>'expected_revision')::integer; kind:=p_event->>'kind';
  day:=(p_event->>'occurred_on')::date;
 exception when others then return jsonb_build_object('error','invalid'); end;
 if jsonb_typeof(p_event->'expected_revision') is distinct from 'number' or (p_event->>'expected_revision') !~ '^[0-9]+$' or jsonb_typeof(p_event->'source_ref') is distinct from 'string' or eid is null or expected is null or expected<0 or day is null or to_char(day,'YYYY-MM-DD') is distinct from p_event->>'occurred_on'
 or kind is null or kind not in ('inquiry','update','proposal_ready','proposal_sent','scheduled','plan_received','photos_received','recording_received','blog_written')
 or coalesce(length(trim(p_event->>'source_ref')),0)=0 or length(p_event->>'source_ref')>1000
 or jsonb_typeof(p_event->'raw_text') is distinct from 'string' or length(p_event->>'raw_text')>60000 then return jsonb_build_object('error','invalid'); end if;
 f:=p_event->'fields'; prep:=p_event->'prepared';
 if jsonb_typeof(f) is distinct from 'object' then return jsonb_build_object('error','invalid'); end if;
 for k,v in select * from jsonb_each(f) loop
  if k not in ('institution_name','project_name','topic','audience','region','delivery_format','duration_hours','lecture_date','followup_on','contact_name','contact_email','contact_phone','next_action') then return jsonb_build_object('error','invalid'); end if;
  if v='null'::jsonb then continue; end if;
  if k='duration_hours' then
   if jsonb_typeof(v)<>'number' or (v::text)::numeric<0 or (v::text)::numeric>1000 then return jsonb_build_object('error','invalid'); end if;
  elsif jsonb_typeof(v)<>'string' or length(f->>k)>4000 then return jsonb_build_object('error','invalid');
  elsif k in ('lecture_date','followup_on') and f->>k<>'' then
   begin if to_char((f->>k)::date,'YYYY-MM-DD')<>f->>k then return jsonb_build_object('error','invalid'); end if;
   exception when others then return jsonb_build_object('error','invalid'); end;
  end if;
 end loop;
 if prep is not null then
  if jsonb_typeof(prep) is distinct from 'object' or octet_length(prep::text)>150000 then return jsonb_build_object('error','invalid'); end if;
  for k,v in select * from jsonb_each(prep) loop
   if k not in ('summary','questions','recommendation','email_subject','email_body','proposal_text','materials','next_action') then return jsonb_build_object('error','invalid'); end if;
   if k in ('questions','materials') then
    if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>100 then return jsonb_build_object('error','invalid'); end if;
   elsif jsonb_typeof(v)<>'string' or length(prep->>k)>30000 then return jsonb_build_object('error','invalid'); end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(prep->'questions','[]')) x where jsonb_typeof(x)<>'string' or length(x::text)>2002) then return jsonb_build_object('error','invalid'); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(prep->'materials','[]')) x where jsonb_typeof(x)<>'object') then return jsonb_build_object('error','invalid'); end if;
  for v in select * from jsonb_array_elements(coalesce(prep->'materials','[]')) loop
   if exists(select 1 from jsonb_each(v) z where z.key not in ('title','url','source') or jsonb_typeof(z.value)<>'string' or length(z.value::text)>2002) or (coalesce(v->>'url','')<>'' and v->>'url' !~ '^https://') then return jsonb_build_object('error','invalid'); end if;
  end loop;
 end if;
 if kind='proposal_ready' and (prep is null or coalesce(length(trim(prep->>'email_body')),0)+coalesce(length(trim(prep->>'proposal_text')),0)+coalesce(length(trim(prep->>'recommendation')),0)=0) then return jsonb_build_object('error','invalid'); end if;
 -- Serialize same event and case: retries cannot create duplicate cases, two writers cannot lose updates.
 perform pg_advisory_xact_lock(hashtextextended(eid::text,7118));
 fingerprint:=md5(p_event::text);
 select * into oldevent from public.lecture_desk_events where event_id=eid;
 if found then
  if oldevent.fingerprint<>fingerprint or oldevent.actor_id<>p_actor then return jsonb_build_object('error','conflict'); end if;
  select * into s from public.lecture_desk_state where case_id=oldevent.case_id;
  return jsonb_build_object('case_id',s.case_id,'revision',s.revision,'state',to_jsonb(s),'replayed',true);
 end if;
 if cid is null then
  if kind<>'inquiry' or expected<>0 or coalesce(length(trim(f->>'institution_name')),0)=0 or coalesce(length(trim(p_event->>'raw_text')),0)=0 then return jsonb_build_object('error','invalid'); end if;
  insert into public.proposal_cases(owner_id,institution_name,inquiry_text,inquiry_date,source)
   values(p_actor,f->>'institution_name',p_event->>'raw_text',day,'codex:'||eid::text) returning * into base;
  cid:=base.id;
 else
  select * into base from public.proposal_cases where id=cid for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
 end if;
 select * into s from public.lecture_desk_state where case_id=cid for update;
 if found then
  if s.revision<>expected then return jsonb_build_object('error','conflict'); end if;
 else
  if expected<>0 then return jsonb_build_object('error','conflict'); end if;
  insert into public.lecture_desk_state(case_id,stage,followup_on)
  values(cid,case
   when exists(select 1 from public.lecture_operations o where o.case_id=cid and o.checklist->>'completed'='true') then 'completed'
   when base.status='lost' then 'closed' when base.status='on_hold' then 'on_hold' when base.status='won' then 'confirmed'
   when base.status in ('sent','waiting') then 'waiting' when base.status in ('drafted','reviewing') then 'proposal_ready' else 'inquiry' end,
   (base.next_action_at at time zone 'Asia/Seoul')::date) returning * into s;
 end if;
 s.fields:=s.fields||f;
 if (f<>'{}' or (kind in ('inquiry','update') and length(p_event->>'raw_text')>0)) and s.prepared<>'{}' then s.prepared_stale:=true; end if;
 if prep is not null then s.prepared:=prep; s.prepared_stale:=false; end if;
 if kind='proposal_ready' then s.proposal_pending:=true; elsif kind in ('proposal_sent','photos_received','recording_received','blog_written') then s.proposal_pending:=false; end if;
 target:=case kind when 'proposal_ready' then 'proposal_ready' when 'proposal_sent' then 'waiting' when 'scheduled' then 'confirmed' when 'plan_received' then 'preparing' when 'photos_received' then 'on_site' when 'recording_received' then 'completed' when 'blog_written' then 'completed' else s.stage end;
 oldrank:=array_position(array['inquiry','proposal_ready','waiting','confirmed','preparing','on_site','completed'],s.stage);
 newrank:=array_position(array['inquiry','proposal_ready','waiting','confirmed','preparing','on_site','completed'],target);
 if newrank>=oldrank or (oldrank is null and kind not in ('inquiry','update')) then s.stage:=target; end if;
 if kind not in ('inquiry','update','proposal_ready') then s.milestones:=s.milestones||jsonb_build_object(kind,day); end if;
 if kind='proposal_sent' and s.stage='waiting' then s.followup_on:=day+3; s.followup_suggested:=true; end if;
 -- Drop only an automatic proposal reminder once the lecture moves ahead.
 -- Explicit preparation/post-lecture dates remain meaningful in every phase.
 if s.stage in ('confirmed','preparing','on_site','completed') and s.followup_suggested then s.followup_on:=null; s.followup_suggested:=false; end if;
 if f?'followup_on' then s.followup_on:=nullif(f->>'followup_on','')::date; s.followup_suggested:=false; end if;
 -- Blog writing day is actual lecture day in the user's same-day workflow, not publication day.
 if kind='blog_written' then s.actual_lecture_date:=day;
 elsif kind in ('photos_received','recording_received') and not(s.milestones?'blog_written') then s.actual_lecture_date:=day; end if;
 s.revision:=s.revision+1; s.updated_at:=now();
 update public.lecture_desk_state set revision=s.revision,stage=s.stage,fields=s.fields,prepared=s.prepared,prepared_stale=s.prepared_stale,proposal_pending=s.proposal_pending,followup_on=s.followup_on,followup_suggested=s.followup_suggested,actual_lecture_date=s.actual_lecture_date,milestones=s.milestones,updated_at=s.updated_at where case_id=cid;
 insert into public.lecture_desk_events(event_id,case_id,revision,actor_id,payload,fingerprint) values(eid,cid,s.revision,p_actor,p_event,fingerprint);
 return jsonb_build_object('case_id',cid,'revision',s.revision,'state',to_jsonb(s),'replayed',false);
end $$;
revoke all on function public.bcc_lecture_desk_apply(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.bcc_lecture_desk_apply(jsonb,uuid) to service_role;

create table public.lecture_desk_files (
 id uuid primary key, case_id uuid not null references public.proposal_cases(id) on delete restrict,
 original_name text not null check(length(original_name) between 1 and 180), mime_type text not null,
 byte_size integer not null check(byte_size between 1 and 2097152), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 object_path text not null unique, status text not null default 'pending' check(status in ('pending','ready')),
 created_at timestamptz not null default now(),check(object_path=case_id::text||'/'||id::text)
);
alter table public.lecture_desk_files enable row level security;
revoke all on public.lecture_desk_files from public,anon,authenticated;
grant select,insert,update on public.lecture_desk_files to service_role;
create index lecture_desk_files_case on public.lecture_desk_files(case_id,created_at desc);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lecture-desk-files','lecture-desk-files',false,2097152,array['application/pdf','application/x-hwp','application/vnd.hancom.hwpx','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/wav','text/plain','text/markdown']);
