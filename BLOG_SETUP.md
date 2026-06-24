# 블로그 공장 — 셋업 (OSMU 세 번째 출구)

> 같은 핵심 메시지를 "가장 길고 깊은 정보성 칼럼(1500~2500자) + SEO 메타"로 푸는 공장.
> 스레드 공장(`admin-threads.html`)의 골격·보안·저장 패턴을 **그대로 복제**했다(새 패턴 없음).
> ★ 후기·실적·영업 톤 금지 — 이 공장은 정보·칼럼·인사이트만. (후기 블로그는 별개 공장)

## 0) 신규 서버 함수 0개 — 12함수 한계 유지
Vercel Hobby 12함수 한계 때문에 별도 함수를 두지 않았다. 스레드 공장과 동일하게:
- 생성: 기존 `api/cardnews-generate.js` 에 **`engine:'blog'`** 분기 통합
- 저장: 기존 `api/cardnews-history.js` 에 **`kind:'blog'`** 분기 통합
- 새 환경변수 없음(`ANTHROPIC_API_KEY`, `SUPABASE_*` 기존 재사용). `git push` 후 자동 배포.

## 1) Supabase — 보관함 테이블 추가 (한 번 실행)

Supabase 대시보드 → **SQL Editor** 에서 실행:

```sql
-- 블로그 공장 보관함 (스레드 threads_history 와 동일 구조)
create table if not exists public.blog_results (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  campaign_id text,           -- UTM 식별자(원료/메시지 식별자)
  data jsonb,                 -- 생성 결과 전체 { message, column, seo }
  created_at timestamptz default now()
);
create index if not exists blog_results_user_idx
  on public.blog_results(user_id, created_at desc);

-- RLS 켜고 정책 없음 = anon/직접접근 전면 차단. 서버 함수(service_role)만 접근.
alter table public.blog_results enable row level security;
```

### 본인 user_id만 조회되는 원리 (스레드·카드뉴스와 동일)
- RLS를 켜고 **정책을 두지 않으면** anon 키로는 한 줄도 못 읽는다(직접 접근 전면 차단).
- 실제 조회/저장은 서버 함수 `api/cardnews-history`(service_role)만 한다. 이 함수는
  ① Bearer 토큰 → `auth.getUser` ② `profiles.is_admin` 재검사 ③ 모든 쿼리에 `.eq('user_id', uid)`
  를 강제하므로, **로그인한 관리자 본인의 user_id 데이터만** 오간다.

## 2) 입구 2개 (OSMU 조립 대비 핵심)

이 공장은 두 가지 방식으로 입력을 받고, **같은 `generateColumn()` 함수로 합류**한다.

- **[입구1] 단독 모드**: 원료(벤치마킹 글/유튜브 스크립트/강의 멘트) 붙여넣기
  → (추출) 핵심 메시지 JSON → (생성) 칼럼.  ※ Claude 호출 2회.
- **[입구2] OSMU 부품 모드**: 이미 추출된 핵심 메시지 JSON 붙여넣기
  → 추출 건너뛰고 → 바로 (생성) 칼럼.  ※ Claude 호출 1회.

핵심 메시지 JSON 스키마(입구2 입력 형식 = 고정):
```json
{
  "topic": "글 주제",
  "claim": "핵심 주장",
  "logic": ["논리 전개 1", "2", "3"],
  "evidence": ["근거/사례 종류 1", "2"],
  "cta": "독자 행동 유도"
}
```
→ 입구1의 추출 단계도 **반드시 이 동일 JSON**을 만들어 `generateColumn` 에 넘긴다.
  결과 화면에 이 JSON 을 📦 **핵심 메시지(OSMU 부품)** 로 그대로 노출·복사 가능 —
  폐기하지 않고 **스레드·카드뉴스 공장 입구2에 재사용**하는 자산이다.

## 3) 저작권 2단계 분리 (단어만 바꾸기 금지)
- **[추출]** 원료에서 핵심 주장 / 논리 순서 / 근거 종류만 뽑고 원문 표현은 전부 폐기.
  외국어는 번역 금지(영어 상태로 주장만 추출 → 한국어 뼈대).
- **[생성]** 뼈대(JSON)만 보고 원문을 다시 보지 않고 BCC 톤으로 처음부터 작성.
- 고유명사·수치·인용만 사실로 유지. 그 외 서술은 100% BCC 표현.
- 모델: `claude-sonnet-4-6`.

## 4) 확인 (체크리스트)
1. `admin-blog.html` 관리자 로그인 → **단독 모드** 원료 붙여넣기 → 생성 →
   ① 핵심 메시지 JSON ② 칼럼 본문(1500~2500자, H2/H3 키워드) ③ SEO메타(제목/설명/태그/UTM) 출력.
2. 각 블록 복사 버튼(JSON / 본문 / SEO) 동작 확인. 보관함 자동 저장 확인.
3. **OSMU 부품 모드**: 1에서 복사한 JSON 붙여넣기 → 추출 없이 동일 칼럼 생성 확인.
4. 좌상단 **☰ → 내 블로그 보관함** → 날짜별 최신순 목록 / 항목 클릭 재표시 / ✏️ 이름변경 / ✕ 삭제.
5. 다른 기기/브라우저 로그인해도 같은 목록(서버 저장 동기화).
6. `mypage.html` → 관리자에게만 📰 블로그 공장 버튼 노출.

> 좋은글/버린글 채택여부(adopted) 기록은 3단계 — 아직 미구현.
> (`blog_results` 에 `adopted boolean` 컬럼 추가로 확장 예정)
