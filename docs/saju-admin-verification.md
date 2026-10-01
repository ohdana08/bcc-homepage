# 결 사주 관리자 전용 통합 — 독립 SRE 검증

기준일: 2026-10-02. 대상 저장소는 `bcc-saju-admin-20261002`, 시작 커밋은 `ce393d5`이다. 사주 v1.1의 검증된 preview 빌드를 BCC 관리자 화면에 통합하는 작업이며, 원본 사주 엔진의 전체 정확성 재검증과 구분한다.

**최종 로컬 브라우저 결과: 13/13 통과, 실패 0.** 최신 보고서 생성 시각은 2026-10-02 02:38:45 KST (`2026-10-01T17:38:45.857Z`)다. 최신 main `0b708fd`를 반영한 병합 커밋 `ede1ef0` 상태에서 재실행된 결과이며, SRE가 보고서의 source hash 9개와 현재 파일이 모두 일치함을 확인했다. 운영 배포 결과는 이 기록에 포함하지 않는다.

## 조사와 설계 근거

- 저장소는 정적 HTML과 Node.js Vercel API 함수 12개를 사용한다. 기존 `api/claude101-suite.js` dispatcher에 `saju-admin`을 추가하여 함수 엔트리 수를 유지한다. Vercel 공식 문서의 비프레임워크 Hobby 함수 제한은 배포당 12개다. 실제 계정 요금제는 이 조사에서 조회하지 않았다. [Vercel runtimes](https://vercel.com/docs/functions/runtimes)
- Vercel 함수의 요청/응답 한도는 4.5 MB다. 최종 구조는 비공개 Storage bucket의 버전별 gzip 객체를 서버에서 읽고 압축 크기·해제한 HTML 크기·SHA-256을 확인한 뒤 응답한다. 인증·관리자 확인이 loader 호출보다 먼저 실행된다. HTML은 916,688 bytes, gzip은 268,729 bytes다. [Vercel limits](https://vercel.com/docs/functions/limitations)
- 총괄 담당이 BCC GitHub 저장소의 공개 상태를 확인해, 초기 API payload 내장 방식을 폐기했다. 공개 저장소에는 무결성 metadata인 `lib/saju-preview/release.js`만 두며, 앱 본문은 private Storage와 `.gitignore`/`.vercelignore` 대상 `.private-saju` 로컬 artifact에만 둔다. 로컬 폴더 이름 자체는 보안 경계가 아니므로 실제 Git 추적·배포 출력·Storage 접근 정책 확인은 별도 증거가 필요하다. [Build output directory](https://vercel.com/docs/builds/configure-a-build), [.vercelignore](https://vercel.com/docs/deployments/vercel-ignore)
- `getUser(token)`은 Auth 서버에 검증 요청을 보내므로 서버 권한 판단의 근거로 사용한다. 이어서 현재 `profiles.is_admin === true`를 확인하며 사용자 metadata를 권한으로 사용하지 않는다. [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- `srcdoc`는 부모 CSP를 상속한다. 자식 meta는 부모 정책을 완화하지 못하므로 실제 inline script hash를 부모와 자식 정책에 함께 넣는다. [CSP Level 3 §7.8](https://w3c.github.io/webappsec-csp/#security-inherit-csp)
- iframe은 `allow-scripts allow-forms allow-downloads allow-modals`만 사용하고 `allow-same-origin`을 제외한다. 부모 세션 저장소와의 분리를 유지하며 자식 `connect-src 'none'`으로 계산 중 네트워크 접근을 차단한다. [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)

## 실행 환경과 경계

`scripts/verify-saju-admin.mjs`는 원본 프로젝트의 설치된 `@playwright/test` 1.63.0과 Chromium을 재사용한다. 새 패키지나 브라우저 다운로드를 요구하지 않는다. 실제 shell HTML/JS/CSS, `vercel.json`의 shell CSP와 rewrite, 실제 `handleSajuAdmin` handler를 사용한다. `release.js`가 지정한 `.private-saju/{objectPath}`를 읽어 크기·SHA-256을 검증한 실제 압축 artifact를 화면에 전달한다. 브라우저 검증은 운영 Storage 다운로드를 대신하지 않는다.

로컬 HTTP 서버는 `127.0.0.1:5190`에서 실행한다. Supabase JS CDN 모듈은 Playwright route로 합성 세션 제어 모듈을 공급하고, handler의 Auth/DB 의존성은 합성 사용자로 주입한다. 실계정, 운영 DB, 결제 API 및 외부 발송은 사용하지 않는다. 출생 입력은 합성 예시다. 토큰/Authorization 헤더 값은 결과 로그에 기록하지 않는다.

로컬 정적 파일 allowlist는 테스트 서버의 안전장치다. **이 서버에서 private 경로가 404라는 사실을 Vercel 정적 비노출 증거로 사용하지 않는다.** 실제 배포 출력/라우팅 검증은 별도로 수행해야 한다. 물리적 인쇄나 생성 PDF도 검증하지 않으며 인쇄 버튼은 `window.print` 호출 spy로만 확인한다.

## 브라우저 검증

실행 명령:

```sh
node scripts/verify-saju-admin.mjs
```

구문 검사 `node --check scripts/verify-saju-admin.mjs`는 통과했다. 최초 실행은 6개 항목 통과 뒤 inline 앵커 스크립트의 quoting 구문 오류를 발견해 중단했다. 총괄 담당이 해당 문자열과 패키징 시 `vm.Script` 구문 검사를 추가해 재생성했다. 최종 대상 SHA-256은 `654364f7e447b291f504c13b870537f991451a091c6e2279c03adafa5e443825`이다. 수정 artifact의 전체 재실행은 **13/13 통과**했으며 SRE가 [실제 JSON 보고서](../test-results-saju-admin/verification.json)를 직접 읽어 확인했다. 이전 부분 통과는 합산하지 않는다.

검증 항목은 13개다.

1. 실제 payload 크기, inline script hash와 부모/자식 CSP 일치.
2. friendly API 경로와 직접 dispatcher 경로에서 미인증·일반 회원·만료·DB 오류·관리자 응답 및 no-store/noindex, POST 거절.
3. 비로그인 shell에서 private API 미요청.
4. 일반 회원 UI 거절.
5. 만료 세션 UI 거절.
6. DB 오류 UI 거절.
7. 401 이후 refresh 한 번과 재시도 성공.
8. 실제 iframe의 양력 폼 submit, 음력 윤2월 변환, 용신 수/희신 목/기신 금 후보, JSON/Markdown 실다운로드, 인쇄 호출, 내부 앵커 이동, 출생 정보 네트워크 미전송.
9. 320/390/1440px shell과 iframe 가로 넘침 없음.
10. opaque iframe의 부모 저장소/문서 및 자체 localStorage 접근 거절, CSP가 fetch를 실제 서버 수신 전에 차단.
11. 닫기/재열기 시 입력·결과 초기화, 로그아웃·다른 계정 이벤트 시 iframe 제거.
12. 지연된 관리자 응답과 로그아웃 경합에서 iframe 재등장 방지.
13. 지연된 관리자 A 응답과 다른 계정 SIGNED_IN 경합에서 iframe 재등장 방지.

주요 측정·관측 결과:

| 항목 | 실제 관측 |
| --- | --- |
| 최종 HTML / gzip | 916,688 / 268,729 bytes |
| inline script SHA-256 (Base64) | `qXgub6E2n71OZoUKCZQ/1e1YN+49gbhI+cPp8PT3iVw=` |
| 13개 항목 소요 합계 | 8,073 ms; 브라우저 시작 시간 제외 |
| 양력 입력과 결과 표시 | 667 ms; Playwright 입력·클릭 대기 포함, 엔진 단독 계산시간이 아님 |
| 계산·다운로드 시 관측 요청 | 로컬 GET 5개 + route로 응답한 Supabase CDN 모듈 GET 1개; POST/body 및 생년월일 포함 URL 없음 |
| iframe 격리 | 부모 storage, 부모 document, iframe 자체 localStorage 모두 `SecurityError` |
| 의도적으로 시도한 fetch | `connect-src` 위반으로 거절; 로컬 probe 서버 수신 0건 |
| 반응형 | 320/390/1440px 입력·결과 가로 넘침 없음 |
| 다운로드 | 실제 `candidate.json`, `candidate.md` 파일 내용과 용신 수/희신 목/기신 금 UI 일치 |

실제 shell의 인증 트래픽 자체가 없다는 뜻은 아니다. 브라우저 검증은 Supabase SDK/Auth를 합성 모듈로 대체했으며, 위 네트워크 관측은 출생 입력과 계산 결과가 추가 요청으로 전송되지 않았다는 범위의 증거다. CSP 차단을 의도한 격리 검사 외 정상 시나리오의 JS/console 오류 검사는 통과했다.

화면 증거: [390px 입력](../test-results-saju-admin/admin-initial-390.png), [390px 결과](../test-results-saju-admin/admin-result-390.png), [1440px 결과](../test-results-saju-admin/admin-result-1440.png). 인쇄 결과는 호출 spy이며 실제 인쇄/PDF 증거는 아니다.

검증 시점 주요 source SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| `api/claude101-suite.js` | `e4dad598095880c401b68b4ed55ce7ca255898da260d22c2b0aca3b134263a6f` |
| `lib/saju-preview/handler.js` | `3095d519edd3c8b2eea2fe4976c8aa304cb964f76916b2c18e718775d1c9293b` |
| `lib/saju-preview/load.js` | `ef65f903dd743940d0b0c1d4c7c795bfa092c78192679e8e1bfc5233b211f2ad` |
| `lib/saju-preview/release.js` | `a23275b2059c8a84fff376e71b084c1b3f9d193a3fdce8199fa63c130e8cb659` |
| `assets/saju-admin.js` | `0fbe5827c3af401fdf3dbb7fcbc85907f7d907ed7850866d2ea326879f9c66c3` |
| `admin-saju.html` | `040343bc28f25501c7418f4993649e3f65fada23a4e126f6eb6365abb9970c32` |
| `vercel.json` | `abb4d183fa612c5fe80396e59b0dbff95e5b4fafd8613668f4a43cc96890973f` |

`.gitignore` 및 `.vercelignore` hash도 JSON 보고서에 보존되어 있다.

## 독립 리뷰 수정 사항

독립 Reviewer가 최초 fetch 대기 중 계정 전환의 경합 문제를 발견했다. 총괄 담당이 요청 시작 시 사용자 ID를 고정하고 응답 적용 전 최신 세션/수정 번호를 다시 확인하도록 수정했다. Reviewer의 VM 상태 검증과 이 문서의 실제 브라우저 경합 검증은 별도 증거로 구분한다.

## 총괄 담당이 별도로 확인한 실제 환경

아래는 SRE의 합성 브라우저 결과와 구분되는 총괄 담당의 실제 조회·컴퓨터 사용·빌드 검증 보고다.

- `storage.objects`와 `storage.buckets`: 두 테이블 RLS 활성화, `pg_policies` 정책 0개.
- `profiles`: RLS 활성화, `auth.uid() = id` 조건의 SELECT 정책만 확인.
- 기존 GitHub 로그인으로 Supabase 관리 UI에서 `saju-private-preview` bucket 생성 및 `public=false` 확인. 파일 한도 2 MiB, MIME `application/gzip`, `application/x-gzip`.
- 버전별 hash 객체 업로드와 크기 268,729 bytes 확인. CLI/SDK upload 시도는 성공하지 않았으며, 실제 완료 경로는 관리 UI 업로드다.
- public Storage URL 요청은 HTTP 400, 오류 본문의 `Bucket not found`/404를 반환했으며 파일 본문이 제공되지 않았다. 이 응답과 관리 UI의 객체 존재 확인을 함께 기록한다.
- 총괄 담당이 전달한 후보 Vercel build: 정적 파일 738개에서 앱 본문 marker 0건, private artifact 0개, API 함수 12개. 로컬 harness allowlist 결과를 대신 사용하지 않았다. 운영 배포의 최종 파일 수/동작은 별도 기록 대상이다.

운영 배포의 정상 관리자 로그인부터 private Storage download와 iframe 계산까지 이어지는 최종 확인은 총괄 담당이 병합·배포 후 별도로 추가한다.

## 확인하지 않은 사항

- SRE 브라우저는 실계정 로그인을 실행하지 않았다. 운영 RLS/Storage 상태는 위 총괄 담당의 별도 조회 결과이며 mock 검증으로 도출한 결론이 아니다.
- 실제 배포 함수에서 서비스 클라이언트가 private Storage 파일을 읽어 관리자에게 전달하는 종단 동작.
- 최신 main 병합 후 운영 배포 결과, CDN 캐시 및 운영 URL 접근. 총괄 담당이 맡는다.
- 실제 PDF 생성 및 프린터 출력.
- 관리자에게 이미 전달된 HTML의 사후 회수. UI는 닫기/로그아웃 때 iframe을 제거하며, 이미 받은 응답을 브라우저 밖에서 보관한 경우까지 회수하는 구조는 아니다.
