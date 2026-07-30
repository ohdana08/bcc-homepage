# Threads 완전 자동 운영 셋업

## 실행 규칙

- 자기소개서 자동화: 08:10 / 10:30 / 12:20 / 18:10 / 21:20 (Asia/Seoul)
- 딱지원핏 자동화: 08:30 / 10:50 / 12:40 / 15:30 / 18:30 (Asia/Seoul)
- 콘텐츠 원본 규칙: `BCC_Brain/20_osmu/260728_Threads_사람냄새와_고객언어_운영규칙.md`
- 본문: 한 줄 60자 이내의 완결 문장, 비어 있지 않은 5~9줄, 첫 줄 뒤 빈 줄, 1·2·3 번호 논리
- 마지막 줄: `프로필 링크` 또는 `댓글·답글` 목적지와 행동 동사가 모두 있는 CTA. 일반 질문은 CTA로 인정하지 않음
- 첫 셀프 댓글: 한 줄 60자 이내의 완결 문장 3~8줄. 본문에 없는 예시·체크리스트를 보충
- 6시간 셀프 댓글: 한 줄 60자 이내의 완결 문장 3~8줄. CTA 없이 실전 정보를 보충
- 하루 구성: 가치 제공 4개 + 판매 연결 1개. 자기소개서·취업서류 한 주제만 유지
- 생성 전 최근 24시간 성과가 있는 글을 조회해 형식·주제 신호로만 쓰며, 성과 수치나 문장을 본문에 복제하지 않음
- 0분: 내 게시물에 구체적인 셀프 댓글 1개
- 5분: `threads_keyword_search` 승인 시 같은 주제의 다른 작성자 게시물 5개에 개별 댓글
- 발행 후 0~1시간은 5분마다, 1~6시간은 30분마다, 6~24시간은 3시간마다
  내 글의 새 답글을 읽고 자동 응답
- 환불·법률·개인정보·가격 협상·공격적 댓글은 게시하지 않고 DB에 `자동답변 보류`로 기록
- 6시간: 내 게시물에 실무 보충 셀프 댓글
- 24시간: 실제 인사이트를 DB에만 저장하고 다음 글의 내부 학습 신호로 사용
- 생성·저장·발행·0분 댓글·6시간 댓글 단계마다 동일한 완결성 검사를 통과해야 게시
- 예약 시각을 15분 넘긴 글은 늦게 몰아서 올리지 않고 `skipped` 처리
- 하루 5개 기준 연결 순서: 1→6, 2→7, 3→8, 4→9, 5→10

## 1. Supabase

`supabase/threads-autopilot.sql`을 SQL Editor에서 실행한다.

## 2. Vercel 환경변수

기존 변수에 아래를 추가한다.

```text
THREADS_ACCESS_TOKEN=Threads 장기 사용자 토큰
THREADS_AI_MODEL=claude-sonnet-4-6
THREADS_CRON_SECRET=Threads 작업기 전용 임의 시크릿
THREADS_EXTERNAL_COMMENTS_ENABLED=false
```

기존 `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET`도 유지한다. 토큰과 비밀키는 프론트 코드나 Supabase 테이블에 넣지 않는다.

Threads 토큰에 필요한 권한:

```text
threads_basic
threads_content_publish
threads_read_replies
threads_manage_replies
threads_manage_insights
threads_keyword_search
```

`threads_keyword_search` 앱 검수와 새 토큰 발급이 끝난 뒤에만
`THREADS_EXTERNAL_COMMENTS_ENABLED=true`로 변경한다. 기본값과 미설정 상태는
모두 `false`이며, 권한이 없는 동안 기존 외부 댓글 오류도 자동으로 완료 처리해
재시도하지 않는다.

## 3. GitHub Actions

Repository Settings → Secrets and variables → Actions에 아래 시크릿을 추가한다.

```text
THREADS_CRON_SECRET=<Vercel THREADS_CRON_SECRET과 동일한 값>
```

`.github/workflows/threads-autopilot.yml`이 하루 네 번 6시간 폴링 창을 열고
창 안에서 1분 간격으로 Vercel 작업기를 호출한다. GitHub의 고빈도 예약 누락에
의존하지 않으면서 하루 전체를 이어서 감시한다. 각 글은 발행 후 0~1시간 5분,
1~6시간 30분, 6~24시간 3시간
간격으로 새 댓글을 중복 없이 확인하고 24시간 뒤 감시를 종료한다.

## 4. 연결 검증

1. `@ai_crazy_lab_1201` Threads 프로필 생성
2. Meta 앱의 Threads 테스트 사용자/권한 연결
3. 장기 토큰 발급 후 `/me?fields=id,username`으로 계정 일치 확인
4. 설정을 비활성화한 상태에서 GitHub Actions `workflow_dispatch` 1회 실행
5. 오류가 없으면 다음 날부터 활성화

```sql
update public.threads_autopilot_config
set enabled = true,
    start_date = (now() at time zone 'Asia/Seoul')::date + 1,
    updated_at = now()
where id = 'default';
```

## 5. 중지

```sql
update public.threads_autopilot_config
set enabled = false, updated_at = now()
where id = 'default';
```
