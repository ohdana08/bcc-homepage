import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { handleLectureRequest, CONSENT_VERSION } from '../lib/lecture-request.js';
import { handleTrainingNeedsPublic } from '../lib/training-needs.js';
import { createLectureFixture, createLocalServer, ADMIN_TOKEN, MEMBER_TOKEN } from '../scripts/lecture-request-local-server.mjs';

// This file tests the real JS handlers against synthetic database I/O.
// It does not prove PostgreSQL locking/RLS or a production deployment.
const payload = overrides => ({ institution_name: '합성 검토 교육원', contact_name: '합성 담당자', contact_email: 'synthetic@example.invalid', audience: '성인 교육 담당자', purpose: '교육 업무용 자료 만들기', project_name: '합성 AI 실습', ...overrides });
const submission = overrides => ({ action: 'submit', key: randomBytes(32).toString('base64url'), idempotency_key: randomUUID(), consent: true, overseas_consent: true, consent_version: CONSENT_VERSION, website: '', payload: payload(), ...overrides });
function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = structuredClone(value); return this; } };
}
async function call(db, body, { method = 'POST', headers = {}, deps = {} } = {}) {
  const res = response();
  await handleLectureRequest({ method, headers: { 'content-type': 'application/json', ...headers }, body, socket: { remoteAddress: '127.0.0.1' } }, res, { db, rateSecret: 'synthetic-fixture-only', ...deps });
  return res;
}
const admin = { authorization: `Bearer ${ADMIN_TOKEN}` };
async function submitted(db, overrides) {
  const body = submission(overrides);
  const result = await call(db, body);
  assert.equal(result.statusCode, 201);
  return { body, receipt: result.body.receipt, result };
}

test('lecture request: rejects malformed public requests before any database operation', async t => {
  const cases = [
    ['wrong method', submission(), { method: 'GET' }, 405],
    ['untrusted origin', submission(), { headers: { origin: 'https://example.invalid' } }, 403],
    ['non JSON content', submission(), { headers: { 'content-type': 'text/plain' } }, 415],
    ['oversized content', submission(), { headers: { 'content-length': '40001' } }, 413],
    ['malformed JSON', '{', {}, 400],
    ['array body', [], {}, 400],
    ['bad secret', submission({ key: 'guess' }), {}, 404],
    ['bad receipt', { action: 'get', key: randomBytes(32).toString('base64url'), receipt: 'guess' }, {}, 400],
    ['missing consent', submission({ consent: false }), {}, 400],
    ['missing overseas consent', submission({ overseas_consent: false }), {}, 400],
    ['obsolete consent', submission({ consent_version: 'older' }), {}, 400],
    ['honeypot', submission({ website: 'spam' }), {}, 400],
    ['owner override', submission({ owner_id: randomUUID() }), {}, 400],
    ['case override', submission({ case_id: randomUUID() }), {}, 400],
    ['institution override', submission({ institution_id: randomUUID() }), {}, 400],
    ['privilege in payload', submission({ payload: payload({ status: 'won' }) }), {}, 400],
    ['impossible date', submission({ payload: payload({ lecture_date: '2026-02-30' }) }), {}, 400],
    ['invalid recipient', submission({ payload: payload({ contact_email: 'not-email' }) }), {}, 400],
    ['fractional people', submission({ payload: payload({ audience_size: 1.5 }) }), {}, 400],
    ['negative budget', submission({ payload: payload({ total_budget: -1 }) }), {}, 400],
    ['infinite budget', submission({ payload: payload({ total_budget: Infinity }) }), {}, 400],
    ['empty purpose', submission({ payload: payload({ purpose: '  ' }) }), {}, 400],
    ['overlong memo', submission({ payload: payload({ special_notes: 'a'.repeat(2001) }) }), {}, 400],
  ];
  for (const [name, body, options, expected] of cases) await t.test(name, async () => {
    const db = createLectureFixture(); const result = await call(db, body, options);
    assert.equal(result.statusCode, expected, JSON.stringify(result.body));
    assert.equal(db.calls.length, 0);
  });
});

