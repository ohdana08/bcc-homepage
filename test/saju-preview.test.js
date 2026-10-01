import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSajuAdmin } from '../lib/saju-preview/handler.js';

const USER_ID = 'f3fe9926-3370-43a6-8225-b98823cc8dfa';
const TOKEN = 'test-access.header.signature';
const PRIVATE_HTML = '<!doctype html><html><body>PRIVATE_SAJU_APP<script>window.privateEngine = true</script></body></html>';
const adminHeaders = { authorization: `Bearer ${TOKEN}` };

function fixture({ authError = null, user = { id: USER_ID, user_metadata: { is_admin: true } }, profile = { is_admin: true }, profileError = null, authThrows, profileThrows, loadThrows, html = PRIVATE_HTML } = {}) {
  const calls = [];
  const db = {
    auth: {
      async getUser(token) {
        calls.push(['auth', token]);
        if (authThrows) throw authThrows;
        return { data: { user }, error: authError };
      },
    },
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) { calls.push(['select', columns]); return this; },
        eq(column, value) { calls.push(['eq', column, value]); return this; },
        async maybeSingle() {
          calls.push(['profile']);
          if (profileThrows) throw profileThrows;
          return { data: profile, error: profileError };
        },
      };
    },
  };
  const loadHtml = async () => {
    calls.push(['html']);
    if (loadThrows) throw loadThrows;
    return html;
  };
  return { calls, db, loadHtml };
}

async function call(dependencies, request = {}) {
  const req = { method: 'GET', headers: adminHeaders, query: {}, ...request };
  const res = {
    code: 200, headers: {}, body: undefined, kind: undefined,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; this.kind = 'json'; return this; },
    send(body) { this.body = body; this.kind = 'html'; return this; },
  };
  await handleSajuAdmin(req, res, dependencies);
  return res;
}

function assertPrivateHeaders(res) {
  assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0');
  assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
  assert.equal(res.headers['CDN-Cache-Control'], 'no-store');
  assert.equal(res.headers.Vary, 'Authorization');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
}

function assertNoApp(res) {
  assert.equal(res.kind, 'json');
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_SAJU_APP|privateEngine|test-access|signature/);
  assert.equal(res.headers['Content-Type'], undefined);
  assertPrivateHeaders(res);
}

test('사주 HTML은 getUser와 현재 관리자 프로필을 순서대로 확인한 뒤에만 로드한다', async () => {
  const dependencies = fixture();
  const res = await call(dependencies);
  assert.equal(res.code, 200);
  assert.equal(res.kind, 'html');
  assert.equal(res.body, PRIVATE_HTML);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assertPrivateHeaders(res);
  assert.deepEqual(dependencies.calls, [
    ['auth', TOKEN], ['from', 'profiles'], ['select', 'is_admin'],
    ['eq', 'id', USER_ID], ['profile'], ['html'],
  ]);
});

test('로그인 헤더가 없으면 URL·쿠키·본문의 토큰과 관리자 플래그로 인증하지 않는다', async () => {
  const dependencies = fixture();
  const res = await call(dependencies, {
    headers: { cookie: `access_token=${TOKEN}` },
    query: { token: TOKEN, access_token: TOKEN, is_admin: 'true' },
    body: { token: TOKEN, is_admin: true },
  });
  assert.equal(res.code, 401);
  assert.deepEqual(dependencies.calls, []);
  assertNoApp(res);
});

test('잘못된 Bearer 형식과 중복 헤더는 인증 서버나 HTML 로더에 전달하지 않는다', async () => {
  for (const authorization of [undefined, null, '', TOKEN, `Basic ${TOKEN}`, 'Bearer', 'Bearer ', `Bearer  ${TOKEN}`, `Bearer\t${TOKEN}`, ` Bearer ${TOKEN}`, `Bearer ${TOKEN} `, `Bearer ${TOKEN}\n`, `Bearer ${TOKEN}\r`, `Bearer ${TOKEN}\r\n`, `Bearer ${TOKEN}\r\nX-Foo: yes`, `Bearer ${TOKEN}, Bearer another`, [`Bearer ${TOKEN}`], 'Bearer 한글', 'Bearer abc=def']) {
    const dependencies = fixture();
    const res = await call(dependencies, { headers: { authorization } });
    assert.equal(res.code, 401, `invalid authorization: ${JSON.stringify(authorization)}`);
    assert.deepEqual(dependencies.calls, []);
    assertNoApp(res);
  }
  const dependencies = fixture();
  const res = await call(dependencies, { rawHeaders: ['Authorization', `Bearer ${TOKEN}`, 'authorization', 'Bearer another'] });
  assert.equal(res.code, 401);
  assert.deepEqual(dependencies.calls, []);
  assertNoApp(res);
});

