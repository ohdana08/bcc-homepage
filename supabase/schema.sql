-- ============================================================
-- BCC 챌린지 결제·회원 시스템 — Supabase 스키마 (v1)
-- 업무지시서 §3 기반. Supabase SQL Editor에 그대로 실행.
-- 모든 쓰기(insert/update)는 Vercel 함수의 service_role 키로만 수행.
--   → 프론트(anon key)는 RLS로 "읽기 본인 행"만 허용, 쓰기 불가.
-- ============================================================

-- ------------------------------------------------------------
-- 1) 상품 테이블: 새 강의는 여기 INSERT 한 줄로 끝 (코드 수정 0)
-- ------------------------------------------------------------
create table if not exists products (
  id             text primary key,        -- 'shorts2', 'cardnews', 'ai_staff'
  name           text not null,           -- 'AI 숏츠 크리에이터 과정 2기'
  price          integer not null,        -- 119000 (정가)
  recourse_price integer,                 -- 30000 (강의별 재수강가, null이면 정가 적용)
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- ------------------------------------------------------------
-- 2) 회원 테이블 (Supabase auth.users 확장)
-- ------------------------------------------------------------
create table if not exists profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  name                 text,
  phone                text,
  email                text unique,
  status               text default 'pending',    -- 'pending' | 'active'
  password_set         boolean default false,
  marketing_consent    boolean default false,      -- 마케팅 정보 수신 동의(선택). 화면 노출은 "신규 강의·특강·이벤트·무료 자료 안내"
  marketing_consent_at timestamptz,                -- 동의한 시점(미동의 시 null) = 법적 증빙
  privacy_agree        boolean default false,      -- 개인정보 수집·이용 동의(필수)
  privacy_agree_at     timestamptz,                -- 개인정보 동의 시점 = 법적 증빙
  consent_source       text,                       -- 동의 출처: 'signup'|'free_tool'|'ebook'|'course_done'|'community' (재동의 확장 대비)
  created_at           timestamptz default now()
);

-- 기존 DB 마이그레이션: create table 는 이미 있으면 건너뛰므로 컬럼을 따로 보강
alter table profiles add column if not exists marketing_consent    boolean default false;
alter table profiles add column if not exists marketing_consent_at timestamptz;
alter table profiles add column if not exists privacy_agree        boolean default false;
alter table profiles add column if not exists privacy_agree_at      timestamptz;
alter table profiles add column if not exists consent_source        text;

-- ------------------------------------------------------------
-- 3) 결제 대기 주문 (주문번호-금액 매핑) — confirm 단계의 조작 방지 핵심
--    create-checkout 가 여기에 amount 를 박아두고,
--    confirm-payment 가 토스가 보낸 amount 와 대조한다.
-- ------------------------------------------------------------
create table if not exists pending_orders (
  order_id    text primary key,           -- 'shorts2_<uuid>_<ts>'
  user_id     uuid references profiles(id) on delete cascade,
  product_id  text references products(id),
  amount      integer not null,           -- 서버가 결정한 결제 금액 (★신뢰 기준★)
  is_recourse boolean default false,
  status      text default 'pending',     -- 'pending' | 'paid' | 'expired'
  refund_policy_agreed    boolean default false,  -- 환불(청약철회) 제한 고지 동의(필수) — 분쟁 증거
  refund_policy_agreed_at timestamptz,            -- 동의한 시점
  created_at  timestamptz default now()
);

-- 기존 DB 마이그레이션: 컬럼 보강
alter table pending_orders add column if not exists refund_policy_agreed    boolean default false;
alter table pending_orders add column if not exists refund_policy_agreed_at timestamptz;

-- ------------------------------------------------------------
-- 4) 수강 이력
--    order_id UNIQUE → confirm-payment 재호출(새로고침)에도 중복 적재 방지(멱등).
-- ------------------------------------------------------------
create table if not exists enrollments (
  id          bigint generated always as identity primary key,
  user_id     uuid references profiles(id) on delete cascade,
  product_id  text references products(id),
  paid_amount integer not null,
  is_recourse boolean default false,
  order_id    text unique,                -- 토스 주문번호 (멱등 키)
  refund_policy_agreed    boolean default false,  -- 결제 시점 환불 제한 동의(분쟁 증거) — pending_orders 에서 복사
  refund_policy_agreed_at timestamptz,            -- 동의한 시점
  paid_at     timestamptz default now()
);

