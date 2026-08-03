# BCC 기관 제안 작업메일 자동화

전용 Gmail에 들어온 작업 메일을 5분마다 확인하고, 기관 메일과 첨부파일을 BCC 제안 엔진으로 처리한 뒤 서버에 고정된 결과 수신 이메일로만 보낸다.

## 고정 안전 규칙

- 원발신자에게 자동 회신하지 않는다.
- CC/BCC를 사용하지 않는다.
- 결과 수신자는 요청 본문이 아니라 Vercel의 `PROPOSAL_RESULT_EMAIL`에서만 결정한다.
- Gmail·Google·ChatGPT 비밀번호를 Vercel이나 코드에 저장하지 않는다.
- 메일 본문과 추출된 첨부 텍스트는 제안 사례로 Supabase에 저장되고, 초안 생성을 위해 Anthropic API로 처리된다.

## 1. Vercel 환경변수

- `PROPOSAL_MAIL_SECRET`: 24자 이상의 무작위 비밀값
- `PROPOSAL_RESULT_EMAIL`: 결과를 받을 Daum 이메일
- `PROPOSAL_OWNER_ID`: 선택사항. 비우면 첫 번째 관리자 프로필을 사용한다.

`PROPOSAL_MAIL_SECRET`은 채팅·소스코드·스크린샷에 남기지 않는다.

## 2. Apps Script 설치

1. 작업용 Gmail 계정으로 `https://script.google.com`에 접속한다.
2. 새 프로젝트를 만들고 `gas/proposal-mail-worker.gs`의 내용을 붙여넣는다.
3. 프로젝트 설정 → 스크립트 속성에 아래 두 값을 추가한다.
   - `BCC_MAIL_SECRET`: Vercel과 동일한 비밀값
   - `BCC_RESULT_EMAIL`: Vercel의 `PROPOSAL_RESULT_EMAIL`과 동일한 결과 수신 주소
4. `setupBccProposalMailbox`를 한 번 실행하고 Gmail 및 외부 요청 권한을 승인한다.
5. 이후 `processBccProposalInbox`가 5분마다 자동 실행된다.

## 3. 처리 상태

- `BCC_PROCESSED`: 결과 전달 완료
- `BCC_PROCESSING`: 현재 처리 중
- `BCC_ERROR`: 처리 실패. 다음 실행에서 다시 시도한다.

중복 실행 시 Gmail 메시지 ID와 Supabase `source=gmail:<message id>`를 기준으로 기존 결과를 재사용한다.

## 지원 첨부파일

- HWP/HWPX: 서버에서 텍스트 추출
- TXT/MD/CSV/JSON/XML: 텍스트 추출
- PDF 및 JPEG/PNG/GIF/WebP: Claude 원문 검토 자료로 전달
- 파일당 2MB, 전체 2.5MB까지 자동 처리

지원하지 않거나 암호화된 파일은 결과 메일에 `사람이 원본 확인 필요`로 표시한다.
