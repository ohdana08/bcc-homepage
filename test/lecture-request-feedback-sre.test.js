import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { zipSync, strToU8 } from 'fflate';
import { StorageClient } from '@supabase/storage-js';
import { handleLectureRequest, normalizePayload, CONSENT_VERSION } from '../lib/lecture-request.js';
import { handleLectureRequestAttachments, normalizeAttachment, ATTACHMENT_CONSENT_VERSION } from '../lib/lecture-request-attachments.js';
import { createLectureFixture, createLocalServer, ADMIN_TOKEN, MEMBER_TOKEN } from '../scripts/lecture-request-local-server.mjs';

// Independent integration tests use the production handlers and synthetic I/O.
// Memory fixtures do not prove PostgreSQL locks, RLS, deployment or real Storage.
const PDF = Buffer.from('%PDF-1.7\n% synthetic institution form\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const BUCKET = 'lecture-request-forms';
const basePayload = () => ({ institution_name: '합성 교육원', contact_name: '합성 담당자', contact_email: 'fixture@example.invalid', audience: '기업 실무자', purpose: '업무 문서 작성', total_budget_range: '100~200만원', lecturer_fee_range: '50~100만원' });
function response() {
  return {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = structuredClone(value); return this; },
    send(value) { this.body = Buffer.from(value); return this; },
    end(value) { this.body = value === undefined ? undefined : Buffer.from(value); return this; },
  };
}
async function call(handler, db, body, { headers = {}, method = 'POST', deps = {} } = {}) {
  const res = response();
  await handler({ method, headers: { 'content-type': 'application/json', ...headers }, body, socket: { remoteAddress: '127.0.0.1' } }, res, { db, rateSecret: 'synthetic-feedback-rate', ...deps });
  return res;
}
const attach = (db, body, options) => call(handleLectureRequestAttachments, db, body, options);
async function submitted(db, payload = basePayload()) {
  const key = randomBytes(32).toString('base64url');
  const body = { action: 'submit', key, idempotency_key: randomUUID(), payload, consent: true, overseas_consent: true, consent_version: CONSENT_VERSION, website: '' };
  const res = await call(handleLectureRequest, db, body);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return { key, receipt: res.body.receipt, body };
}
const upload = (credentials, overrides = {}) => ({ action: 'upload', ...credentials, upload_id: randomUUID(), filename: '기관 서식.pdf', data_base64: PDF.toString('base64'), consent: true, consent_version: ATTACHMENT_CONSENT_VERSION, ...overrides });
const safeCredentials = ({ key, receipt }) => ({ key, receipt });
const APP = readFileSync(new URL('../lecture-request/app.js', import.meta.url), 'utf8');
function appBlock(start, end) {
  const a = APP.indexOf(start), b = APP.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Actual app boundary must exist');
  return APP.slice(a, b);
}

test('SRE actual app: old budget ranges and exact amounts survive restore and serialization', () => {
  const makeNode = () => ({ value: '', checked: false, classList: { toggle() {} }, append() {}, remove() {}, addEventListener() {} });
  const config = { numeric: true, rangeField: 'total_budget_range', options: ['미정·협의', '100만원 미만', '100~500만원', '500~1,000만원', '1,000만원 이상'] };
  const group = { config, inputs: [...config.options, '__custom'].map(value => ({ ...makeNode(), value })), original: makeNode(), customArea: makeNode(), fieldset: { querySelector: makeNode } };
  const context = vm.createContext({ document: { createElement: makeNode }, choiceGroups: new Map([['total_budget', group]]), form: {}, labels: { total_budget: '총 예산' }, numeric: new Set(['total_budget']), FormData: class { get() { return ''; } }, scheduleCandidates: () => [], scheduleLegacy: () => ({ lecture_date: '', time: '' }) });
  vm.runInContext(appBlock('  function payload()', '  function restore(data)') + appBlock('  function syncChoice(group)', '  function buildChoices()'), context);
  for (const old of [{ total_budget: null, total_budget_range: '100~200만원' }, { total_budget: null, total_budget_range: '200~300만원' }, { total_budget: 1200000, total_budget_range: '기관 기존 예산' }]) {
    context.saved = old;
    vm.runInContext('restoreChoices(saved); result=payload();', context);
    assert.equal(context.result.total_budget, old.total_budget);
    assert.equal(context.result.total_budget_range, old.total_budget_range);
  }
  group.original.value = '1300000';
  vm.runInContext('result=payload();', context);
  assert.equal(context.result.total_budget_range, '직접 입력');
  assert.equal(context.result.total_budget, 1300000);
});

