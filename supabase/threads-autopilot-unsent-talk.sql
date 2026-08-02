-- 안보낸톡 Threads 1주차: 사전 승인 텍스트 큐, 사진·자동 셀프댓글 없음, 짧은 자동답글 사용.
-- 안전 기본값은 enabled=false, status=draft다. 토큰 검증과 사람 승인 뒤에만 하단 활성화 SQL을 실행한다.

begin;

alter table public.threads_autopilot_config
  add column if not exists token_provider text,
  add column if not exists reply_system_prompt text,
  add column if not exists content_mode text not null default 'generated',
  add column if not exists auto_self_comments boolean not null default true,
  add column if not exists auto_replies boolean not null default true,
  add column if not exists auto_external_comments boolean not null default true,
  add column if not exists collect_metrics boolean not null default true;

alter table public.threads_autopilot_config
  drop constraint if exists threads_autopilot_config_content_mode_check;

alter table public.threads_autopilot_config
  add constraint threads_autopilot_config_content_mode_check
  check (content_mode in ('generated', 'approved_queue'));

alter table public.threads_autopilot_posts
  drop constraint if exists threads_autopilot_posts_status_check;

alter table public.threads_autopilot_posts
  add constraint threads_autopilot_posts_status_check
  check (status in ('draft', 'approved', 'queued', 'published', 'failed', 'skipped'));

insert into public.threads_autopilot_config (
  id,
  enabled,
  profile_username,
  timezone,
  publish_times,
  campaign_context,
  reply_system_prompt,
  start_date,
  next_sequence,
  token_provider,
  content_mode,
  auto_self_comments,
  auto_replies,
  auto_external_comments,
  collect_metrics,
  updated_at
)
values (
  'unsent_talk',
  false,
  'unsent_talk_7days_pause',
  'Asia/Seoul',
  '["22:00","00:00"]'::jsonb,
  '이별 후 연락 충동을 겪는 사람의 일상을 쓰는 공감 계정. 판매·제품·CTA·심리 분석·교훈 없이 혼잣말만 남긴다.',
  E'너는 @unsent_talk_7days_pause 계정의 댓글 답글 담당자다.\n상대의 의견이나 경험을 먼저 받아들이고, 한 문장 60자 이내의 짧은 한국어로 답한다.\n의견을 덧붙여 설득하지 말고, 지금은 수용하거나 말해줘서 고맙다고 답해도 된다.\n조언·판단·해결책·재회 전략·심리 분석·제품·링크·CTA를 쓰지 않는다.\n상대가 말하지 않은 경험이나 감정을 만들지 않는다.\nJSON 스키마 외의 말은 출력하지 않는다.',
  '2026-08-03',
  11,
  'threads_unsent',
  'approved_queue',
  false,
  true,
  false,
  true,
  now()
)
on conflict (id) do update
set profile_username = excluded.profile_username,
    timezone = excluded.timezone,
    publish_times = excluded.publish_times,
    campaign_context = excluded.campaign_context,
    reply_system_prompt = excluded.reply_system_prompt,
    start_date = excluded.start_date,
    next_sequence = greatest(public.threads_autopilot_config.next_sequence, excluded.next_sequence),
    token_provider = excluded.token_provider,
    content_mode = excluded.content_mode,
    auto_self_comments = excluded.auto_self_comments,
    auto_replies = excluded.auto_replies,
    auto_external_comments = excluded.auto_external_comments,
    collect_metrics = excluded.collect_metrics,
    updated_at = now();

