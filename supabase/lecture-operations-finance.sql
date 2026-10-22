-- Personal finance project only. Reuses lectures; never copies revenue into the business DB.
begin;
create table public.lecture_finance_links (
  owner_id uuid not null,
  case_id uuid not null,
  lecture_id uuid not null unique references public.lectures(id) on delete restrict,
  revision integer not null default 1 check(revision>0),
  contract_amount integer not null check(contract_amount>=0),
  deduction_amount integer not null default 0 check(deduction_amount>=0 and deduction_amount<=contract_amount),
  opening_received integer not null check(opening_received>=0),
  received_amount integer not null check(received_amount>=0),
  due_date date,
  invoice_status text not null check(invoice_status in ('not_issued','issued')),
  invoice_number text not null default '' check(length(invoice_number)<=100),
  notes text not null default '' check(length(notes)<=2000),
  original_ledger jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,case_id)
);
create table public.lecture_finance_payments (
  id uuid primary key,
  owner_id uuid not null,
  case_id uuid not null,
  kind text not null check(kind in ('receipt','refund')),
  amount integer not null check(amount>0),
  date date not null,
  note text not null default '' check(length(note)<=1000),
  voided_at timestamptz,
  void_reason text check(length(void_reason) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key(owner_id,case_id) references public.lecture_finance_links(owner_id,case_id) on delete restrict,
  check((voided_at is null)=(void_reason is null))
);
create index lecture_finance_payments_case on public.lecture_finance_payments(owner_id,case_id,created_at);
create table public.lecture_finance_mutations (
  owner_id uuid not null,
  id uuid not null,
  case_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,id),
  foreign key(owner_id,case_id) references public.lecture_finance_links(owner_id,case_id) on delete restrict
);
alter table public.lecture_finance_links enable row level security;
alter table public.lecture_finance_payments enable row level security;
alter table public.lecture_finance_mutations enable row level security;
revoke all on public.lecture_finance_links,public.lecture_finance_payments,public.lecture_finance_mutations from public,anon,authenticated;
grant select on public.lecture_finance_links,public.lecture_finance_payments to authenticated;
create policy lecture_finance_links_owner_read on public.lecture_finance_links for select to authenticated
  using((select public.is_finance_owner()) and owner_id=(select auth.uid()));
create policy lecture_finance_payments_owner_read on public.lecture_finance_payments for select to authenticated
  using((select public.is_finance_owner()) and owner_id=(select auth.uid()));

-- A linked lecture's totals can only be changed by the journal RPC. Legacy screens
-- still manage all unlinked rows. A denied edit is explicit, never silently ignored.
create function public.lecture_finance_guard_legacy() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from lecture_finance_links where lecture_id=old.id) then
    if tg_op='DELETE' then raise exception using errcode='23503',message='Linked lecture: manage settlement in lecture operations'; end if;
    if (new.user_id,new.id,new.fee,new.promised_fee,new.actual_fee,new.is_paid,new.paid_at)
      is distinct from (old.user_id,old.id,old.fee,old.promised_fee,old.actual_fee,old.is_paid,old.paid_at)
      and current_setting('bcc.lecture_finance_sync',true) is distinct from 'on'
      then raise exception using errcode='23514',message='Linked lecture: manage settlement in lecture operations'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.lecture_finance_guard_legacy() from public,anon,authenticated;
create trigger lecture_finance_guard_legacy before update or delete on public.lectures
  for each row execute function public.lecture_finance_guard_legacy();

create function public.lecture_finance_mutate(p_case_id uuid,p_action text,p_revision integer,p_mutation uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); prior lecture_finance_mutations; link lecture_finance_links; ledger lectures;
  settings jsonb; payment jsonb; existing_payment lecture_finance_payments; snapshot jsonb; result jsonb;
  opening integer; contract integer; deduction integer; due date; received bigint; delta bigint:=0; all_payments jsonb;
  identity_payload jsonb:=jsonb_build_object('revision',p_revision,'data',p_payload);
  previous_sync text:=current_setting('bcc.lecture_finance_sync',true);
