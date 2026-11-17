import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDdakfitRecommendations } from '../lib/ddakfit-recommendations.js';

const input = { age: '30_39', region: '부산', business: 'under_3', industry: 'manufacturing' };
const card = { id: 'real-123', title: '시제품 제작 지원', description: '공고 설명', who: '중소기업', amount: '공고 확인', deadline: '2026-12-01', url: 'https://www.bizinfo.go.kr/example?id=123', previewUrl: 'https://evil.example/phish' };
async function run(options = {}) {
  const calls = [];
  const req = { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://bccconsulting.kr', cookie: 'private', authorization: 'Bearer private', ...options.headers }, body: options.body === undefined ? input : options.body, ...options.req };
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handleDdakfitRecommendations(req, res, {
    env: { NODE_ENV: 'production', ...options.env },
    fetchImpl: async (...args) => {
      calls.push(args);
      if (options.reject) throw options.reject;
      return options.response || new Response(JSON.stringify(options.data || { total: 1, results: [card] }), { status: options.status || 200 });
    },
  });
  return { ...res, calls };
}

test('forwards only enumerated conditions to the fixed endpoint, reconstructs safe diagnosis URL', async () => {
  const result = await run({ body: { ...input, email: 'private@example.test', url: 'https://evil.example', token: 'private' } });
  assert.equal(result.code, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  const [url, request] = result.calls[0];
  assert.equal(url, 'https://ddakfit.bccconsulting.kr/api/entry/results');
  assert.deepEqual(JSON.parse(request.body), input);
  assert.deepEqual(request.headers, { 'Content-Type': 'application/json', Accept: 'application/json' });
  assert.equal(request.redirect, 'error');
  assert.ok(request.signal instanceof AbortSignal);
  assert.equal(result.body.results[0].previewUrl, 'https://ddakfit.bccconsulting.kr/embed?start=direct&noticeUrl=' + encodeURIComponent(card.url));
  assert.ok(!JSON.stringify(result.body).includes('evil.example'));
});

test('invalid methods, origins, formats, conditions and oversized bodies make no upstream call', async () => {
  for (const [options, code] of [
    [{ req: { method: 'GET' } }, 405],
    [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { origin: 'https://bccconsulting.kr.evil.example' } }, 403],
    [{ headers: { origin: 'http://localhost:8900' } }, 403],
    [{ headers: { 'sec-fetch-site': 'cross-site', origin: undefined } }, 403],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: '{' }, 400], [{ body: [] }, 400], [{ body: null }, 400],
    [{ body: { ...input, age: 30 } }, 400], [{ body: { ...input, region: 'unknown' } }, 400],
    [{ body: { ...input, industry: 'https://evil.example' } }, 400],
    [{ body: { ...input, business: '' } }, 400],
    [{ headers: { 'content-length': '2049' } }, 413],
    [{ body: 'x'.repeat(2049) }, 413],
    [{ body: { ...input, extra: 'x'.repeat(2049) } }, 413],
  ]) {
    const result = await run(options);
    assert.equal(result.code, code, JSON.stringify(options));
    assert.equal(result.calls.length, 0);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});

test('exact configured preview, production, local development and missing Origin work', async () => {
  for (const options of [
    { headers: { origin: 'https://www.bccconsulting.kr' } },
    { headers: { origin: 'https://bcc-abc.vercel.app' }, env: { VERCEL_URL: 'bcc-abc.vercel.app' } },
    { headers: { origin: 'http://localhost:8900' }, env: { NODE_ENV: 'development' } },
    { headers: { origin: undefined } },
    { body: Buffer.from(JSON.stringify(input)) },
  ]) assert.equal((await run(options)).code, 200);
  assert.equal((await run({ headers: { origin: 'https://other.vercel.app' }, env: { VERCEL_URL: 'bcc-abc.vercel.app' } })).code, 403);
});

test('upstream failure, timeout, malformed and inconsistent results never become empty success', async () => {
  for (const options of [
    { status: 500 }, { reject: new DOMException('private failure', 'TimeoutError') },
    { response: new Response('not json') },
    { response: new Response('x', { headers: { 'content-length': '200001' } }) },
    { response: new Response('x'.repeat(200001)) },
    { data: { total: 4, results: [] } },
    { data: { total: -1, results: [] } },
    { data: { total: 0, results: [card] } },
    { data: { total: 2, results: [card, card] } },
    { data: { total: 1, results: [{ ...card, who: null }] } },
    { data: { total: 1, results: [{ ...card, title: '' }] } },
  ]) {
    const result = await run(options);
    assert.equal(result.code, 503);
    assert.deepEqual(Object.keys(result.body), ['error']);
    assert.ok(!JSON.stringify(result.body).includes('private failure'));
  }
});

test('unsafe source URLs fail closed instead of linking to scripts, local hosts or credentials', async () => {
  for (const url of ['javascript:alert(1)', 'http://agency.go.kr/', 'https://user:password@agency.go.kr/', 'https://127.0.0.1/', 'https://localhost/', 'https://a.local/', 'https://a.internal/', 'https://agency.go.kr:8443/']) {
    assert.equal((await run({ data: { total: 1, results: [{ ...card, url }] } })).code, 503, url);
  }
});

test('genuine no-match and top-three results retain the real count', async () => {
  const empty = await run({ data: { total: 0, results: [] } });
  assert.equal(empty.code, 200);
  assert.deepEqual(empty.body, { total: 0, results: [] });
  const found = await run({ data: { total: 24, results: [1, 2, 3].map((id) => ({ ...card, id: String(id) })) } });
  assert.equal(found.code, 200);
  assert.equal(found.body.total, 24);
  assert.equal(found.body.results.length, 3);
});