insert into public.threads_autopilot_posts (
  campaign_id,
  sequence,
  schedule_date,
  slot_index,
  scheduled_at,
  content_type,
  text,
  self_comment_0,
  self_comment_6h,
  search_queries,
  status
)
values
  ('unsent_talk', 1, '2026-08-03', 0, '2026-08-03 22:00:00+09', 'daily', E'퇴근 버스에서 깜빡 잠들었다가\n정류장 두 개를 지나쳤다\n걸어오는 십오 분 동안\n전화 걸 뻔한 게 세 번이다', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 2, '2026-08-03', 1, '2026-08-04 00:00:00+09', 'midnight', E'프로필 사진만 보고 나왔다\n오늘은 이걸로 참은 걸로 치자', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 3, '2026-08-04', 0, '2026-08-04 22:00:00+09', 'daily', E'편의점에서 네가 좋아하던 젤리가 1+1이었다\n하나는 먹고\n하나는 그냥 가방에 있다\n누구 주려는 건지는 묻지 말자', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 4, '2026-08-04', 1, '2026-08-05 00:00:00+09', 'midnight', E'너한테 돌려줄 게 하나 남아 있다는 게 방금 생각났다\n정확히는, 계속 알고 있었다', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 5, '2026-08-05', 0, '2026-08-05 22:00:00+09', 'daily', E'카페에서 주문하다가 두 잔 시킬 뻔했다\n너는 여름에도 뜨거운 것만 마셨다\n사장님이 오늘은 한 잔이냐고 물어서\n네, 하고 웃었는데\n그 웃음이 잘 안 됐다\n자리에 앉으니까 사장님이 괜히 미안한 얼굴을 했다\n그 표정에서 다 들킨 기분이었다', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 6, '2026-08-05', 1, '2026-08-06 00:00:00+09', 'midnight', E'네 목소리가 잘 기억이 안 나기 시작했다\n나아지는 건지 잃어버리는 건지 모르겠다', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 7, '2026-08-06', 0, '2026-08-06 22:00:00+09', 'daily', E'집까지 신호가 한 번도 안 걸렸다\n평소엔 세 번은 걸리는 길인데\n뭔가 좋은 일이 있으려나 하다가\n네 생각이 났다. 좋은 일 하니까', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 8, '2026-08-06', 1, '2026-08-07 00:00:00+09', 'midnight', E'셔플에서 또 그 노래가 나왔다\n우연이 이렇게 성실할 수가 있나', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 9, '2026-08-07', 0, '2026-08-07 22:00:00+09', 'daily', E'금요일인데 아무 약속이 없어서\n운동화 신고 그냥 나왔다\n걷는 건 좋은데\n발이 자꾸 한쪽 동네로 방향을 잡는다', '', '', '[]'::jsonb, 'draft'),
  ('unsent_talk', 10, '2026-08-07', 1, '2026-08-08 00:00:00+09', 'midnight', E'취해서 보내는 연락이 제일 별로라고 생각했는데\n요즘은 그 핑계라도 있는 사람이 부럽다', '', '', '[]'::jsonb, 'draft')
on conflict (campaign_id, schedule_date, slot_index) do update
set scheduled_at = excluded.scheduled_at,
    content_type = excluded.content_type,
    text = excluded.text,
    self_comment_0 = excluded.self_comment_0,
    self_comment_6h = excluded.self_comment_6h,
    search_queries = excluded.search_queries,
    status = case
      when public.threads_autopilot_posts.status in ('approved', 'published')
        then public.threads_autopilot_posts.status
      else 'draft'
    end,
    updated_at = now();

commit;

-- 1) 장기 토큰은 원문을 로그에 남기지 말고 provider='threads_unsent'로 credentials에 등록한다.
-- 2) workflow_dispatch에서 campaign=unsent_talk, verify_only=true로 계정 일치만 검증한다.
-- 3) 10편을 사람이 최종 확인한 뒤 승인한다.
-- update public.threads_autopilot_posts
-- set status = 'approved', updated_at = now()
-- where campaign_id = 'unsent_talk' and status = 'draft';
-- 4) 첫 게시 직전에만 캠페인을 활성화한다. 자동답글은 켜고 셀프댓글은 끈 상태다.
-- update public.threads_autopilot_config
-- set enabled = true, updated_at = now()
-- where id = 'unsent_talk';
