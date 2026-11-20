-- Additive upgrade: preserves all existing surveys, public links and responses.
-- Optional portfolio files stay private, separate from answers and aggregation queries.
create table if not exists public.training_need_attachments (
  response_id bigint primary key references public.training_need_responses(id) on delete cascade,
  survey_id uuid not null references public.training_need_surveys(id) on delete cascade,
  name text not null check (length(name) between 1 and 110),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','application/pdf')),
  size integer not null check (size between 1 and 1048576),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data_base64 text not null check (length(data_base64) <= 1398104),
  created_at timestamptz not null default now()
);
create index if not exists training_need_attachments_survey_idx on public.training_need_attachments(survey_id);
alter table public.training_need_attachments enable row level security;
revoke all on public.training_need_attachments from anon, authenticated;
grant all on public.training_need_attachments to service_role;

create or replace function public.submit_ai_experience_card(
  p_survey_id uuid, p_key uuid, p_answers jsonb, p_attachment jsonb default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_survey public.training_need_surveys%rowtype;
  v_existing public.training_need_responses%rowtype;
  v_id bigint;
  v_cap integer;
begin
  -- Serialize per survey so caps, closure and retries have a deterministic boundary.
  select * into v_survey from public.training_need_surveys where id = p_survey_id for update;
  if not found then raise exception 'SURVEY_NOT_FOUND'; end if;
  select * into v_existing from public.training_need_responses where survey_id = p_survey_id and idempotency_key = p_key;
  if found then
    if v_existing.answers is distinct from p_answers then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'response_id',v_existing.id::text,'answers',v_existing.answers);
  end if;
  if v_survey.status <> 'open' or (v_survey.response_deadline is not null and v_survey.response_deadline < (now() at time zone 'Asia/Seoul')::date) then raise exception 'SURVEY_CLOSED'; end if;
  if p_answers->>'schema_version' is distinct from 'ai_experience_v2' then raise exception 'INVALID_SCHEMA'; end if;
  v_cap := case when v_survey.expected_response_count is null then 500 else greatest(50,least(2000,v_survey.expected_response_count*4)) end;
  if (select count(*) from public.training_need_responses where survey_id = p_survey_id) >= v_cap then raise exception 'RESPONSE_CAP'; end if;
  insert into public.training_need_responses(survey_id,idempotency_key,answers) values(p_survey_id,p_key,p_answers) returning id into v_id;
  if p_attachment is not null then
    insert into public.training_need_attachments(response_id,survey_id,name,mime_type,size,sha256,data_base64)
    values(v_id,p_survey_id,p_attachment->>'name',p_attachment->>'mime_type',(p_attachment->>'size')::integer,p_attachment->>'sha256',p_attachment->>'data_base64');
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'response_id',v_id::text,'answers',p_answers);
end;
$$;
revoke all on function public.submit_ai_experience_card(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.submit_ai_experience_card(uuid,uuid,jsonb,jsonb) to service_role;
