# BCC 리드 컬렉터 v2 — 배포 가이드

`lead-collector-v2.gs`를 기존 Google Apps Script 프로젝트에 적용하는 절차입니다. 도구 측 코드(finder / competitor-analyzer / video-analyzer / keyword-finder)는 **수정 불필요** — 기존 웹앱 URL을 그대로 유지하면서 내부 로직만 v2로 교체합니다.

---

## 1. Apps Script 프로젝트 열기

1. https://script.google.com 접속 (BCC 계정으로 로그인)
2. 기존 BCC 리드 수집 프로젝트 열기
   - 도구 측에 박혀 있는 URL: `https://script.google.com/macros/s/AKfycbxzW84zXGAr8WSKdKhvZ-QK7hPBKgxySNvHapGaAalBSzGapAIjz6wL1bbpwzbomho/exec`
   - 이 URL에 해당하는 프로젝트를 [내 프로젝트] 또는 최근 사용 목록에서 찾기

## 2. 코드 교체

1. 좌측 사이드바 `Code.gs` (또는 `코드.gs`) 클릭
2. 기존 코드 전체 선택 후 삭제
3. `lead-collector-v2.gs` 파일 전체 내용을 복사 → 붙여넣기
4. 저장 (Ctrl+S / Cmd+S)

> ⚠️ **시트 탭 이름 확인.** 코드 상단 `var SHEET_NAME = '리드';` 가 실제 스프레드시트 탭 이름과 동일한지 확인. 다르면 이 한 줄만 수정.

## 3. 기존 데이터 마이그레이션 (1회만)

기존 시트에는 v1 형식 행이 누적되어 있습니다. 이메일별로 집계해서 v2 컬럼 구조로 정리합니다.

1. 에디터 상단 함수 선택 드롭다운 → `migrateExistingRows` 선택
2. [▶ 실행] 클릭
3. 권한 승인 요청 시:
   - 본인 Google 계정 선택
   - "이 앱은 Google에서 확인하지 않았습니다" 경고 → [고급] → ["BCC 리드 수집"으로 이동(안전하지 않음)"] 클릭
   - 권한 허용 (스프레드시트 읽기/쓰기)
4. 실행 로그 확인:
   - `[INFO] Backup created: 리드_backup_yyyyMMdd_HHmmss` — 백업 시트 자동 생성됨
   - `[INFO] Migrated rows: N` — 집계된 고유 사용자 수
   - `[INFO] Loyal users (≥3 visits): M` — 충성 사용자 수

> 🛟 **백업.** 마이그레이션이 끝나면 시트 탭 목록에 `리드_backup_…` 시트가 생성되어 원본 데이터가 보존됩니다. 결과를 확인한 후 수동으로 삭제해도 좋습니다.

> ⚠️ **이 함수는 1회만 실행하세요.** 두 번 실행하면 이미 v2화된 시트를 다시 백업하고 같은 데이터로 재집계만 합니다 (해는 없지만 불필요).

## 4. 웹앱 재배포

1. 우측 상단 [배포] → [배포 관리] 클릭
2. 현재 활성 배포의 [✏️ 편집] 아이콘 클릭
3. "버전" 드롭다운 → [새 버전] 선택
4. 설명: `v2 — email-keyed upsert + tool counts` (자유)
5. [배포] 클릭
6. **URL 변경 없음 확인** — 기존 웹앱 URL이 그대로 표시되어야 함

## 5. 동작 확인

### 시트 헤더
다음 12개 컬럼이 자동 생성되어 있어야 함:
```
A: 이름       E: 최근 방문일    I: 마케팅 동의
B: 전화       F: 방문 횟수      J: 충성 사용자
C: 이메일     G: 사용 도구      K: 도구별 카운트(JSON)
D: 첫 방문일  H: 가장 자주 쓰는 도구   L: 마지막 활동(JSON)
```

### 수동 테스트
1. 에디터에서 `testInsert` 실행 → 새 행 생성 확인 (random email)
2. `testUpdate` 실행 (고정 email `test-fixed@example.com`)
   - 같은 이메일로 여러 번 실행 → 행은 1개만, 방문 횟수만 증가
   - 3회 실행 시 J 컬럼(충성 사용자)이 `TRUE`로 바뀜
   - 실행 로그에 `[LOYAL] test-fixed@example.com just became loyal` 출력

### 실제 도구로 테스트
1. 잇툴즈 도구 페이지 접속 (예: video-analyzer)
2. 리드 게이트 등장 → 본인 정보 입력 → 제출
3. 시트 확인 → 본인 이메일 행에 방문 횟수 누적되는지 확인
4. 다른 도구 (예: keyword-finder)로 이동 → 리드 게이트는 등장하지 않음 (30일 TTL) → 분석 실행 → 액션 가이드 클릭 → 시트의 사용 도구 컬럼에 새 도구 누적되는지 확인

## 6. 충성 사용자 알림 (선택)

현재는 `console.log`만 남습니다. 향후 슬랙/이메일 알림 연동 지점은 `updateExistingLead_` 함수 안의 다음 위치입니다:

```js
if (updateResult.becameLoyal) {
  console.log('[LOYAL] ...');
  // TODO: 추후 슬랙/이메일 알림 연동 지점
}
```

여기에 `MailApp.sendEmail(...)` 또는 슬랙 webhook `UrlFetchApp.fetch(...)` 호출을 추가하면 됩니다.

---

## 트러블슈팅

### Q. 마이그레이션 실행 후 헤더가 영문으로 나옴
A. 코드 상단의 `HEADER` 배열을 한글로 두었는지 확인. 영문이 보인다면 다른 시트를 잘못 건드린 것일 수 있음. 백업 시트에서 원본 복구 가능.

### Q. 시트가 비어있는 상태로 보임
A. `migrateExistingRows` 실행 직후 화면이 새로고침되지 않은 경우 발생. 스프레드시트 탭을 새로고침하면 데이터가 보임.

### Q. 이메일이 대소문자 혼합으로 들어와요
A. 코드 내부에서 모두 lowercase로 정규화해 비교합니다 (`email.toLowerCase()`). 시트에는 lowercase로 저장됩니다.

### Q. 도구 측 코드도 수정해야 하나요?
A. 아닙니다. v1과 동일한 페이로드 형식을 받으므로 모든 도구가 그대로 동작합니다. 새 필드(`activity`)는 옵션이며, 없으면 `'lead_submitted'`로 기본 처리됩니다.

### Q. 기존에 이메일이 비어있던 행이 있다면?
A. 마이그레이션은 이메일이 없는 행을 무시합니다. 이메일이 없으면 사용자를 식별할 수 없기 때문. 필요하면 마이그레이션 전에 수동으로 보강하세요.

---

© 2026 비즈니스커리어컨설팅 (BCC)
