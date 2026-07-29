# Threads 완전 자동 운영 셋업

## 실행 규칙

- 하루 5개 자동 생성·자동 발행: 08:30 / 11:30 / 14:30 / 18:30 / 21:30 (Asia/Seoul)
- 콘텐츠 원본 규칙: `BCC_Brain/20_osmu/260728_Threads_사람냄새와_고객언어_운영규칙.md`
- 본문: 한 줄 10자 이내, 비어 있지 않은 5~10줄, 첫 줄 뒤 빈 줄, 마지막 줄에 맥락형 질문 CTA 1개
- 첫 셀프 댓글: 한 줄 10자 이내, 5~10줄. 본문에 없는 예시·체크리스트를 보충
- 6시간 셀프 댓글: 한 줄 10자 이내, 3~10줄. CTA 없이 실전 정보를 보충
- 하루 구성: 가치 제공 4개 + 판매 연결 1개. 자기소개서·취업서류 한 주제만 유지
- 생성 전 최근 24시간 성과가 있는 글을 조회해 형식·주제 신호로만 쓰며, 성과 수치나 문장을 본문에 복제하지 않음
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
THREADS_CRON_SECRET=Threads 작업기 전용 임의 시크릿
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

## 3. GitHub Actions

Repository Settings → Secrets and variables → Actions에 아래 시크릿을 추가한다.

```text
THREADS_CRON_SECRET=<Vercel THREADS_CRON_SECRET과 동일한 값>
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
