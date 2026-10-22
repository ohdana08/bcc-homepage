-- Additive, private file storage for the existing lecture request workflow.
begin;
create table public.lecture_request_attachments (
  id uuid primary key,
  receipt uuid not null references public.lecture_requests(receipt) on delete restrict,
  original_name text not null check (length(original_name) between 1 and 180),
  mime_type text not null,
  byte_size integer not null check (byte_size between 1 and 2097152),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  object_path text not null unique,
  status text not null default 'pending' check (status in ('pending','ready')),
  consent_version text not null default '2026-10-22-attachment-v1',
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  check (object_path=receipt::text||'/'||id::text)
);
create index lecture_request_attachments_receipt on public.lecture_request_attachments(receipt);
alter table public.lecture_request_attachments enable row level security;
revoke all on public.lecture_request_attachments from public,anon,authenticated;
grant all on public.lecture_request_attachments to service_role;

-- No public/anon/authenticated object policy is added. Files are served by the
-- authenticated application handler, after verifying a request key or admin.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('lecture-request-forms','lecture-request-forms',false,2097152,
  array['application/pdf','application/x-hwp','application/vnd.hancom.hwpx',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png','image/jpeg']);

create function public.lecture_request_attachment_reserve(
  p_receipt uuid,p_key_hash text,p_upload_id uuid,p_name text,p_mime text,p_size integer,p_sha256 text
) returns jsonb language plpgsql set search_path=public as $$
declare request_row lecture_requests; existing lecture_request_attachments; result lecture_request_attachments;
declare file_count integer; total_bytes bigint;
begin
  -- The same request row locks every upload, including pending reservations.
  select * into request_row from lecture_requests where receipt=p_receipt for update;
  if not found or request_row.key_hash is distinct from p_key_hash or request_row.editable_until<=now() then
    return jsonb_build_object('error','not_found');
  end if;
  if p_upload_id is null or p_name is null or length(p_name) not between 1 and 180
    or p_name ~ '[[:cntrl:]/\\]' or p_size is null or p_size not between 1 and 2097152
    or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_mime is null or p_mime not in ('application/pdf','application/x-hwp','application/vnd.hancom.hwpx',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/png','image/jpeg') then
    return jsonb_build_object('error','invalid');
  end if;
  select * into existing from lecture_request_attachments where id=p_upload_id;
  if found then
    if existing.receipt<>p_receipt or existing.sha256<>p_sha256 or existing.byte_size<>p_size
      or existing.original_name<>p_name or existing.mime_type<>p_mime then
      return jsonb_build_object('error','conflict');
    end if;
    return jsonb_build_object('attachment',to_jsonb(existing));
  end if;
  select count(*),coalesce(sum(byte_size),0) into file_count,total_bytes from lecture_request_attachments where receipt=p_receipt;
  if file_count>=3 or total_bytes+p_size>6291456 then return jsonb_build_object('error','limit'); end if;
  insert into lecture_request_attachments(id,receipt,original_name,mime_type,byte_size,sha256,object_path)
    values(p_upload_id,p_receipt,p_name,p_mime,p_size,p_sha256,p_receipt::text||'/'||p_upload_id::text)
    returning * into result;
  return jsonb_build_object('attachment',to_jsonb(result));
end $$;

create function public.lecture_request_attachment_ready(p_receipt uuid,p_key_hash text,p_attachment_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare request_row lecture_requests; result lecture_request_attachments;
begin
  select * into request_row from lecture_requests where receipt=p_receipt for update;
  if not found or request_row.key_hash is distinct from p_key_hash or request_row.editable_until<=now() then
    return jsonb_build_object('error','not_found');
  end if;
  update lecture_request_attachments set status='ready',ready_at=coalesce(ready_at,now())
    where id=p_attachment_id and receipt=p_receipt returning * into result;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('attachment',to_jsonb(result));
end $$;
revoke all on function public.lecture_request_attachment_reserve(uuid,text,uuid,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.lecture_request_attachment_ready(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.lecture_request_attachment_reserve(uuid,text,uuid,text,text,integer,text) to service_role;
grant execute on function public.lecture_request_attachment_ready(uuid,text,uuid) to service_role;
commit;