-- 기존 DB 마이그레이션: 컬럼 보강
alter table enrollments add column if not exists refund_policy_agreed    boolean default false;
alter table enrollments add column if not exists refund_policy_agreed_at timestamptz;

create index if not exists idx_enrollments_user on enrollments(user_id);
create index if not exists idx_pending_orders_status_created
  on pending_orders(status, created_at);

-- ------------------------------------------------------------
-- 5) 초기 상품 데이터 (이미 있으면 무시)
-- ------------------------------------------------------------
insert into products (id, name, price, recourse_price, is_active) values
  ('shorts2',  'AI 숏츠 크리에이터 과정 2기',     119000, 30000, false),
  ('cardnews', 'AI 카드뉴스 공장 만들기 과정 1기', 119000, 30000, false)
on conflict (id) do nothing;

-- 지난 강의(판매중지): 신규 결제/목록에는 노출 안 됨(is_active=false).
-- 기존 수강생 과거 이력(enrollments) FK 연결 용도로만 존재.
insert into products (id, name, price, recourse_price, is_active) values
  ('shorts1', 'AI 숏츠 크리에이터 과정 1기', 119000, 30000, false)
on conflict (id) do nothing;

-- ★ 현재 모집 중인 기수 없음 → 전 기수 판매중지.
--   (위 insert는 "이미 있으면 무시"라 기존 행은 안 바뀜 → 아래 update로 강제 반영)
--   새 기수 오픈 시: 해당 product의 is_active=true 로 변경 + 잇스쿨/상세페이지 문구 교체.
update products set is_active = false
  where id in ('shorts1', 'shorts2', 'cardnews');

-- ============================================================
-- RLS (Row Level Security) — 보안 최대 포인트 (업무지시서 §3)
-- ============================================================
alter table products       enable row level security;
alter table profiles       enable row level security;
alter table enrollments    enable row level security;
alter table pending_orders enable row level security;

-- 상품: 누구나 읽기(가격 표시용), 쓰기 정책 없음 → 프론트 쓰기 불가
drop policy if exists "products readable" on products;
create policy "products readable" on products
  for select using (true);

-- 본인 프로필만 조회
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for select using (auth.uid() = id);

-- 본인 수강이력만 조회
drop policy if exists "own enrollments" on enrollments;
create policy "own enrollments" on enrollments
  for select using (auth.uid() = user_id);

-- pending_orders: select 정책 없음 → anon/authenticated 모두 접근 불가.
--   service_role 키는 RLS 를 우회하므로 Vercel 함수에서만 읽고 쓴다.

-- ============================================================
-- 테이블 GRANT — 신형 API 키(sb_secret/sb_publishable) 프로젝트 대응
--   RLS 우회(service_role)와 별개로, 테이블 자체 접근 권한(GRANT)이 없으면
--   "permission denied for table ..."(42501) 발생. 신형 키 프로젝트에서
--   기본 GRANT 가 빠질 수 있어 명시적으로 부여한다.
-- ============================================================
-- service_role(서버 API): 모든 테이블 읽기·쓰기
grant all    on all tables    in schema public to service_role;
grant all    on all sequences in schema public to service_role;
-- anon/authenticated(프론트): 읽기 (실제 행 접근은 RLS 가 통제)
grant select on all tables    in schema public to anon, authenticated;
-- 이후 생성될 객체에도 자동 적용
alter default privileges in schema public grant all    on tables    to service_role;
alter default privileges in schema public grant all    on sequences to service_role;
alter default privileges in schema public grant select on tables    to anon, authenticated;

-- ============================================================
-- 참고: 미결제 pending 정리 (업무지시서 §8 — pending 계정 방치 대응)
--   /api/cleanup-pending (Vercel Cron, 매시간)에서 아래 로직을 service_role 로 수행:
--     - 24h 초과 pending_orders.status='pending' → 'expired'
--     - 결제 이력(enrollments) 없는 24h 초과 profiles.status='pending' → 정리
--   필요 시 정책을 데이터 보고 조정.
-- ============================================================
