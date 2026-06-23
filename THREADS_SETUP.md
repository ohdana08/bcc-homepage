# 스레드 공장 — 2단계(저장·보관함) 셋업

> 1단계(글 생성 + 이미지 프롬프트)에 이어, 생성 결과를 Supabase에 저장하고 ☰ 보관함에서 다시 보는 단계.
> 카드뉴스 공장의 `cardnews_history` 구조·RLS·user_id 연결을 **그대로 복제**했다(새 패턴 없음).

## 1) Supabase — 보관함 테이블 추가 (한 번 실행)

Supabase 대시보드 → **SQL Editor** 에서 실행:

```sql
-- 스레드 공장 보관함 (카드뉴스 cardnews_history 와 동일 구조)
create table if not exists public.threads_history (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  input_type text,            -- benchmark | youtube | lecture
  purpose text,               -- openchat | reaction_test | prompt_bait
  threads_count int default 0,
  data jsonb,                 -- 생성 결과 전체(analysis, meta, threads[])
  created_at timestamptz default now()
);
create index if not exists threads_history_user_idx
  on public.threads_history(user_id, created_at desc);

-- RLS 켜고 정책 없음 = anon/직접접근 전면 차단. 서버 함수(service_role)만 접근.
alter table public.threads_history enable row level security;
```

### 본인 user_id만 조회되는 원리 (카드뉴스와 동일)
- RLS를 켜고 **정책을 두지 않으면** anon 키로는 한 줄도 못 읽는다(직접 접근 전면 차단).
- 실제 조회/저장은 서버 함수 `api/cardnews-history`(service_role)만 한다. 이 함수는
  ① Bearer 토큰 → `auth.getUser` ② `profiles.is_admin` 재검사 ③ 모든 쿼리에 `.eq('user_id', uid)`
  를 강제하므로, **로그인한 관리자 본인의 user_id 데이터만** 오간다.

## 2) 배포
- 새 Vercel 함수 없음 — 저장 API는 기존 `cardnews-history.js` 에 `kind=threads` 분기로 통합(12함수 한계 유지).
- 새 환경변수 없음. `git push` 후 자동 배포.

## 3) 확인
1. `admin-threads.html` 관리자 로그인 → 글 생성 → 자동 저장됨
2. 좌상단 **☰ → "내 스레드 보관함"** → 날짜별(오늘/어제/N일 전) 최신순 목록
3. 항목 클릭 → 그 글 다시 표시(복사 버튼 그대로) / ✏️ 이름변경 / ✕ 삭제
4. 다른 기기/브라우저에서 로그인해도 같은 목록(서버 저장이라 동기화됨)

> 좋은글/버린글 체크와 GA4는 3단계 — 아직 미구현.
