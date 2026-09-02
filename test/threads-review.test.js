import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  REVIEW_SCOPES,
  buildAuthorizationUrl,
  createState,
  deletionConfirmation,
  openSession,
  parseSignedRequest,
  safeApiError,
  sealSession,
  threadsFetch,
  verifyState,
} from '../lib/threads-review.js';
import callbackHandler from '../meta-app-review/implementation/api/threads-oauth-callback.js';

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
  assert.deepEqual(openSession(sealed, 'session-secret'), {
    token: 'secret-access-token',
    permissions: [],
  });
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

test('Meta signed_request는 HMAC 검증 후에만 처리한다', () => {
  const secret = 'threads-app-secret';
  const payload = Buffer.from(JSON.stringify({ user_id: 'reviewer-123' })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  assert.deepEqual(parseSignedRequest(`${signature}.${payload}`, secret), {
    user_id: 'reviewer-123',
  });
  assert.equal(parseSignedRequest(`${signature}.${payload}`, 'wrong-secret'), null);
  assert.equal(parseSignedRequest('invalid', secret), null);
  assert.equal(deletionConfirmation('reviewer-123', secret).length, 24);
});

test('Meta 해제·삭제 콜백은 Buffer 본문을 검증하고 안전한 응답만 반환한다', async () => {
  const secret = 'threads-app-secret';
  Object.assign(process.env, {
    THREADS_REVIEW_APP_ID: '123456',
    THREADS_REVIEW_APP_SECRET: secret,
    THREADS_REVIEW_REDIRECT_URI: 'https://example.com/api/threads-oauth-callback',
    THREADS_REVIEW_SESSION_SECRET: 'session-secret',
  });
  const payload = Buffer.from(JSON.stringify({ user_id: 'reviewer-123' })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const body = Buffer.from(new URLSearchParams({
    signed_request: `${signature}.${payload}`,
  }).toString());
  const run = async (action) => {
    let statusCode;
    let result;
    const headers = {};
    const res = {
      setHeader(name, value) { headers[name] = value; return this; },
      status(value) { statusCode = value; return this; },
      json(value) { result = value; return this; },
    };
    await callbackHandler({ method: 'POST', query: { action }, body }, res);
    return { statusCode, result, headers };
  };
  const deauthorize = await run('deauthorize');
  assert.equal(deauthorize.statusCode, 200);
  assert.deepEqual(deauthorize.result, { success: true });
  assert.equal(deauthorize.headers['Cache-Control'], 'no-store');
  const deletion = await run('delete');
  assert.equal(deletion.statusCode, 200);
  assert.equal(deletion.result.confirmation_code.length, 24);
  assert.match(deletion.result.url, /^https:\/\/example\.com\/api\/threads-review\?deletion=/);
});

test('검수 화면용 오류는 토큰 없이 제한된 정보만 반환한다', () => {
  const safe = safeApiError(Object.assign(
    new Error('권한이 없습니다 token=secret'),
    { code: 10, access_token: 'secret' },
  ));
  assert.deepEqual(Object.keys(safe), ['message', 'code']);
  assert.equal(safe.code, 10);
  assert.equal(safe.message.includes('secret'), false);
  assert.equal('access_token' in safe, false);
});