test('SRE actual app: upload waits for consent and reconciles a lost success response by the stable ID', async () => {
  const db = createLectureFixture(), credentials = safeCredentials(await submitted(db));
  const request = upload(credentials), calls = [];
  let dropFirstResponse = true;
  const context = vm.createContext({
    attachmentBusy: false, attachmentConsentGranted: false, attachmentsLoaded: true, attachmentListError: '', savedAttachments: [],
    localAttachments: [{ id: request.upload_id, file: { name: request.filename, size: PDF.length }, status: 'selected', error: '' }],
    renderAttachments() {}, fileBase64: async () => request.data_base64,
    attachmentApi: async body => {
      calls.push(body.action);
      const res = await attach(db, body);
      if (res.statusCode >= 400) throw new Error(res.body.error);
      if (body.action === 'upload' && dropFirstResponse) { dropFirstResponse = false; throw new Error('Synthetic lost response'); }
      return res.body;
    },
    identifiers: credentials,
  });
  vm.runInContext(appBlock('  async function refreshAttachments(item)', '  function fileBase64(file)') + appBlock('  async function uploadAttachments(item)', '  async function downloadAttachment(item, button)'), context);
  await vm.runInContext('uploadAttachments(identifiers)', context);
  assert.deepEqual(calls, []); assert.equal(db.tables.lecture_request_attachments.length, 0);
  context.attachmentConsentGranted = true;
  await vm.runInContext('uploadAttachments(identifiers)', context);
  assert.deepEqual(calls, ['upload', 'list']);
  assert.equal(context.localAttachments[0].status, 'ready');
  assert.equal(context.attachmentBusy, false);
  await vm.runInContext('uploadAttachments(identifiers)', context);
  assert.deepEqual(calls, ['upload', 'list']);
  assert.equal(db.tables.lecture_requests.length, 1); assert.equal(db.tables.lecture_request_attachments.length, 1);
});

test('SRE feedback: five schedule candidates round-trip without choosing a confirmed date or numeric budget', async () => {
  const candidates = Array.from({ length: 5 }, (_, i) => ({ lecture_date: `2026-11-${String(i + 1).padStart(2, '0')}`, time: i === 0 ? '10:00~12:00' : '오후' }));
  const payload = { ...basePayload(), lecture_date: '2026-11-01', time: '10:00~12:00', schedule_candidates: candidates };
  const db = createLectureFixture(); const saved = await submitted(db, payload);
  const read = await call(handleLectureRequest, db, { action: 'get', ...safeCredentials(saved) });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.body.payload.schedule_candidates, candidates);
  assert.equal(read.body.payload.lecture_date, '');
  assert.equal(read.body.payload.time, '');
  assert.equal(read.body.payload.total_budget_range, payload.total_budget_range);
  assert.equal(read.body.payload.lecturer_fee_range, payload.lecturer_fee_range);
  assert.equal(read.body.payload.total_budget, null);
  assert.equal(read.body.payload.lecturer_fee, null);
  const update = await call(handleLectureRequest, db, { ...saved.body, action: 'update', receipt: saved.receipt, expected_revision: 1, payload: read.body.payload });
  assert.equal(update.statusCode, 200);
  assert.deepEqual(db.tables.lecture_requests[0].payload, read.body.payload);
});

test('SRE feedback: old single-date requests retain their scalar values when migrated to candidates', () => {
  const old = { ...basePayload(), lecture_date: '2026-11-01', time: '오전\n10:00~12:00' };
  const normalized = normalizePayload(old);
  assert.equal(normalized.lecture_date, old.lecture_date); assert.equal(normalized.time, old.time);
  assert.deepEqual(normalized.schedule_candidates, [{ lecture_date: old.lecture_date, time: old.time }]);
  assert.deepEqual(normalizePayload(normalized), normalized);
});

