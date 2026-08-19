# bcc-threads-autopilot — Meta App Review 제출자료

## 제출 목적

`threads_keyword_search` 권한은 공개 Threads 게시물을 운영자가 입력한 키워드로 검색하고, 관련 주제와 표현을 읽기 전용으로 검토하기 위해 사용합니다. 심사용 데모는 OAuth 연결, 실제 승인 권한 확인, 키워드 검색, 검색 결과 표시만 제공합니다.

앱은 이 검수 경로에서 게시물, 댓글 또는 답글을 만들거나 수정하지 않습니다. `threads_content_publish`와 `threads_manage_replies`를 요청하지 않으며, 외부 게시물 자동댓글 기능은 별도 운영 플래그가 명시적으로 `true`가 아닌 한 비활성화 상태입니다.

## 데모 URL

- 시작 화면: `https://<VERCEL_DOMAIN>/api/threads-review`
- OAuth 시작: `https://<VERCEL_DOMAIN>/api/threads-oauth-start`
- OAuth 콜백: `https://<VERCEL_DOMAIN>/api/threads-oauth-callback`

## 제출 전 체크리스트

1. Vercel 환경변수를 Production에 등록합니다.
2. `THREADS_REVIEW_REDIRECT_URI`와 Meta 앱의 Valid OAuth Redirect URI가 완전히 같은지 확인합니다.
3. Meta 앱에 테스트 사용자 또는 검수 가능한 계정을 구성합니다.
4. 데모 URL에서 OAuth → 권한 표시 → 검색 성공을 직접 확인합니다.
5. `TEST_STEPS.md`를 검수 단계 설명란에 붙여넣고 `SCREEN_RECORDING_SCRIPT.md`대로 녹화합니다.

자세한 요청·응답은 `API_EXAMPLES.md`, 환경 설정은 `VERCEL_ENV.md`를 참고합니다.