begin
  if uid is null or public.is_finance_owner() is distinct from true then return jsonb_build_object('error','forbidden'); end if;
  if p_case_id is null or p_mutation is null or p_revision is null or p_revision<0 or p_action not in ('link','settings','payment','void') or p_action is null
    or jsonb_typeof(p_payload) is distinct from 'object' then return jsonb_build_object('error','invalid'); end if;
  -- Serializes first link, updates and same-case retries without cross-DB writes.
  perform pg_advisory_xact_lock(hashtextextended('bcc:finance:'||uid::text||':'||p_case_id::text,0));
  select * into prior from lecture_finance_mutations where owner_id=uid and id=p_mutation;
  if found then
    if prior.case_id<>p_case_id or prior.action<>p_action or prior.payload<>identity_payload then return jsonb_build_object('error','conflict'); end if;
    return prior.result||jsonb_build_object('duplicate',true);
  end if;
  select * into link from lecture_finance_links where owner_id=uid and case_id=p_case_id for update;
  if p_action='link' then
    if found or p_revision<>0 then return jsonb_build_object('error','conflict'); end if;
  elsif not found then return jsonb_build_object('error','not_found');
  elsif link.revision<>p_revision then return jsonb_build_object('error','conflict'); end if;

  if p_action in ('link','settings') then
    settings:=p_payload->'settings';
    if jsonb_typeof(settings) is distinct from 'object' or (settings-array['contract_amount','deduction_amount','due_date','invoice_status','invoice_number','notes'])<>'{}'::jsonb
      or jsonb_typeof(settings->'contract_amount') is distinct from 'number' or jsonb_typeof(settings->'deduction_amount') is distinct from 'number'
      or (settings->>'contract_amount') !~ '^\d+$' or (settings->>'deduction_amount') !~ '^\d+$'
      or settings->>'invoice_status' is null or settings->>'invoice_status' not in ('not_issued','issued')
      or jsonb_typeof(settings->'invoice_number') is distinct from 'string' or length(settings->>'invoice_number')>100
      or jsonb_typeof(settings->'notes') is distinct from 'string' or length(settings->>'notes')>2000
      then return jsonb_build_object('error','invalid'); end if;
    contract:=(settings->>'contract_amount')::integer;
    deduction:=(settings->>'deduction_amount')::integer;
    if contract<0 or deduction<0 or deduction>contract then return jsonb_build_object('error','invalid'); end if;
    if settings->>'due_date' is not null and (settings->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('error','invalid'); end if;
    due:=(settings->>'due_date')::date;
  end if;

  if p_action='link' then
    if (p_payload-array['settings','opening_received','lecture_id','expected_lecture','create'])<>'{}'::jsonb
      or jsonb_typeof(p_payload->'opening_received') is distinct from 'number' or p_payload->>'opening_received' !~ '^\d+$'
      or ((p_payload->>'lecture_id' is null)=(p_payload->'create' is null)) then return jsonb_build_object('error','invalid'); end if;
    opening:=(p_payload->>'opening_received')::integer;
    if opening<0 then return jsonb_build_object('error','invalid'); end if;
    if p_payload->>'lecture_id' is not null then
      select * into ledger from lectures where id=(p_payload->>'lecture_id')::uuid and user_id=uid for update;
      if not found then return jsonb_build_object('error','not_found'); end if;
      if exists(select 1 from lecture_finance_links where lecture_id=ledger.id) then return jsonb_build_object('error','already_linked'); end if;
      snapshot:=jsonb_build_object('id',ledger.id,'date',ledger.date,'organization',ledger.organization,'topic',ledger.topic,'fee',ledger.fee,'promised_fee',ledger.promised_fee,'actual_fee',ledger.actual_fee,'is_paid',ledger.is_paid);
      if ((p_payload->'expected_lecture') - 'paid_at') is distinct from snapshot
        or (p_payload#>>'{expected_lecture,paid_at}')::timestamptz is distinct from ledger.paid_at then return jsonb_build_object('error','ledger_changed'); end if;
    else
      if jsonb_typeof(p_payload->'create') is distinct from 'object' or ((p_payload->'create')-array['date','organization','topic'])<>'{}'::jsonb
        or coalesce(p_payload#>>'{create,date}','') !~ '^\d{4}-\d{2}-\d{2}$'
        or coalesce(length(trim(p_payload#>>'{create,organization}')),0) not between 1 and 200
        or coalesce(length(p_payload#>>'{create,topic}'),0)>300 then return jsonb_build_object('error','invalid'); end if;
      insert into lectures(user_id,date,organization,topic,fee,promised_fee,actual_fee,is_paid)
        values(uid,(p_payload#>>'{create,date}')::date,p_payload#>>'{create,organization}',nullif(p_payload#>>'{create,topic}',''),contract,contract,opening,opening>=contract-deduction)
        returning * into ledger;
    end if;
    insert into lecture_finance_links(owner_id,case_id,lecture_id,contract_amount,deduction_amount,opening_received,received_amount,due_date,invoice_status,invoice_number,notes,original_ledger)
      values(uid,p_case_id,ledger.id,contract,deduction,opening,opening,due,settings->>'invoice_status',settings->>'invoice_number',settings->>'notes',to_jsonb(ledger)) returning * into link;
  else
    select * into ledger from lectures where id=link.lecture_id and user_id=uid for update;
    if not found then return jsonb_build_object('error','not_found'); end if;
    if ledger.actual_fee is distinct from link.received_amount or ledger.promised_fee is distinct from link.contract_amount
      or ledger.fee is distinct from link.contract_amount or ledger.is_paid is distinct from (link.received_amount>=link.contract_amount-link.deduction_amount)
      then return jsonb_build_object('error','ledger_changed'); end if;
    if p_action='settings' then
      if (p_payload-'settings')<>'{}'::jsonb then return jsonb_build_object('error','invalid'); end if;
      update lecture_finance_links set contract_amount=contract,deduction_amount=deduction,due_date=due,invoice_status=settings->>'invoice_status',invoice_number=settings->>'invoice_number',notes=settings->>'notes'
        where owner_id=uid and case_id=p_case_id returning * into link;
    elsif p_action='payment' then
      payment:=p_payload->'payment';
      if (p_payload-'payment')<>'{}'::jsonb or jsonb_typeof(payment) is distinct from 'object'
        or (payment-array['id','kind','amount','date','note'])<>'{}'::jsonb
        or payment->>'id' is null or payment->>'kind' is null or payment->>'kind' not in ('receipt','refund')
        or jsonb_typeof(payment->'amount') is distinct from 'number' or payment->>'amount' !~ '^\d+$'
        or coalesce(payment->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
        or jsonb_typeof(payment->'note') is distinct from 'string' or length(payment->>'note')>1000
        then return jsonb_build_object('error','invalid'); end if;
      if (payment->>'amount')::integer<=0 then return jsonb_build_object('error','invalid'); end if;
      if (select count(*) from lecture_finance_payments where owner_id=uid and case_id=p_case_id)>=500 then return jsonb_build_object('error','limit'); end if;
      delta:=(payment->>'amount')::bigint * case when payment->>'kind'='receipt' then 1 else -1 end;
      if link.received_amount::bigint+delta<0 then return jsonb_build_object('error','negative_received'); end if;
      if link.received_amount::bigint+delta>2147483647 then return jsonb_build_object('error','limit'); end if;
      insert into lecture_finance_payments(id,owner_id,case_id,kind,amount,date,note)
        values((payment->>'id')::uuid,uid,p_case_id,payment->>'kind',(payment->>'amount')::integer,(payment->>'date')::date,payment->>'note');
    elsif p_action='void' then
      if (p_payload-array['payment_id','reason'])<>'{}'::jsonb or p_payload->>'payment_id' is null
        or jsonb_typeof(p_payload->'reason') is distinct from 'string' or coalesce(length(trim(p_payload->>'reason')),0) not between 1 and 500 then return jsonb_build_object('error','invalid'); end if;
      select * into existing_payment from lecture_finance_payments where owner_id=uid and case_id=p_case_id and id=(p_payload->>'payment_id')::uuid for update;
      if not found then return jsonb_build_object('error','not_found'); end if;
      if existing_payment.voided_at is not null then return jsonb_build_object('error','conflict'); end if;
      delta:=existing_payment.amount::bigint * case when existing_payment.kind='receipt' then -1 else 1 end;
      if link.received_amount::bigint+delta<0 then return jsonb_build_object('error','negative_received'); end if;
      if link.received_amount::bigint+delta>2147483647 then return jsonb_build_object('error','limit'); end if;
      update lecture_finance_payments set voided_at=clock_timestamp(),void_reason=trim(p_payload->>'reason') where id=existing_payment.id;
    end if;
    update lecture_finance_links set revision=revision+1,updated_at=clock_timestamp() where owner_id=uid and case_id=p_case_id returning * into link;
  end if;
  select link.opening_received::bigint + coalesce(sum(case when kind='receipt' then amount::bigint else -amount::bigint end) filter(where voided_at is null),0)
    into received from lecture_finance_payments where owner_id=uid and case_id=p_case_id;
  if received<0 or received>2147483647 then raise exception using errcode='P0001',message='invalid'; end if;
  update lecture_finance_links set received_amount=received::integer where owner_id=uid and case_id=p_case_id returning * into link;
  perform set_config('bcc.lecture_finance_sync','on',true);
  update lectures set fee=link.contract_amount,promised_fee=link.contract_amount,actual_fee=link.received_amount,
    is_paid=link.received_amount>=link.contract_amount-link.deduction_amount,
    paid_at=case when link.received_amount>=link.contract_amount-link.deduction_amount then coalesce(paid_at,clock_timestamp()) else null end
    where id=link.lecture_id and user_id=uid;
  perform set_config('bcc.lecture_finance_sync',coalesce(previous_sync,''),true);
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at,p.id),'[]'::jsonb) into all_payments from lecture_finance_payments p where owner_id=uid and case_id=p_case_id;
  result:=jsonb_build_object('settlement',to_jsonb(link),'payments',all_payments);
  insert into lecture_finance_mutations(owner_id,id,case_id,action,payload,result) values(uid,p_mutation,p_case_id,p_action,identity_payload,result);
  return result;
exception when unique_violation then return jsonb_build_object('error','conflict');
  when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or check_violation then return jsonb_build_object('error','invalid');
  when raise_exception then return jsonb_build_object('error','invalid');
end $$;
revoke all on function public.lecture_finance_mutate(uuid,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.lecture_finance_mutate(uuid,text,integer,uuid,jsonb) to authenticated;
commit;