test('SRE feedback: malformed and over-limit schedule arrays cannot enter persistence', () => {
  const invalid = [null, '2026-11-01', {}, [null], [{ lecture_date: '2026-02-30', time: '오전' }], [{ lecture_date: '2026-11-01', time: 'a'.repeat(101) }], Array.from({ length: 6 }, () => ({ lecture_date: '2026-11-01', time: '오전' }))];
  for (const schedule_candidates of invalid) assert.throws(() => normalizePayload({ ...basePayload(), schedule_candidates }), undefined, JSON.stringify(schedule_candidates));
});

test('SRE attachments: filename, encoding and exact byte limit are enforced before Storage', () => {
  const result = normalizeAttachment('기관 서식.pdf', PDF.toString('base64'));
  assert.equal(result.size, PDF.length); assert.deepEqual(result.bytes, PDF);
  assert.equal(result.mime, 'application/pdf'); assert.match(result.sha256, /^[a-f0-9]{64}$/);
  for (const [filename, base64] of [['form.exe', PDF.toString('base64')], ['form.pdf', ''], ['form.pdf', 'not valid base64!'], ['form.pdf', Buffer.from('not a PDF').toString('base64')], ['form.pdf', Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString('base64')]]) {
    assert.throws(() => normalizeAttachment(filename, base64), undefined, filename);
  }
});

test('SRE attachments: Office ZIP allows document entries but rejects paths, macros and expanded-size abuse', () => {
  const entries = { '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<document/>') };
  const good = zipSync(entries);
  assert.equal(normalizeAttachment('기관 양식.docx', Buffer.from(good).toString('base64')).size, good.length);
  for (const key of ['../outside.txt', '/absolute.txt', 'word/vbaProject.bin', 'word\\bad.xml']) {
    const zip = zipSync({ ...entries, [key]: strToU8('synthetic') });
    assert.throws(() => normalizeAttachment('기관 양식.docx', Buffer.from(zip).toString('base64')), undefined, key);
  }
  const inflated = Buffer.from(good);
  const central = inflated.indexOf(Buffer.from('504b0102', 'hex'));
  assert.ok(central >= 0); inflated.writeUInt32LE(50 * 1024 * 1024 + 1, central + 24);
  assert.throws(() => normalizeAttachment('기관 양식.docx', inflated.toString('base64')));
});

test('SRE attachments: transport, consent and identity failures cannot write bytes', async () => {
  const db = createLectureFixture(), credentials = safeCredentials(await submitted(db));
  for (const [body, options, status] of [
    [upload(credentials, { consent: false }), {}, 400],
    [upload(credentials, { consent_version: 'obsolete' }), {}, 400],
    [upload(credentials, { object_path: 'other/path' }), {}, 400],
    [upload(credentials, { key: 'wrong' }), {}, 404],
    [upload(credentials), { method: 'GET' }, 405],
    [upload(credentials), { headers: { origin: 'https://other.invalid' } }, 403],
    [upload(credentials), { headers: { 'content-type': 'text/plain' } }, 415],
    [upload(credentials), { headers: { 'content-length': String(3 * 1024 * 1024 + 1) } }, 413],
    [upload(credentials), { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }, 403],
  ]) {
    const result = await attach(db, body, options);
    assert.equal(result.statusCode, status, JSON.stringify(result.body));
  }
  assert.equal(db.storage.calls.length, 0); assert.equal(db.tables.lecture_request_attachments.length, 0);
});