test('lecture request: stores only hashed secret/IP and returns a small private receipt', async () => {
  const db = createLectureFixture();
  const { body, result } = await submitted(db, { payload: payload({ total_budget: '0', audience_size: '', lecture_date: '' }) });
  assert.deepEqual(Object.keys(result.body).sort(), ['duplicate', 'ok', 'receipt', 'revision']);
  assert.equal(result.headers['cache-control'], 'no-store, private');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.equal(db.tables.lecture_requests[0].key_hash, createHash('sha256').update(body.key).digest('hex'));
  assert.equal(JSON.stringify(db.calls).includes(body.key), false);
  assert.equal(JSON.stringify(db.calls).includes('127.0.0.1'), false);
  assert.equal(db.tables.proposal_cases[0].institution_id, null);
  assert.equal(db.tables.lecture_requests[0].payload.total_budget, 0);
  assert.equal(db.tables.lecture_requests[0].payload.audience_size, null);
});

test('lecture request: duplicate retry recovers the receipt with the same secret while preserving original saved input', async () => {
  const db = createLectureFixture(); const { body, receipt } = await submitted(db);
  const repeated = await call(db, body);
  assert.equal(repeated.statusCode, 200); assert.equal(repeated.body.receipt, receipt); assert.equal(repeated.body.duplicate, true);
  const wrongKey = await call(db, { ...body, key: randomBytes(32).toString('base64url') });
  const changedPayload = await call(db, { ...body, payload: payload({ purpose: '응답 유실 뒤 입력한 변경' }) });
  assert.equal(wrongKey.statusCode, 409); assert.equal(changedPayload.statusCode, 200);
  assert.equal(changedPayload.body.receipt, receipt); assert.equal(changedPayload.body.duplicate, true);
  assert.equal(db.tables.lecture_requests[0].payload.purpose, body.payload.purpose);
  assert.equal(db.tables.lecture_requests[0].revision, 1);
  assert.equal(db.tables.lecture_request_revisions.length, 1);
  assert.equal(JSON.stringify(wrongKey.body).includes(receipt), false);
  assert.equal(db.tables.proposal_cases.length, 1); assert.equal(db.tables.lecture_requests.length, 1);
});

test('lecture request: identical institution names remain separate requests until an admin links them', async () => {
  const db = createLectureFixture(); await submitted(db); await submitted(db);
  assert.equal(db.tables.proposal_cases.length, 2);
  assert.equal(db.tables.lecture_institutions.length, 0);
  assert.ok(db.tables.proposal_cases.every(row => row.institution_id === null));
});

test('lecture request: budget range selections remain text without inferring exact numeric amounts', async () => {
  const db = createLectureFixture();
  const { body, receipt } = await submitted(db, { payload: payload({ total_budget_range: '100만~300만원', lecturer_fee_range: '아직 미정 · 협의 필요' }) });
  const read = await call(db, { action: 'get', receipt, key: body.key });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.payload.total_budget_range, '100만~300만원');
  assert.equal(read.body.payload.lecturer_fee_range, '아직 미정 · 협의 필요');
  assert.equal(read.body.payload.total_budget, null);
  assert.equal(read.body.payload.lecturer_fee, null);
  assert.equal(db.tables.proposal_cases[0].budget, null);
});

test('lecture request: edit access rejects wrong keys, other receipts and expired links without leaking private fields', async () => {
  const db = createLectureFixture(); const { body, receipt } = await submitted(db);
  const read = await call(db, { action: 'get', receipt, key: body.key });
  assert.equal(read.statusCode, 200); assert.equal(read.body.payload.contact_email, payload().contact_email);
  assert.deepEqual(Object.keys(read.body).sort(), ['editable_until', 'payload', 'receipt', 'revision']);
  for (const request of [
    { action: 'get', receipt, key: randomBytes(32).toString('base64url') },
    { action: 'get', receipt: randomUUID(), key: body.key },
  ]) {
    const result = await call(db, request); assert.equal(result.statusCode, 404);
    assert.equal(JSON.stringify(result.body).includes(payload().contact_email), false);
  }
  db.tables.lecture_requests[0].editable_until = '2000-01-01T00:00:00.000Z';
  assert.equal((await call(db, { action: 'get', receipt, key: body.key })).statusCode, 404);
});

