# API 요청·응답 예시

아래 값은 형식을 설명하기 위한 마스킹 예시입니다. 실제 토큰과 앱 시크릿은 문서, 코드, 로그, 브라우저 응답에 기록하지 않습니다.

## 1. OAuth 승인

```http
GET https://threads.com/oauth/authorize
  ?client_id=<APP_ID>
  &redirect_uri=https%3A%2F%2F<VERCEL_DOMAIN>%2Fapi%2Fthreads-oauth-callback
  &scope=threads_basic%2Cthreads_keyword_search
  &response_type=code
  &state=<SIGNED_ONE_TIME_STATE>
```

## 2. 권한 확인

```http
GET https://graph.threads.com/v1.0/debug_token?input_token=<REDACTED>
Authorization: Bearer <REDACTED>
```

```json
{
  "data": [
    { "permission": "threads_basic", "status": "granted" },
    { "permission": "threads_keyword_search", "status": "granted" }
  ]
}
```

## 3. 키워드 검색

```http
GET https://graph.threads.com/v1.0/keyword_search?q=AI&search_type=TOP&limit=10&fields=id,username,text,timestamp,permalink
Authorization: Bearer <REDACTED>
```

```json
{
  "data": [
    {
      "id": "<THREAD_ID>",
      "username": "example_creator",
      "text": "공개 게시물 예시",
      "timestamp": "2026-08-19T01:23:45+0000",
      "permalink": "https://www.threads.com/@example_creator/post/<SHORTCODE>"
    }
  ]
}
```

앱의 브라우저 응답에는 위 공개 결과 필드와 안전하게 정리한 오류만 표시됩니다. 액세스 토큰, 앱 시크릿, OAuth code는 표시하지 않습니다.


## 4. 계정 연결 해제·데이터 삭제 콜백

Meta가 전송한 `signed_request`는 Threads 앱 시크릿으로 HMAC-SHA256 검증한 뒤 처리합니다. 심사용 데모는 검색 결과를 저장하지 않으므로 연결 해제는 성공 응답만 반환하며, 삭제 요청은 확인 코드와 상태 URL을 반환합니다.

```http
POST https://<VERCEL_DOMAIN>/api/threads-oauth-callback?action=deauthorize
Content-Type: application/x-www-form-urlencoded

signed_request=<META_SIGNED_REQUEST>
```

```http
POST https://<VERCEL_DOMAIN>/api/threads-oauth-callback?action=delete
Content-Type: application/x-www-form-urlencoded

signed_request=<META_SIGNED_REQUEST>
```

```json
{
  "url": "https://<VERCEL_DOMAIN>/api/threads-review?deletion=<CONFIRMATION_CODE>",
  "confirmation_code": "<CONFIRMATION_CODE>"
}
```
