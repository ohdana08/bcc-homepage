import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProjectInstructionUsage } from '../lib/project-instruction/telemetry-handler.js';
import { normalizeUsageEvent, normalizeUsageOwner, USAGE_POLICY_VERSION } from '../lib/project-instruction/telemetry-model.js';
import { hash } from '../lib/project-instruction/model.js';

const ID = 'cd7a4a88-171b-4245-ab6f-85b27c6a419d';
const EVENT_ID = '208fdde1-1639-40c2-b3b2-bd2d971a24c6';
const TOKEN = 'a1'.repeat(32), WRITE = 'b2'.repeat(32), NOW = '2026-10-02T00:00:00.000Z';
const EVENT = { eventId: EVENT_ID, mode: 'live', outcome: 'completed', durationMs: 1234, review: 'not_reviewed', endUserConsent: true };
const CONSENT = { version: USAGE_POLICY_VERSION, usage: true, overseas: true, ownUse: true, age14: true };
const DETAIL = { connection: { submissionId: ID, consentAt: NOW, expiresAt: '2029-10-01T00:00:00.000Z', revokedAt: null, generation: 1 }, stats: { liveCount: 1, testCount: 0 }, events: [{ ...EVENT, receivedAt: NOW }] };
const owner = (action, extra = {}) => ({ action, id: ID, receiptToken: TOKEN, ...extra });
function fakeDb({ profile = true, invalidJwt = false, error = null, rpc } = {}) {
  const calls = [];
  return { calls,
    auth: { getUser: async () => invalidJwt ? { error: {} } : { data: { user: { id: ID, user_metadata: { is_admin: true } } } } },
    from(table) { assert.equal(table, 'profiles'); return { select(column) { assert.equal(column, 'is_admin'); return this; }, eq(column, id) { assert.equal(column, 'id'); assert.equal(id, ID); return this; }, async maybeSingle() { return { data: { is_admin: profile } }; } }; },
    async rpc(name, args) {
      calls.push({ name, args });
      if (error) return { error, data: null };
      if (rpc) return rpc(name, args);
      if (name.endsWith('_manage')) return { data: { status: 'created' } };
      if (name.endsWith('_detail')) return { data: structuredClone(DETAIL) };
      if (name.endsWith('_ingest')) return { data: { status: 'created', eventId: EVENT_ID, receivedAt: NOW, mode: 'live' } };
      if (name.endsWith('_summary')) return { data: { connections: 1, activeConnections: 1, liveConnections: 1, stats: DETAIL.stats } };
      throw new Error('Unexpected RPC');
    },
  };
}
async function request(db, action, { body, method, headers = {}, query = {} } = {}) {
  const req = { method: method || (body ? 'POST' : 'GET'), query: { action, ...query }, body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } };
  const res = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handleProjectInstructionUsage(req, res, { db, now: () => NOW });
  return res;
}
const eventRequest = (event = EVENT, extra = {}) => ({ body: { id: ID, event }, headers: { authorization: 'Bearer ' + WRITE }, ...extra });

