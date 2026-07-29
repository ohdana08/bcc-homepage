-- Threads 멀티 캠페인 전환: 날짜 슬롯과 순번은 캠페인 안에서만 고유하다.
-- 기존 단일 캠페인 데이터는 default 캠페인에 그대로 연결한다.

begin;

alter table public.threads_autopilot_posts
  add column if not exists campaign_id text not null default 'default';

alter table public.threads_autopilot_posts
  drop constraint if exists threads_autopilot_posts_schedule_date_slot_index_key;

alter table public.threads_autopilot_posts
  drop constraint if exists threads_autopilot_posts_sequence_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'threads_autopilot_posts_campaign_id_fkey'
      and conrelid = 'public.threads_autopilot_posts'::regclass
  ) then
    alter table public.threads_autopilot_posts
      add constraint threads_autopilot_posts_campaign_id_fkey
      foreign key (campaign_id)
      references public.threads_autopilot_config(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'threads_autopilot_posts_campaign_schedule_slot_key'
      and conrelid = 'public.threads_autopilot_posts'::regclass
  ) then
    alter table public.threads_autopilot_posts
      add constraint threads_autopilot_posts_campaign_schedule_slot_key
      unique (campaign_id, schedule_date, slot_index);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'threads_autopilot_posts_campaign_sequence_key'
      and conrelid = 'public.threads_autopilot_posts'::regclass
  ) then
    alter table public.threads_autopilot_posts
      add constraint threads_autopilot_posts_campaign_sequence_key
      unique (campaign_id, sequence);
  end if;
end
$$;

commit;
