import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/job-compare-list.js';

const posting = {
  title: '데이터 분석가', internal_job_id: 1, location: { name: 'Seoul, South Korea' },
  absolute_url: 'https://example.org/jobs/123',
  content: '&lt;h3&gt;필수요건&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;SQL로 매출을 분석한 경험&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;우대사항&lt;/p&gt;&lt;li&gt;영어로 협업할 수 있는 분&lt;/li&gt;',
};

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(data) { this.data = data; } };
}

test('one board failure preserves Korean-market openings and isolates qualification text', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('moloco')) throw new Error('timeout');
    const jobs = url.includes('krafton') ? [posting, { ...posting, location: { name: 'Tokyo' } }, { ...posting, title: '채용관심등록' }] : [];
    return Response.json({ jobs });
  });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.partial, true);
  assert.equal(res.data.jobs.length, 1);
  assert.deepEqual(res.data.jobs[0].requirements, ['SQL로 매출을 분석한 경험']);
});

test('total board failure is distinct from an empty list of open jobs', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('temporarily unavailable', { status: 503 }));
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 503);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