test('HTTP 인증 스킴 대소문자는 허용하되 URL 토큰은 헤더 토큰을 대체하지 않는다', async () => {
  const dependencies = fixture();
  const res = await call(dependencies, { headers: { authorization: `bEaReR ${TOKEN}` }, query: { access_token: 'other-user-token' } });
  assert.equal(res.code, 200);
  assert.deepEqual(dependencies.calls[0], ['auth', TOKEN]);
});

test('GET 외 요청은 HEAD를 포함해 DB 조회나 HTML 로드 없이 405로 종료한다', async () => {
  for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', undefined]) {
    const dependencies = fixture();
    const res = await call(dependencies, { method });
    assert.equal(res.code, 405);
    assert.equal(res.headers.Allow, 'GET');
    assert.deepEqual(dependencies.calls, []);
    assertNoApp(res);
  }
});

test('거절되거나 사용자가 없는 인증 결과는 프로필과 앱을 읽지 않는다', async () => {
  for (const options of [{ authError: new Error('sensitive auth detail') }, { user: null }, { user: {} }, { user: { id: '' } }, { user: { id: 42 } }]) {
    const dependencies = fixture(options);
    const res = await call(dependencies);
    assert.equal(res.code, 401);
    assert.deepEqual(dependencies.calls, [['auth', TOKEN]]);
    assertNoApp(res);
    assert.doesNotMatch(JSON.stringify(res.body), /sensitive/);
  }
});

test('관리자 권한은 profiles.is_admin의 boolean true만 인정하고 사용자 메타데이터를 신뢰하지 않는다', async () => {
  for (const profile of [null, {}, { is_admin: false }, { is_admin: 'true' }, { is_admin: 1 }, { is_admin: null }]) {
    const dependencies = fixture({ profile });
    const res = await call(dependencies);
    assert.equal(res.code, 403);
    assert.equal(dependencies.calls.some(([operation]) => operation === 'html'), false);
    assertNoApp(res);
  }
});

test('프로필 조회 오류는 권한 없음으로 오인하거나 앱을 노출하지 않고 일반화한 503을 반환한다', async () => {
  const dependencies = fixture({ profileError: { message: 'sensitive database query' } });
  const res = await call(dependencies);
  assert.equal(res.code, 503);
  assert.equal(dependencies.calls.some(([operation]) => operation === 'html'), false);
  assertNoApp(res);
  assert.doesNotMatch(JSON.stringify(res.body), /sensitive|database/);
});

test('인증·DB·앱 로드 예외의 메시지와 임의 status를 응답에 반영하지 않는다', async () => {
  for (const failure of ['authThrows', 'profileThrows', 'loadThrows']) {
    const dependencies = fixture({ [failure]: Object.assign(new Error(`${PRIVATE_HTML} internal-secret`), { status: 200 }) });
    const res = await call(dependencies);
    assert.equal(res.code, 503);
    assertNoApp(res);
    assert.doesNotMatch(JSON.stringify(res.body), /internal-secret/);
    if (failure !== 'loadThrows') assert.equal(dependencies.calls.some(([operation]) => operation === 'html'), false);
  }
});

test('앱 로더가 누락됐거나 비어 있는 비문자열 산출물을 반환해도 fail closed 한다', async () => {
  for (const html of ['', ' \n ', null, { html: PRIVATE_HTML }, Buffer.from(PRIVATE_HTML)]) {
    const res = await call(fixture({ html }));
    assert.equal(res.code, 503);
    assertNoApp(res);
  }
  const dependencies = fixture();
  delete dependencies.loadHtml;
  const res = await call(dependencies);
  assert.equal(res.code, 503);
  assertNoApp(res);
});

test('이전 요청에서 관리자였어도 다음 요청의 권한 철회 결과를 다시 검사한다', async () => {
  const profile = { is_admin: true };
  const dependencies = fixture({ profile });
  assert.equal((await call(dependencies)).code, 200);
  profile.is_admin = false;
  const denied = await call(dependencies);
  assert.equal(denied.code, 403);
  assert.equal(dependencies.calls.filter(([operation]) => operation === 'auth').length, 2);
  assert.equal(dependencies.calls.filter(([operation]) => operation === 'profile').length, 2);
  assert.equal(dependencies.calls.filter(([operation]) => operation === 'html').length, 1);
  assertNoApp(denied);
});
