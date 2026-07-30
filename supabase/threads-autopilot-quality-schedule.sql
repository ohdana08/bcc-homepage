-- 2026-07-30 Threads 품질 게이트와 확정 시간표 운영 마이그레이션
-- 예약글 정리는 운영 확인 뒤 별도로 하며, 이 파일은 스키마와 설정만 안전하게 갱신한다.

alter table public.threads_autopilot_posts
  drop constraint if exists threads_autopilot_posts_status_check;

alter table public.threads_autopilot_posts
  add constraint threads_autopilot_posts_status_check
  check (status in ('queued', 'published', 'failed', 'skipped'));

alter table public.threads_autopilot_config
  alter column publish_times
  set default '["08:10","10:30","12:20","18:10","21:20"]'::jsonb;

update public.threads_autopilot_config
set publish_times = case id
      when 'default' then '["08:10","10:30","12:20","18:10","21:20"]'::jsonb
      when 'jiwonfit' then '["08:30","10:50","12:40","15:30","18:30"]'::jsonb
      else publish_times
    end,
    updated_at = now()
where id in ('default', 'jiwonfit');