test('lecture request: revision contract preserves one winning update and makes a lost-response retry safe', async () => {
  const db = createLectureFixture(); const { body, receipt } = await submitted(db);
  const update = { ...body, action: 'update', receipt, expected_revision: 1, payload: payload({ purpose: '수정된 교육 목적' }) };
  const good = await call(db, update); assert.equal(good.statusCode, 200); assert.equal(good.body.revision, 2);
  const retry = await call(db, update); assert.equal(retry.statusCode, 200); assert.equal(retry.body.duplicate, true);
  const stale = await call(db, { ...update, payload: payload({ purpose: '다른 창 변경' }) });
  assert.equal(stale.statusCode, 409); assert.equal(db.tables.lecture_request_revisions.length, 2);
  assert.equal(db.tables.lecture_requests[0].payload.purpose, '수정된 교육 목적');
  assert.equal((await call(db, { ...update, expected_revision: '2' })).statusCode, 400);
});

test('lecture request: actual handler propagates bounded rate limit and storage failure without raw errors', async () => {
  const db = createLectureFixture(); const body = submission();
  for (let n = 0; n < 20; n++) assert.ok([200, 201].includes((await call(db, body)).statusCode));
  assert.equal((await call(db, body)).statusCode, 429); assert.equal(db.tables.proposal_cases.length, 1);
  const unavailable = createLectureFixture(); unavailable.fail({ message: 'secret-database-connection-string', code: 'SYNTHETIC' });
  const result = await call(unavailable, submission());
  assert.equal(result.statusCode, 503); assert.equal(JSON.stringify(result.body).includes('secret-database'), false);
  assert.equal(unavailable.tables.proposal_cases.length, 0);
});