test('events accept only defined non-identifying fields and explicit per-execution consent', () => {
  assert.deepEqual(normalizeUsageEvent(EVENT), EVENT);
  for (const extra of [{ text: 'private' }, { personId: ID }, { url: 'https://example.test' }, { error: 'private stack' }, { createdAt: NOW }]) assert.throws(() => normalizeUsageEvent({ ...EVENT, ...extra }));
  for (const endUserConsent of [undefined, false, 'true', 1]) assert.throws(() => normalizeUsageEvent({ ...EVENT, endUserConsent }));
});
test('duration and counts must be bounded safe integers, no numeric strings or fractional counts', () => {
  for (const durationMs of [-1, 86400001, 1.2, '100', null, NaN, Infinity]) assert.throws(() => normalizeUsageEvent({ ...EVENT, durationMs }));
  for (const durationMs of [0, 86400000]) assert.equal(normalizeUsageEvent({ ...EVENT, durationMs }).durationMs, durationMs);
  const check = { checkedItems: 5, correctItems: 4, checkMethod: 'human_review', criteriaVersion: '1.0' };
  for (const fields of [{ checkedItems: 0 }, { checkedItems: 10001 }, { correctItems: 6 }, { correctItems: -1 }, { correctItems: 0.2 }, { checkMethod: 'ai_guessed' }, { criteriaVersion: 'my client name' }]) assert.throws(() => normalizeUsageEvent({ ...EVENT, ...check, ...fields }));
  assert.equal(normalizeUsageEvent({ ...EVENT, ...check }).correctItems, 4);
});
test('time comparisons require complete same-task declared group and do not erase negative savings', () => {
  const time = { baselineSeconds: 10, workSeconds: 20, workTimeSource: 'measured', comparableTask: true };
  assert.equal(normalizeUsageEvent({ ...EVENT, ...time }).workSeconds, 20);
  for (const key of Object.keys(time)) { const incomplete = { ...EVENT, ...time }; delete incomplete[key]; assert.throws(() => normalizeUsageEvent(incomplete)); }
  for (const change of [{ baselineSeconds: 0 }, { workSeconds: -1 }, { comparableTask: false }, { workTimeSource: 'estimated' }]) assert.throws(() => normalizeUsageEvent({ ...EVENT, ...time, ...change }));
  assert.equal(normalizeUsageEvent({ ...EVENT, ...time, workTimeSource: 'self_reported' }).workTimeSource, 'self_reported');
});
test('failed runs cannot claim review, correctness or time savings', () => {
  assert.equal(normalizeUsageEvent({ ...EVENT, outcome: 'failed' }).outcome, 'failed');
  for (const extra of [{ review: 'accepted' }, { checkedItems: 1, correctItems: 1, checkMethod: 'reference_check', criteriaVersion: '1' }, { baselineSeconds: 1, workSeconds: 0, workTimeSource: 'measured', comparableTask: true }]) assert.throws(() => normalizeUsageEvent({ ...EVENT, outcome: 'failed', ...extra }));
});
test('event key order and UUID casing normalize deterministically for replay', () => {
  const reversed = Object.fromEntries(Object.entries(EVENT).reverse()); reversed.eventId = EVENT_ID.toUpperCase();
  assert.equal(JSON.stringify(normalizeUsageEvent(EVENT)), JSON.stringify(normalizeUsageEvent(reversed)));
});
test('enrollment requires separate strict consent/version and distinct write credential', () => {
  const body = owner('enable', { writeToken: WRITE, consent: CONSENT });
  const normalized = normalizeUsageOwner(body, 'enable');
  assert.equal(normalized.receiptHash, hash(TOKEN)); assert.equal(normalized.writeHash, hash(WRITE));
  assert.equal(JSON.stringify(normalized).includes(TOKEN), false);
  for (const field of ['usage', 'overseas', 'ownUse', 'age14']) for (const value of [false, 'true', 1, null]) assert.throws(() => normalizeUsageOwner({ ...body, consent: { ...CONSENT, [field]: value } }, 'enable'));
  assert.throws(() => normalizeUsageOwner({ ...body, consent: { ...CONSENT, version: 'old' } }, 'enable'));
  assert.throws(() => normalizeUsageOwner({ ...body, writeToken: TOKEN }, 'enable'));
  assert.throws(() => normalizeUsageOwner({ ...body, consent: { ...CONSENT, marketing: true } }, 'enable'));
});
test('rotation has compare-and-set generation and prevents receipt credential reuse', () => {
  assert.equal(normalizeUsageOwner(owner('rotate', { writeToken: WRITE, expectedGeneration: 2 }), 'rotate').expectedGeneration, 2);
  for (const expectedGeneration of [undefined, 0, -1, 1.1, '2', 2147483647]) assert.throws(() => normalizeUsageOwner(owner('rotate', { writeToken: WRITE, expectedGeneration }), 'rotate'));
  assert.throws(() => normalizeUsageOwner(owner('rotate', { writeToken: TOKEN, expectedGeneration: 1 }), 'rotate'));
});
test('POST requires JSON, rejects oversized/malformed/extra payload before any database call', async () => {
  const db = fakeDb();
  assert.equal((await request(db, 'event', eventRequest(EVENT, { headers: { 'content-type': '' } }))).code, 415);
  assert.equal((await request(db, 'event', eventRequest(EVENT, { headers: { 'content-type': 'text/plain' } }))).code, 415);
  assert.equal((await request(db, 'event', eventRequest(EVENT, { headers: { 'content-length': '8193' } }))).code, 413);
  assert.equal((await request(db, 'event', { body: '{bad' })).code, 400);
  assert.equal((await request(db, 'event', { body: JSON.stringify({ document: 'x'.repeat(8193) }) })).code, 413);
  assert.equal((await request(db, 'event', { ...eventRequest(), body: { id: ID, event: EVENT, document: 'secret' } })).code, 400);
  assert.equal(db.calls.length, 0);
});
test('browser event posting, token URL params and method/action confusion are rejected', async () => {
  const db = fakeDb();
  for (const origin of ['https://bccconsulting.kr', 'null', '']) assert.equal((await request(db, 'event', eventRequest(EVENT, { headers: { authorization: 'Bearer ' + WRITE, origin } }))).code, 403);
  assert.equal((await request(db, 'health', { query: { writeToken: WRITE } })).code, 400);
  assert.equal((await request(db, 'event', eventRequest(EVENT, { query: { receiptToken: TOKEN } }))).code, 400);
  assert.equal((await request(db, 'event', { method: 'GET' })).code, 400);
  const options = await request(db, 'event', { method: 'OPTIONS' }); assert.equal(options.code, 405); assert.equal(options.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal((await request(db, 'event', { ...eventRequest(), body: { action: 'enable', id: ID, event: EVENT } })).code, 400);
  assert.equal(db.calls.length, 0);
});
test('event credentials and unknown ids share generic404; credentials reach RPC only as hashes', async () => {
  const db = fakeDb();
  for (const authorization of [undefined, 'Bearer bad', 'Bearer ' + TOKEN + '?', 'Basic ' + WRITE]) assert.equal((await request(db, 'event', eventRequest(EVENT, { headers: { authorization } }))).code, 404);
  assert.equal(db.calls.length, 0);
  const result = await request(db, 'event', eventRequest()); assert.equal(result.code, 201);
  assert.equal(db.calls[0].args.p_write_hash, hash(WRITE)); assert.deepEqual(db.calls[0].args.p_event, EVENT);
  assert.equal(JSON.stringify(db.calls).includes(WRITE), false); assert.equal(JSON.stringify(result.data).includes('hash'), false);
  assert.equal(result.headers['Cache-Control'], 'no-store, private');
});
test('ingest created/replay/conflict/revocation/quota map to explicit HTTP responses', async () => {
  for (const [status, code] of [['created', 201], ['replayed', 200], ['conflict', 409], ['missing', 404], ['rate_limited', 429], ['invalid', 400]]) {
    const db = fakeDb({ rpc: async () => ({ data: { status, eventId: EVENT_ID, receivedAt: NOW, mode: 'test' } }) });
    const result = await request(db, 'event', eventRequest({ ...EVENT, mode: 'test' })); assert.equal(result.code, code);
    if (code < 300) { assert.equal(result.data.replayed, status === 'replayed'); assert.equal(result.data.mode, 'test'); }
    if (code === 429) assert.equal(result.headers['Retry-After'], '86400');
  }
});
test('owner status requires receipt hash; enable and rotation call atomic RPC then authorized detail', async () => {
  const db = fakeDb();
  const result = await request(db, 'enable', { body: owner('enable', { writeToken: WRITE, consent: CONSENT }), query: { fn: 'project-instruction-usage' } });
  assert.equal(result.code, 201); assert.deepEqual(result.data, DETAIL);
  assert.deepEqual(db.calls[0], { name: 'project_instruction_usage_manage', args: { p_action: 'enable', p_id: ID, p_receipt_hash: hash(TOKEN), p_write_hash: hash(WRITE), p_expected_generation: null, p_consent_version: USAGE_POLICY_VERSION } });
  assert.deepEqual(db.calls[1], { name: 'project_instruction_usage_detail', args: { p_id: ID, p_receipt_hash: hash(TOKEN), p_admin: false, p_at: NOW } });
  db.calls.length = 0;
  const read = await request(db, 'status', { body: owner('status') }); assert.equal(read.code, 200); assert.equal(db.calls.length, 1); assert.equal(db.calls[0].name, 'project_instruction_usage_detail');
});
test('failed management never reads details; unknown receipt also reveals no record', async () => {
  const db = fakeDb({ rpc: async () => ({ data: { status: 'conflict' } }) });
  const result = await request(db, 'enable', { body: owner('enable', { writeToken: WRITE, consent: CONSENT }) }); assert.equal(result.code, 409); assert.equal(db.calls.length, 1);
  const missing = fakeDb({ rpc: async () => ({ data: null }) });
  assert.equal((await request(missing, 'status', { body: owner('status') })).code, 404);
  assert.equal((await request(missing, 'status', { body: owner('status', { receiptToken: 'bad' }) })).code, 404); assert.equal(missing.calls.length, 1);
});
test('admin identity comes from getUser plus strict profile flag, never editable metadata', async () => {
  assert.equal((await request(fakeDb(), 'admin-summary')).code, 401);
  const headers = { authorization: 'Bearer admin' };
  assert.equal((await request(fakeDb({ invalidJwt: true }), 'admin-summary', { headers })).code, 401);
  for (const profile of [false, 'true', 1, null]) assert.equal((await request(fakeDb({ profile }), 'admin-summary', { headers })).code, 403);
  const db = fakeDb();
  const response = await request(db, 'admin-summary', { headers, query: { classId: ID, q: ' 회의 ' } }); assert.equal(response.code, 200);
  assert.deepEqual(db.calls[0].args, { p_class_id: ID, p_q: '회의', p_at: NOW });
  await request(db, 'admin-detail', { headers, query: { id: ID } }); assert.equal(db.calls[1].args.p_admin, true); assert.equal(db.calls[1].args.p_receipt_hash, null);
});
test('provider failure and thrown error return generic503 without sensitive provider details', async () => {
  const db = fakeDb({ error: { message: 'database secret ' + WRITE } });
  const result = await request(db, 'event', eventRequest()); assert.equal(result.code, 503); assert.equal(JSON.stringify(result).includes(WRITE), false); assert.equal(JSON.stringify(result).includes('database secret'), false);
  const throwing = fakeDb({ rpc: async () => { throw new Error('raw stack ' + WRITE); } });
  const caught = await request(throwing, 'event', eventRequest()); assert.equal(caught.code, 503); assert.equal(JSON.stringify(caught).includes(WRITE), false);
});
