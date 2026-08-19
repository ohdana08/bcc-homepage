# Vercel 환경변수

Production, Preview 중 실제 심사에 사용할 환경에 아래 값을 등록합니다.

| 변수 | 값 | 비고 |
|---|---|---|
| `THREADS_REVIEW_APP_ID` | Meta Threads 앱 ID | 비밀은 아니지만 서버 환경변수로 통일 |
| `THREADS_REVIEW_APP_SECRET` | Meta 앱 시크릿 | 절대 클라이언트에 노출하지 않음 |
| `THREADS_REVIEW_REDIRECT_URI` | `https://<VERCEL_DOMAIN>/api/threads-oauth-callback` | Meta 설정과 문자 단위로 일치 |
| `THREADS_REVIEW_SESSION_SECRET` | 무작위 32바이트 이상 문자열 | OAuth state 서명 및 세션 암호화 |

`THREADS_REVIEW_SESSION_SECRET` 생성 예시:

```bash
openssl rand -base64 48
```

안전 운영을 위해 기존 `THREADS_EXTERNAL_COMMENTS_ENABLED`는 설정하지 않거나 `false`로 유지합니다. 배포 중 자동화 자체를 완전히 멈추려면 기존 `THREADS_AUTOPILOT_PAUSED=true`를 사용합니다.
