# Threads 완전 자동 운영 셋업

## 실행 규칙

- 하루 5개 자동 생성·자동 발행: 08:30 / 11:30 / 14:30 / 18:30 / 21:30 (Asia/Seoul)
- 0분: 내 게시물에 구체적인 셀프 댓글 1개
- 5분: 같은 주제의 다른 작성자 게시물 5개에 개별 댓글
- 15분: 내 글에 들어온 답글을 읽고 자동 응답
- 6시간: 내 게시물에 실무 보충 셀프 댓글
- 24시간: 실제 인사이트를 댓글로 공개하고 다음 날 같은 슬롯의 글을 이어서 발행
- 하루 5개 기준 연결 순서: 1→6, 2→7, 3→8, 4→9, 5→10

## 1. Supabase

`supabase/threads-autopilot.sql`을 SQL Editor에서 실행한다.

## 2. Vercel 환경변수

기존 변수에 아래를 추가한다.

```text
THREADS_ACCESS_TOKEN=Threads 장기 사용자 토큰
THREADS_AI_MODEL=claude-sonnet-4-6
```

기존 `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET`도 필요하다. 토큰과 비밀키는 프론트 코드나 Supabase 테이블에 넣지 않는다.

Threads 토큰에 필요한 권한:

```text
threads_basic
threads_content_publish
threads_read_replies
threads_manage_replies
threads_manage_insights
threads_keyword_search
```

## 3. GitHub Actions

Repository Settings → Secrets and variables → Actions에 아래 시크릿을 추가한다.

```text
THREADS_CRON_SECRET=<Vercel CRON_SECRET과 동일한 값>
```

`.github/workflows/threads-autopilot.yml`이 5분 간격으로 Vercel 작업기를 호출한다.

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