test('SRE attachments: public save/list/download retain exact bytes and exclude internal secrets', async () => {
  const db = createLectureFixture(); const credentials = safeCredentials(await submitted(db));
  const request = upload(credentials);
  const stored = await attach(db, request);
  assert.ok([200, 201].includes(stored.statusCode), JSON.stringify(stored.body));
  assert.equal(stored.body.attachment.id, request.upload_id);
  assert.equal(stored.body.attachment.status, 'ready');
  assert.equal(db.tables.lecture_request_attachments.length, 1);
  const listing = await attach(db, { action: 'list', ...credentials });
  assert.equal(listing.statusCode, 200);
  assert.deepEqual(Object.keys(listing.body.attachments[0]).sort(), ['id', 'mime', 'name', 'size', 'status']);
  const serialized = JSON.stringify(listing.body);
  assert.equal(serialized.includes(credentials.key), false);
  assert.equal(serialized.includes('object_path'), false);
  assert.equal(serialized.includes('sha256'), false);
  const download = await attach(db, { action: 'download', ...credentials, attachment_id: request.upload_id });
  assert.equal(download.statusCode, 200); assert.deepEqual(download.body, PDF);
  assert.match(download.headers['content-disposition'], /^attachment;/);
  assert.equal(download.headers['x-content-type-options'], 'nosniff');
  assert.match(download.headers['cache-control'], /no-store/);
  assert.equal(download.headers['referrer-policy'], 'no-referrer');
});

test('SRE attachments: same upload ID retries safely while changed bytes or names conflict', async () => {
  const db = createLectureFixture(); const credentials = safeCredentials(await submitted(db));
  const request = upload(credentials);
  assert.ok([200, 201].includes((await attach(db, request)).statusCode));
  assert.ok([200, 201].includes((await attach(db, request)).statusCode));
  assert.equal(db.tables.lecture_request_attachments.length, 1);
  assert.equal(db.storage.objects.size, 1);
  assert.equal((await attach(db, { ...request, filename: '다른 서식.pdf' })).statusCode, 409);
  assert.equal((await attach(db, { ...request, data_base64: Buffer.concat([PDF, Buffer.from('\nchanged')]).toString('base64') })).statusCode, 409);
  assert.deepEqual(db.storage.objects.values().next().value.bytes, PDF);
});

test('SRE attachments: uppercase public UUIDs match canonical PostgreSQL-style receipt and object paths', async () => {
  const db = createLectureFixture(), credentials = safeCredentials(await submitted(db));
  const request = upload({ ...credentials, receipt: credentials.receipt.toUpperCase() }, { upload_id: randomUUID().toUpperCase() });
  const stored = await attach(db, request);
  assert.ok([200, 201].includes(stored.statusCode), JSON.stringify(stored.body));
  const row = db.tables.lecture_request_attachments[0];
  assert.equal(row.receipt, credentials.receipt);
  assert.equal(row.id, request.upload_id.toLowerCase());
  assert.equal(row.object_path, `${credentials.receipt}/${request.upload_id.toLowerCase()}`);
  const download = await attach(db, { action: 'download', key: credentials.key, receipt: credentials.receipt.toUpperCase(), attachment_id: row.id.toUpperCase() });
  assert.equal(download.statusCode, 200); assert.deepEqual(download.body, PDF);
});

test('SRE attachments: pending reservations count toward the three-file cap and recover after outages', async () => {
  const db = createLectureFixture(); const credentials = safeCredentials(await submitted(db));
  db.storage.fail('upload');
  const requests = Array.from({ length: 3 }, (_, i) => upload(credentials, { filename: `기관서식${i}.pdf` }));
  for (const request of requests) assert.ok((await attach(db, request)).statusCode >= 400);
  assert.equal(db.tables.lecture_request_attachments.length, 3);
  assert.ok(db.tables.lecture_request_attachments.every(row => row.status === 'pending'));
  assert.equal((await attach(db, upload(credentials))).statusCode, 429);
  db.storage.recover();
  assert.ok([200, 201].includes((await attach(db, requests[0])).statusCode));
  assert.equal(db.tables.lecture_request_attachments.length, 3);
  assert.equal(db.tables.lecture_request_attachments[0].status, 'ready');
});

