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

test('multiple-employer RSS compares real domestic conditions, drops closed and overseas jobs, and coalesces repeated links', async t => {
  const item = (id, country, end='채용시') => `<item><title><![CDATA[[병원${id}] 간호사 채용]]></title><link>https://job.incruit.com/jobdb_info/jobpost.asp?job=${id}</link><description><![CDATA[▨ 회사명 : 병원${id}<br>▨ 경력 : 신입<br>▨ 학력 : 대졸↑<br>▨ 지역 : |${country}<br>▨ 마감일 : ${end}<br>]]></description><pubDate>Sun, 02 Nov 2025 12:00:00 +0900</pubDate></item>`;
  const examples = item(1,'경기>수원시')+item(1,'경기>수원시')+item(2,'일본')+item(3,'부산','11/11(화)')+item(4,'충남');
  const requests = [];
  t.mock.method(globalThis,'fetch',async url => {
    requests.push(String(url));
    if (String(url).startsWith('https://www.incruit.com/rss/')) return new Response('<rss><channel>'+examples+'</channel></rss>');
    throw new Error('Other sources down');
  });
  const res = response();
  await handler({method:'GET',query:{q:'간호사,PRIVATE_TEXT'}},res);
  assert.equal(res.code,200);
  assert.equal(res.data.jobs.length,2);
  assert.deepEqual(res.data.jobs[0].requirements,['경력 : 신입','학력 : 대졸↑']);
  assert.equal(res.data.jobs[0].location,'경기 수원시');
  assert.deepEqual(res.data.sources[0],{name:'인크루트',count:2,status:'ok'});
  assert.equal(requests.filter(u=>u.includes('incruit.com')).length,1);
  assert.ok(requests.includes('https://www.incruit.com/rss/job.asp?occ1=190'));
  assert.ok(requests.every(u=>!u.includes('PRIVATE_TEXT')));
});
