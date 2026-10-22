# BCC 강의 운영실

경로: `/admin-lecture-operations.html`, API: `POST /api/lecture-operations`.

ToolJet·LLM·추가 유료 API 없이 기존 문의/제안/수요조사와 기존 강의 수입 원장을 연결한다. 은행 송금, 세금계산서 실제 발행, 캘린더 외부 전송, 이메일 발송을 수행하지 않는다.

## 데이터와 권한

- business 프로젝트의 `proposal_cases`, `lecture_requests`, `training_need_surveys`를 재사용한다. `profiles.is_admin`인 사용자만 API를 통과한다.
- 희망일·예산은 상담 자료다. 확정 일정은 새 `lecture_operations`에 독립 저장하며, 기존 `lecture_date`와 접수 payload를 덮어쓰지 않는다.
- personal 프로젝트의 기존 `lectures`가 수입 원장이다. 재무 소유자가 별도 로그인하고 기존 기록을 직접 선택해 연결한다. 이름·금액만으로 자동 연결하지 않는다.
- 개인 지출·자산·주식은 접근하지 않는다. 재무 service_role 키를 사용하지 않으며 사용자 JWT와 기존 `is_finance_owner()`/`user_id` 권한을 유지한다.
- 연결 당시 확인한 실입금 총액을 시작 잔액으로 보존한다. 과거 거래일을 추정하지 않는다.
- 실입금 = 시작 잔액 + 취소되지 않은 입금 − 취소되지 않은 환급. 받을 금액 = 계약 강사료 − 확인한 차감액. 차감액을 세율로 자동 계산하지 않는다.
- 연결된 `lectures`의 금액·날짜·기관·주제·소유자 변경과 삭제는 기존 화면에서 차단한다. 연결 이후 정산은 새 운영실에서 기록한다. 미연결 원장 항목은 기존처럼 편집 가능하다.
- 저장은 원장과 정산 합계를 같은 DB 트랜잭션으로 반영한다. 재시도 ID, 버전 비교, 일정 잠금으로 중복/경쟁 쓰기를 제어한다.

## 운영 적용 순서

운영 변경은 이 작업의 실제 승인 대상과 범위를 확인한 뒤 수행한다.

1. 최신 원격 main과 실제 배포 버전을 다시 대조하고 다른 작업의 변경을 보존해 병합한다.
2. 기존 두 DB 스키마와 신규 테이블/함수 이름 충돌 여부를 읽기 전용으로 재확인한다.
3. 홈페이지 business DB에 `supabase/lecture-operations.sql` 적용.
4. 기존 personal 재무 DB에 `supabase/lecture-operations-finance.sql` 적용. 기존 행을 일괄 수정하거나 자동 연결하지 않는다.
5. 홈페이지 Vercel 환경에 기존 personal 프로젝트 공개 anon/publishable 키를 `FINANCE_SUPABASE_ANON_KEY`로 안전하게 설정한다. 값은 로그/문서/코드에 복사하지 않는다. `FINANCE_SUPABASE_URL`은 해당 personal 프로젝트 URL을 고정 검증하며 생략 가능하다. service_role 키는 거부한다.
6. 기존 홈페이지 배포 경로로 배포하고 기존 문의/첨부/제안 화면, 관리자 권한, 새로운 API를 확인한다.
7. 실제 재무 소유자 로그인과 실제 연결할 강의 선택은 사용자가 확인한 범위에서 진행한다. 합성 데이터로 실제 장부를 오염시키지 않는다.

## 검증과 재현

- `npm test`: 기존 테스트와 신규 UI/API/domain 회귀 검사. loopback HTTP 테스트를 위해 로컬 포트가 필요하다.
- `node scripts/lecture-operations-local-server.mjs`: 기본 127.0.0.1:5202, `/__fixture/start`에서 명시적으로 합성 관리자 진입. 메모리 데이터·합성 인증만 사용하며 종료하면 변경 데이터는 사라진다. 제품 파일은 수정하지 않고 브라우저 인증 import만 로컬 fixture로 치환한다.
- `scripts/verify-lecture-operations.mjs`: 기존 PostgreSQL 바이너리와 pg 모듈을 사용해 별도 임시 클러스터/두 DB에서 실제 SQL을 검증한다. 인자와 환경변수는 스크립트 선두를 확인한다. 운영 DB로 실행하지 않는다.
- `gitleaks protect --staged --redact=100 --no-banner`: 커밋 전 변경 코드 검사.

목록과 미수금은 현재 불러온 기록 기준이다. 추가 페이지는 명시적으로 불러온다. 공개 폼에서 접수한 희망일을 확정 일정으로 자동 전환하지 않는다. 일정 충돌은 새 운영실에 입력한 회차 기준이며 기존 외부 캘린더 전체와 동기화하지 않는다.

## 복구

배포 문제는 직전 홈페이지 버전으로 되돌릴 수 있다. 추가한 DB 테이블/이력은 보존한다. 연결 후에는 기존 장부 수정 보호가 걸리므로 홈페이지만 되돌린 경우에도 연결된 항목의 정산 편집 경로를 별도 확보해야 한다. 보호 트리거 제거·연결 해제·원장 직접 수정은 대사 없이 자동 수행하지 않는다. API 오류 시 입력을 보존하고 같은 요청 ID로 재시도하며, 409 충돌이면 최신 기록을 확인한다.