test('SRE attachments: bytes uploaded before ready-RPC failure are checked on retry without replacement', async () => {
  const db = createLectureFixture(); const credentials = safeCredentials(await submitted(db));
  const request = upload(credentials); const originalRpc = db.rpc;
  db.rpc = (name, args) => name === 'lecture_request_attachment_ready' ? Promise.resolve({ data: null, error: { message: 'synthetic-ready-failure' } }) : originalRpc(name, args);
  assert.ok((await attach(db, request)).statusCode >= 400);
  assert.equal(db.storage.objects.size, 1);
  assert.equal(db.tables.lecture_request_attachments[0].status, 'pending');
  db.rpc = originalRpc;
  db.storage.fail('download');
  assert.ok((await attach(db, request)).statusCode >= 400);
  assert.equal(db.tables.lecture_request_attachments[0].status, 'pending');
  db.storage.recover();
  assert.ok([200, 201].includes((await attach(db, request)).statusCode));
  assert.equal(db.storage.objects.size, 1);
  assert.equal(db.tables.lecture_request_attachments[0].status, 'ready');
});

test('SRE actual Storage SDK: error responses recover only when the exact reserved object matches', async t => {
  const changed = Buffer.from(PDF); changed[changed.length - 2] ^= 1;
  const cases = [
    { name: '409 ResourceAlreadyExists', status: 409, error: { code: 'ResourceAlreadyExists', message: 'The resource already exists' }, sdkCode: 'ResourceAlreadyExists', existing: PDF, expected: 201 },
    { name: 'legacy 400 Duplicate', status: 400, error: { statusCode: '400', error: 'Duplicate', message: 'The resource already exists' }, sdkCode: '400', existing: PDF, expected: 201 },
    { name: '500 response after successful persistence', status: 500, error: { code: 'InternalError', message: 'Synthetic lost success response' }, sdkCode: 'InternalError', existing: PDF, expected: 201 },
    { name: 'network exception after successful persistence', networkThrow: true, existing: PDF, expected: 201 },
    { name: 'same-size object with different SHA', status: 409, error: { code: 'ResourceAlreadyExists' }, sdkCode: 'ResourceAlreadyExists', existing: changed, expected: 409 },
    { name: 'error without any stored object', status: 500, error: { code: 'InternalError' }, sdkCode: 'InternalError', existing: null, expected: 503 },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const db = createLectureFixture(), credentials = safeCredentials(await submitted(db));
    const request = upload(credentials), calls = [], sdkErrors = [];
    const path = `/storage/v1/object/${BUCKET}/${credentials.receipt}/${request.upload_id}`;
    // The actual installed SDK receives fake fetch as its sole transport. The
    // reserved .invalid URL cannot reach a real host or use a service-role key.
    const sdk = new StorageClient('https://synthetic-storage.invalid/storage/v1', {}, async (input, options) => {
      const url = new URL(String(input));
      calls.push({ host: url.hostname, path: url.pathname, method: options.method });
      assert.equal(url.hostname, 'synthetic-storage.invalid'); assert.equal(url.pathname, path);
      if (options.method === 'POST') {
        assert.deepEqual(Buffer.from(options.body), PDF);
        assert.equal(options.headers['x-upsert'], 'false');
        if (scenario.networkThrow) throw new TypeError('Synthetic network result lost');
        return new Response(JSON.stringify(scenario.error), { status: scenario.status, headers: { 'content-type': 'application/json' } });
      }
      assert.equal(options.method, 'GET');
      return scenario.existing === null
        ? new Response(JSON.stringify({ code: 'NoSuchKey', message: 'Synthetic object absent' }), { status: 404, headers: { 'content-type': 'application/json' } })
        : new Response(scenario.existing, { status: 200, headers: { 'content-type': 'application/pdf' } });
    });
    db.storage = { from(bucket) {
      assert.equal(bucket, BUCKET);
      const real = sdk.from(bucket);
      return { download: path => real.download(path), upload: async (...args) => {
        const result = await real.upload(...args);
        sdkErrors.push(result.error);
        return result;
      } };
    } };
    const result = await attach(db, request);
    assert.equal(result.statusCode, scenario.expected, JSON.stringify(result.body));
    assert.deepEqual(calls.map(item => item.method), ['POST', 'GET']);
    assert.equal(sdkErrors.length, 1); assert.ok(sdkErrors[0]);
    if (!scenario.networkThrow) {
      assert.equal(sdkErrors[0].status, scenario.status);
      assert.equal(sdkErrors[0].statusCode, scenario.sdkCode);
    }
    const row = db.tables.lecture_request_attachments[0];
    assert.equal(row.status, scenario.expected === 201 ? 'ready' : 'pending');
    assert.equal(row.object_path, `${credentials.receipt}/${request.upload_id}`);
    assert.equal(db.tables.lecture_request_attachments.length, 1);
    assert.equal(db.calls.filter(item => item.rpc === 'lecture_request_attachment_ready').length, scenario.expected === 201 ? 1 : 0);
  });
});

