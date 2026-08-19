import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_SCOPES,
  buildAuthorizationUrl,
  createState,
  openSession,
  safeApiError,
  sealSession,
  threadsFetch,
  verifyState,
} from '../lib/threads-review.js';

const config = {
  appId: '123456',
  redirectUri: 'https://example.com/api/threads-oauth-callback',
};

test('심사용 OAuth는 읽기 전용 최소 권한만 요청한다', () => {
  const url = new URL(buildAuthorizationUrl(config, 'signed-state'));
  assert.deepEqual(url.searchParams.get('scope').split(','), ['threads_basic', 'threads_keyword_search']);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(REVIEW_SCOPES.includes('threads_content_publish'), false);
  assert.equal(REVIEW_SCOPES.includes('threads_manage_replies'), false);
});

test('OAuth state는 변조와 만료를 거부한다', () => {
  const now = Date.UTC(2026, 7, 19);
  const state = createState('session-secret', now);
  assert.equal(verifyState(state, 'session-secret', now + 60_000), true);
  assert.equal(verifyState(`${state}x`, 'session-secret', now + 60_000), false);
  assert.equal(verifyState(state, 'wrong-secret', now + 60_000), false);
  assert.equal(verifyState(state, 'session-secret', now + 11 * 60_000), false);
});

test('OAuth 세션은 암호화되어 토큰 평문을 포함하지 않는다', () => {
  const sealed = sealSession({ token: 'secret-access-token', permissions: [] }, 'session-secret');
  assert.equal(sealed.includes('secret-access-token'), false);
  assert.deepEqual(openSession(sealed, 'session-secret'), { token: 'secret-access-token', permissions: [] });
  const tampered = `${sealed.slice(0, -2)}AA`;
  assert.equal(openSession(tampered, 'session-secret'), null);
});

test('키워드 검색 요청은 Bearer 헤더를 사용하며 토큰을 URL에 넣지 않는다', async () => {
  let captured;
  const result = await threadsFetch('/keyword_search', {
    token: 'secret-token',
    params: { q: '생성형 AI', search_type: 'TOP', limit: 10 },
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return { ok: true, json: async () => ({ data: [] }) };
    },
  });
  assert.deepEqual(result, { data: [] });
  assert.equal(captured.url.includes('secret-token'), false);
  assert.equal(captured.options.headers.Authorization, 'Bearer secret-token');
  assert.equal(captured.options.method, undefined);
});

test('검수 화면용 오류는 토큰 없이 제한된 정보만 반환한다', () => {
  const safe = safeApiError(Object.assign(new Error('권한이 없습니다 token=secret'), { code: 10, access_token: 'secret' }));
  assert.deepEqual(Object.keys(safe), ['message', 'code']);
  assert.equal(safe.code, 10);
  assert.equal(safe.message.includes('secret'), false);
  assert.equal('access_token' in safe, false);
});