test('lecture request: admin actions deny anonymous, invalid and non-admin identities', async t => {
  for (const action of ['list', 'create_institution', 'link_institution', 'ensure_survey']) await t.test(action, async () => {
    const db = createLectureFixture();
    assert.equal((await call(db, { action })).statusCode, 401);
    assert.equal(db.calls.length, 0);
    assert.equal((await call(db, { action }, { headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
    assert.equal((await call(db, { action }, { headers: { authorization: `Bearer ${MEMBER_TOKEN}` } })).statusCode, 403);
    assert.equal(db.tables.lecture_institutions.length, 0); assert.equal(db.tables.training_need_surveys.length, 0);
  });
});

test('lecture request: admin-confirmed institution groups multiple lectures and admin list excludes hashes', async () => {
  const db = createLectureFixture(); await submitted(db); await submitted(db);
  const institution = await call(db, { action: 'create_institution', name: '합성 검토 교육원 / 본원' }, { headers: admin });
  assert.equal(institution.statusCode, 201);
  for (const lecture of db.tables.proposal_cases) {
    const result = await call(db, { action: 'link_institution', case_id: lecture.id, institution_id: institution.body.institution.id }, { headers: admin });
    assert.equal(result.statusCode, 200);
  }
  const list = await call(db, { action: 'list' }, { headers: admin });
  assert.equal(list.statusCode, 200); assert.equal(list.body.cases.length, 2); assert.equal(list.body.institutions.length, 1);
  assert.ok(list.body.cases.every(row => row.institution_id === institution.body.institution.id));
  assert.ok(list.body.requests.every(row => !Object.hasOwn(row, 'key_hash') && !Object.hasOwn(row, 'idempotency_key')));
  assert.equal((await call(db, { action: 'link_institution', case_id: randomUUID(), institution_id: institution.body.institution.id }, { headers: admin })).statusCode, 404);
});

test('lecture request: existing learner handler accepts linked survey and aggregates anonymous responses', async () => {
  const db = createLectureFixture(); await submitted(db);
  const caseId = db.tables.proposal_cases[0].id;
  const first = await call(db, { action: 'ensure_survey', case_id: caseId }, { headers: admin });
  const second = await call(db, { action: 'ensure_survey', case_id: caseId }, { headers: admin });
  assert.equal(first.statusCode, 200); assert.equal(first.body.survey.id, second.body.survey.id);
  assert.equal(db.tables.training_need_surveys.length, 1); assert.equal(first.body.survey.case_id, caseId);
  assert.match(first.body.url, /^https:\/\/bccconsulting\.kr\/tools\/training-needs\/\?form=/);
  const publicRead = response();
  await handleTrainingNeedsPublic({ body: { action: 'get', form: first.body.survey.public_code } }, publicRead, { db });
  assert.equal(publicRead.statusCode, 200);
  assert.equal(JSON.stringify(publicRead.body).includes(payload().contact_email), false);
  const answer = { action: 'submit', form: first.body.survey.public_code, idempotency_key: randomUUID(), answers: { current_context: ['office_admin'], ai_experience: 'simple_questions', ai_tool_access: ['chatgpt:free'], work_tasks: ['documents'], pain_points: ['what_to_ask'], desired_topics: ['prompt_basics'], desired_outputs: ['work_document'], learning_methods: ['step_by_step'], open_question: '문서 초안을 잘 만들고 싶습니다.', others: {} } };
  const submittedAnswer = response(); await handleTrainingNeedsPublic({ body: answer }, submittedAnswer, { db });
  assert.equal(submittedAnswer.statusCode, 201);
  const list = await call(db, { action: 'list' }, { headers: admin });
  assert.equal(list.body.surveys[0].response_count, 1);
  assert.equal(list.body.surveys[0].is_sample, true);
  assert.equal(Object.hasOwn(db.tables.training_need_responses[0], 'contact_email'), false);
});

test('lecture request: loopback HTTP round-trip uses the real handlers and never serves private source files', async t => {
  const db = createLectureFixture();
  const local = await createLocalServer({ db, handler: (req, res) => handleLectureRequest(req, res, { db, rateSecret: 'synthetic-only' }) });
  t.after(local.close);
  const body = submission();
  const result = await fetch(`${local.origin}/api/lecture-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(result.status, 201); const receipt = (await result.json()).receipt;
  const read = await fetch(`${local.origin}/api/lecture-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get', receipt, key: body.key }) });
  assert.equal(read.status, 200); assert.equal((await read.json()).payload.institution_name, payload().institution_name);
  for (const route of ['/lib/lecture-request.js', '/supabase/lecture-request.sql', '/.git', '/package.json', '/api/unknown']) {
    assert.equal((await fetch(local.origin + route)).status, 404, route);
  }
  assert.equal((await fetch(`${local.origin}/api/lecture-request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' }, body: JSON.stringify(body) })).status, 403);
  const learnerPage = await fetch(`${local.origin}/tools/training-needs/?form=SYNTHETIC`);
  assert.equal(learnerPage.status, 200);
  assert.match(learnerPage.headers.get('content-security-policy'), /connect-src 'self'/);
  const learnerHtml = await learnerPage.text();
  assert.ok(learnerHtml.indexOf('window.BCC_API_BASE=location.origin') < learnerHtml.indexOf('src="../../pay-config.js"'));
  const localConfig = await (await fetch(`${local.origin}/pay-config.js`)).text();
  assert.match(localConfig, /BCC_API_BASE=location.origin/);
  assert.equal(localConfig.includes('bcc-homepage.vercel.app'), false);
  assert.match(localConfig, /BCC_GA_ID=""/);
  const mobilePage = await fetch(`${local.origin}/__fixture/mobile`);
  assert.equal(mobilePage.status, 200);
  assert.match(mobilePage.headers.get('content-security-policy'), /frame-src 'self'; connect-src 'none'/);
  const mobileHtml = await mobilePage.text();
  assert.match(mobileHtml, /src="\/lecture-request\/" width="390" height="844"/);
  assert.equal(mobileHtml.includes('https://'), false);
});