test('SRE attachments: incorrect stored bytes never become a ready attachment', async () => {
  const db = createLectureFixture(); const credentials = safeCredentials(await submitted(db));
  const request = upload(credentials); const originalRpc = db.rpc;
  db.rpc = (name, args) => name === 'lecture_request_attachment_ready' ? Promise.resolve({ data: null, error: { message: 'synthetic-ready-failure' } }) : originalRpc(name, args);
  await attach(db, request); db.rpc = originalRpc;
  const stored = db.storage.objects.get(`${BUCKET}/${credentials.receipt}/${request.upload_id}`);
  stored.bytes = Buffer.from('incorrect bytes');
  const retry = await attach(db, request);
  assert.ok(retry.statusCode >= 400);
  assert.equal(db.tables.lecture_request_attachments[0].status, 'pending');
});

test('SRE attachments: different request, wrong key, expiry and non-admin tokens cannot access a form', async () => {
  const db = createLectureFixture(); const one = safeCredentials(await submitted(db)); const two = safeCredentials(await submitted(db));
  const request = upload(one); await attach(db, request);
  for (const credentials of [{ ...one, key: two.key }, { ...one, receipt: randomUUID() }]) {
    assert.equal((await attach(db, { action: 'list', ...credentials })).statusCode, 404);
    assert.equal((await attach(db, upload(credentials))).statusCode, 404);
  }
  assert.equal((await attach(db, { action: 'download', ...two, attachment_id: request.upload_id })).statusCode, 404);
  db.tables.lecture_requests.find(row => row.receipt === one.receipt).editable_until = '2000-01-01T00:00:00Z';
  assert.equal((await attach(db, { action: 'download', ...one, attachment_id: request.upload_id })).statusCode, 404);
  assert.equal((await attach(db, { action: 'list', receipt: one.receipt }, { headers: { authorization: `Bearer ${MEMBER_TOKEN}` } })).statusCode, 403);
  assert.equal((await attach(db, { action: 'list', receipt: one.receipt }, { headers: { authorization: 'Bearer invalid' } })).statusCode, 401);
  const admin = await attach(db, { action: 'download', receipt: one.receipt, attachment_id: request.upload_id }, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
  assert.equal(admin.statusCode, 200); assert.deepEqual(admin.body, PDF);
});

test('SRE attachments: local HTTP accepts a full-size upload and returns a binary download', async t => {
  const db = createLectureFixture(); const credentials = safeCredentials(await submitted(db));
  const server = await createLocalServer({ db, handler: (req, res) => handleLectureRequest(req, res, { db, rateSecret: 'synthetic' }), attachmentHandler: handleLectureRequestAttachments });
  t.after(() => server.close());
  const bytes = Buffer.alloc(2 * 1024 * 1024, 32); PDF.copy(bytes);
  const request = upload(credentials, { data_base64: bytes.toString('base64') });
  const result = await fetch(server.origin + '/api/lecture-request-attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  assert.ok([200, 201].includes(result.status), await result.text());
  const download = await fetch(server.origin + '/api/lecture-request-attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'download', ...credentials, attachment_id: request.upload_id }) });
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const tooLarge = await fetch(server.origin + '/api/lecture-request-attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list', ...credentials, extra: 'x'.repeat(65537) }) });
  assert.equal(tooLarge.status, 413);
});
