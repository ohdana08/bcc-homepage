-- default Threads campaign: eight unattended publishing slots per day.
alter table public.threads_autopilot_posts
  drop constraint if exists threads_autopilot_posts_slot_index_check;

alter table public.threads_autopilot_posts
  add constraint threads_autopilot_posts_slot_index_check
  check (slot_index between 0 and 7);

update public.threads_autopilot_config
set publish_times = '["08:40","09:10","11:50","12:20","18:00","18:30","20:30","21:00"]'::jsonb,
    updated_at = now()
where id = 'default';
