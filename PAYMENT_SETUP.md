# BCC 챌린지 결제·회원 시스템 — 셋업 가이드

업무지시서 `BCC_챌린지결제시스템_업무지시서_v1.md` 의 구현체.
프론트(GitHub Pages) + 백엔드(Vercel 서버리스) + Supabase + 토스페이먼츠.

## 아키텍처 (이 레포 기준)

```
프론트 (GitHub Pages: ohdana08.github.io/bcc-homepage)
  apply.html      신청 3칸 → /api/create-checkout → 토스 결제창
  success.html    토스 successUrl → /api/confirm-payment → (선택)/api/set-password
  fail.html       토스 failUrl
  mypage.html     Supabase 로그인 → /api/my-enrollments
  pay-config.js   ← API_BASE(=Vercel 주소), GA ID 한 곳에서 관리
        │  (CORS, 절대 URL 호출)
        ▼
백엔드 (Vercel 서버리스: /api/*)        ← 모든 보안 결정은 여기서만
  products          판매 상품 목록(공개, 표시용)
  create-checkout   금액 서버 결정(구매이력) → pending_orders 저장
  confirm-payment   DB 금액 대조 → 토스 승인검증 → enrollment + active (멱등)
  set-password      결제 완료 주문 검증 후 비밀번호 설정(선택)
  my-enrollments    Bearer 토큰 검증 → 본인 수강이력
  config            공개 설정(toss client key, supabase url/anon)만 반환
  cleanup-pending   Cron(매시간) — 미결제 pending 정리
  lib/supabase.js   service_role 클라이언트(함수 전용)
  lib/cors.js       CORS 허용 출처
        ▼
Supabase   products / profiles / enrollments / pending_orders (RLS)
토스페이먼츠   결제 승인·검증
```

> ⚠️ 프론트는 GitHub Pages(정적)라 서버 함수를 못 돌린다. `/api/*` 는 **이 레포를 Vercel 프로젝트로도 연결**해서 배포한다(정적 파일 + 함수 동시 서빙). 프론트가 호출하는 주소는 `pay-config.js` 의 `BCC_API_BASE` 로, **Vercel 배포 도메인**을 넣어야 한다.

## 셋업 순서

### 1. Supabase
1. 프로젝트 생성 → SQL Editor 에서 `supabase/schema.sql` 실행.
2. Project Settings → API 에서 `URL`, `service_role`, `anon` 키 복사.

### 2. 토스페이먼츠
1. 가입(통신판매업 신고 필요) → 개발자센터에서 **테스트** `client/secret` 키 발급.
2. 결제위젯/일반결제 — 본 구현은 v2 표준 결제창(`js.tosspayments.com/v2/standard`) 사용.

### 3. Vercel
1. 이 레포(`bcc-homepage`)를 Vercel 에 Import (Framework: **Other**, 빌드명령 없음).
2. Settings → Environment Variables 에 `.env.example` 항목 입력(아래 6번 표).
3. 배포 → 도메인 확인(예: `https://bcc-homepage.vercel.app`).

### 4. 프론트 연결
1. `pay-config.js` 의 `BCC_API_BASE` 를 **3번 Vercel 도메인**으로 교체.
2. (필요 시) `lib/cors.js` 또는 `ALLOWED_ORIGINS` 에 프론트 출처 추가.
3. GitHub Pages 에 푸시 → `…/bcc-homepage/apply.html` 접속 테스트.
4. 랜딩(index.html) "신청하기" 버튼을 `apply.html?product=shorts2` 로 연결(원하는 상품 id).

### 5. 결제 테스트 → 라이브
- **테스트 키로 전 플로우 검증** (신청→결제→승인→마이페이지→재수강가 적용).
- 검증 후 `TOSS_SECRET_KEY` / `TOSS_CLIENT_KEY` 를 **라이브 키**로 교체.

### 6. 환경변수 (Vercel)
| 변수 | 용도 | 노출 |
|------|------|------|
| `SUPABASE_URL` | Supabase 주소 | 공개 OK |
| `SUPABASE_SERVICE_ROLE_KEY` | 함수 전용 DB 쓰기 | ★절대 금지 |
| `SUPABASE_ANON_KEY` | 프론트 로그인(RLS 보호) | 공개 OK |
| `TOSS_SECRET_KEY` | 승인 API | ★절대 금지 |
| `TOSS_CLIENT_KEY` | 결제창 | 공개 OK |
| `ALLOWED_ORIGINS` | CORS 허용(선택) | — |
| `CRON_SECRET` | cleanup cron 보호(선택) | ★절대 금지 |
| `PAYMENT_SHEET_URL` | 통합1단계: 결제자→고객시트(시트1) 적재 GAS 웹앱 URL | — |
| `PAYMENT_SHEET_SECRET` | 위 GAS 검증 비밀키(Apps Script SECRET과 동일값) | ★절대 금지 |

## 보안 체크 (업무지시서 §8 대응)
- [x] 결제 금액은 `create-checkout` 가 DB·구매이력 보고 산정 (프론트 0원 조작 불가)
- [x] `confirm-payment` 가 pending_orders 금액 대조 + 토스 승인검증
- [x] 시크릿 키는 Vercel 환경변수 전용 (`.env` gitignore)
- [x] RLS: 본인 행만 select, 쓰기는 service_role 만
- [x] enrollments.order_id UNIQUE → 새로고침 중복 결제 적재 방지(멱등)
- [x] cleanup-pending cron → 미결제 pending 정리
- [ ] set-password 는 MVP(orderId+이메일 일치). 강화 시 매직링크/OTP 로 교체 권장.

## 새 강의 추가
`products` 테이블에 INSERT 한 줄. 코드 수정 0.
```sql
insert into products (id, name, price, recourse_price)
values ('ai_staff', 'AI직원만들기', 119000, 30000);
```

## 기존 4명 수동 등록 (재수강 자격 시드, §9-8)
각 회원에 대해 auth 유저 생성 후 `profiles`(status='active') + `enrollments`(과거 구매) 1행씩 INSERT.
다음 신청 시 구매이력이 잡혀 자동으로 재수강가 적용됨.
