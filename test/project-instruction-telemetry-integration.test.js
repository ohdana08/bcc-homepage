import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleProjectInstructionUsage } from '../lib/project-instruction/telemetry-handler.js';
import { createUsageClient } from '../tools/project-instruction/usage-client.mjs';
import { buildUsageInstruction, buildUsageEnvironment } from '../tools/project-instruction/usage-kit.js';

// Independent HTTP-boundary checks. The DB is a spy, not a simulated proof of
// SQL locking, quotas or RLS; those require the separate real DB verification.
const ID = '9f294d1e-98f3-4900-ad8b-844446bd1351';
const EVENT_ID = '6411278b-1386-4a88-a55c-ce27a728de90';
const TOKEN = 'ae'.repeat(32);
const RECEIPT = 'bc'.repeat(32);
const NOW = '2026-10-02T08:00:00.000Z';
const event = changes => ({ eventId: EVENT_ID, mode: 'live', outcome: 'completed', durationMs: 42000, review: 'not_reviewed', endUserConsent: true, ...changes });
const eventBody = changes => ({ id: ID, event: event(changes) });
const consent = changes => ({ version: '2026-10-02-usage-v1', usage: true, overseas: true, ownUse: true, age14: true, ...changes });
const enable = changes => ({ id: ID, receiptToken: RECEIPT, writeToken: TOKEN, consent: consent(), ...changes });
const digest = token => createHash('sha256').update(token).digest('hex');

function spyDb({ rpcResult, profile = true, authError = false } = {}) {
  const calls = [], queries = [];
  return {
    calls, queries,
    auth: { async getUser() { return authError ? { data: null, error: {} } : { data: { user: { id: ID, user_metadata: { is_admin: true } } }, error: null }; } },
    async rpc(name, args) {
      calls.push({ name, args });
      if (typeof rpcResult === 'function') return rpcResult(name, args);
      return rpcResult || { data: { status: 'created', eventId: EVENT_ID, receivedAt: NOW, mode: 'live' }, error: null };
    },
    from(table) {
      queries.push(table);
      const q = { select() { return q; }, eq() { return q; }, gt() { return q; }, maybeSingle() { return q; }, single() { return q; },
        then(resolve, reject) { return Promise.resolve({ data: table === 'profiles' ? { is_admin: profile } : null, error: null }).then(resolve, reject); } };
      return q;
    },
  };
}
async function request(action, body, { db = spyDb(), method = body === undefined ? 'GET' : 'POST', headers = {}, query = {} } = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handleProjectInstructionUsage({ method, query: { action, ...query }, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers }, body }, res, { db, now: () => NOW });
  return { ...res, db };
}
const senderHeaders = { authorization: `Bearer ${TOKEN}` };

test('usage boundary: public health contains no credentials and every response is no-store', async () => {
  const response = await request('health');
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['cache-control'], /no-store/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.doesNotMatch(JSON.stringify(response.body), /(?:receiptToken|writeToken|token_hash|service_role)/i);
});

test('usage boundary: a browser cannot ingest even with a valid write token', async () => {
  for (const origin of ['https://bccconsulting.kr', 'https://example.test', 'null', '']) {
    const result = await request('event', eventBody(), { headers: { ...senderHeaders, origin } });
    assert.equal(result.statusCode, 403);
    assert.equal(result.db.calls.length, 0);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
});

test('usage boundary: request method, JSON type and 8KiB limit fail before DB writes', async () => {
  for (const method of ['PUT', 'DELETE', 'OPTIONS']) {
    const result = await request('event', eventBody(), { method, headers: senderHeaders });
    assert.ok(result.statusCode >= 400 && result.statusCode < 500);
    assert.equal(result.db.calls.length, 0);
  }
  for (const [headers, body] of [
    [{ ...senderHeaders, 'content-type': 'text/plain' }, eventBody()],
    [{ ...senderHeaders, 'content-type': '' }, eventBody()],
    [{ ...senderHeaders, 'content-length': '8193' }, eventBody()],
    [senderHeaders, '{invalid'],
    [senderHeaders, { ...eventBody(), extra: 'x'.repeat(8193) }],
  ]) {
    const result = await request('event', body, { headers });
    assert.ok([400, 413, 415].includes(result.statusCode));
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: missing/malformed event credentials never reach the DB', async () => {
  for (const authorization of ['', `Basic ${TOKEN}`, `Bearer ${TOKEN.slice(1)}`, `Bearer ${TOKEN} x`, 'Bearer invalid']) {
    const result = await request('event', eventBody(), { headers: { authorization } });
    assert.equal(result.statusCode, 404);
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: document, identifiers and arbitrary metadata are rejected rather than stripped', async () => {
  const additions = { document: 'PRIVATE RAW TEXT', prompt: 'PRIVATE PROMPT', email: 'test@example.test', personId: 'person1', error: 'private failure', url: 'https://example.test', properties: { secret: true }, receivedAt: NOW };
  for (const [key, value] of Object.entries(additions)) {
    const result = await request('event', eventBody({ [key]: value }), { headers: senderHeaders });
    assert.equal(result.statusCode, 400, key);
    assert.equal(result.db.calls.length, 0);
  }
  for (const extra of [{ writeToken: TOKEN }, { receiptToken: RECEIPT }, { document: 'raw' }]) {
    const result = await request('event', { ...eventBody(), ...extra }, { headers: senderHeaders });
    assert.equal(result.statusCode, 400);
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: consent, event enums and duration use strict types', async () => {
  for (const change of [
    { endUserConsent: false }, { endUserConsent: 'true' }, { endUserConsent: 1 }, { endUserConsent: undefined },
    { mode: 'production' }, { mode: undefined }, { outcome: 'success' }, { review: 'approved' },
    { durationMs: -1 }, { durationMs: 86400001 }, { durationMs: 0.5 }, { durationMs: '50' }, { durationMs: NaN }, { durationMs: Infinity },
    { eventId: 'not-a-uuid' },
  ]) {
    const result = await request('event', eventBody(change), { headers: senderHeaders });
    assert.equal(result.statusCode, 400, JSON.stringify(change));
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: each time comparison requires all fields and a comparable-task confirmation', async () => {
  const fields = { baselineSeconds: 90, workSeconds: 100, workTimeSource: 'measured', comparableTask: true };
  for (const key of Object.keys(fields)) {
    const incomplete = { ...fields }; delete incomplete[key];
    const result = await request('event', eventBody(incomplete), { headers: senderHeaders });
    assert.equal(result.statusCode, 400, key);
    assert.equal(result.db.calls.length, 0);
  }
  for (const changes of [{ baselineSeconds: 0 }, { workSeconds: -1 }, { workSeconds: 86401 }, { baselineSeconds: '90' }, { workTimeSource: 'automatic' }, { comparableTask: false }]) {
    const result = await request('event', eventBody({ ...fields, ...changes }), { headers: senderHeaders });
    assert.equal(result.statusCode, 400);
  }
  const negativeSavings = await request('event', eventBody(fields), { headers: senderHeaders });
  assert.equal(negativeSavings.statusCode, 201);
  assert.equal(negativeSavings.db.calls[0].args.p_event.workSeconds, 100);
});

test('usage boundary: check results require complete counts, method and bounded criterion version', async () => {
  const fields = { checkedItems: 10, correctItems: 7, checkMethod: 'human_review', criteriaVersion: '1.0' };
  for (const key of Object.keys(fields)) {
    const incomplete = { ...fields }; delete incomplete[key];
    const result = await request('event', eventBody(incomplete), { headers: senderHeaders });
    assert.equal(result.statusCode, 400);
  }
  for (const changes of [{ checkedItems: 0 }, { checkedItems: 10001 }, { correctItems: 11 }, { correctItems: -1 }, { checkMethod: 'ai_guess' }, { criteriaVersion: '고객 이름' }, { criteriaVersion: 'https://private.test' }]) {
    const result = await request('event', eventBody({ ...fields, ...changes }), { headers: senderHeaders });
    assert.equal(result.statusCode, 400);
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: a failed operation cannot claim successful review, checks or savings', async () => {
  for (const change of [
    { review: 'accepted' }, { review: 'corrected' }, { review: 'rejected' },
    { checkedItems: 2, correctItems: 1, checkMethod: 'reference_check', criteriaVersion: '2' },
    { baselineSeconds: 30, workSeconds: 20, workTimeSource: 'self_reported', comparableTask: true },
  ]) {
    const result = await request('event', eventBody({ outcome: 'failed', ...change }), { headers: senderHeaders });
    assert.equal(result.statusCode, 400);
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: opt-in is separate and each agreement is strict true with the current version', async () => {
  for (const key of ['usage', 'overseas', 'ownUse', 'age14']) for (const value of [false, undefined, 'true', 1]) {
    const result = await request('enable', enable({ consent: consent({ [key]: value }) }));
    assert.equal(result.statusCode, 400, key);
    assert.equal(result.db.calls.length, 0);
  }
  for (const version of ['', '2026-10-01-v1']) {
    const result = await request('enable', enable({ consent: consent({ version }) }));
    assert.equal(result.statusCode, 400);
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: rotation requires a valid compare-and-swap generation', async () => {
  for (const expectedGeneration of [undefined, null, 0, -1, 1.5, '1']) {
    const result = await request('rotate', { id: ID, receiptToken: RECEIPT, writeToken: TOKEN, expectedGeneration });
    assert.equal(result.statusCode, 400);
    assert.equal(result.db.calls.length, 0);
  }
});

test('usage boundary: write tokens only go to DB as hashes and are absent from responses', async () => {
  const result = await request('event', eventBody(), { headers: senderHeaders });
  assert.equal(result.statusCode, 201);
  assert.equal(result.db.calls[0].name, 'project_instruction_usage_ingest');
  assert.equal(result.db.calls[0].args.p_write_hash, digest(TOKEN));
  assert.equal(JSON.stringify(result.db.calls).includes(TOKEN), false);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
  assert.equal(result.body.eventId, EVENT_ID);
  assert.equal(result.body.replayed, false);
});

test('usage boundary: replay/conflict/quota/missing use stable status without revealing DB errors', async () => {
  for (const [status, code] of [['replayed', 200], ['conflict', 409], ['rate_limited', 429], ['missing', 404], ['invalid', 400]]) {
    const db = spyDb({ rpcResult: { data: { status, eventId: EVENT_ID, receivedAt: NOW, mode: 'live' }, error: null } });
    const result = await request('event', eventBody(), { db, headers: senderHeaders });
    assert.equal(result.statusCode, code, status);
    if (code === 200) assert.equal(result.body.replayed, true);
    if (code === 429) assert.ok(Number(result.headers['retry-after']) > 0);
  }
  for (const rpcResult of [{ data: null, error: { message: `secret ${TOKEN}`, details: RECEIPT } }, { data: { status: 'unknown' }, error: null }]) {
    const result = await request('event', eventBody(), { db: spyDb({ rpcResult }), headers: senderHeaders });
    assert.equal(result.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(result.body), /secret|aeaeae|bcbcbc/);
  }
});

test('usage boundary: admin summaries require verified administrator, not user metadata', async () => {
  for (const action of ['admin-summary', 'admin-detail']) {
    const query = action === 'admin-detail' ? { id: ID } : {};
    assert.equal((await request(action, undefined, { query })).statusCode, 401);
    assert.equal((await request(action, undefined, { query, headers: { authorization: 'Bearer admin' }, db: spyDb({ authError: true }) })).statusCode, 401);
    for (const profile of [false, 'true', 1, null]) {
      const result = await request(action, undefined, { query, headers: { authorization: 'Bearer admin' }, db: spyDb({ profile }) });
      assert.equal(result.statusCode, 403);
      assert.equal(result.db.calls.length, 0);
    }
  }
});

function clientEvent(changes = {}) { const { mode, ...input } = event(changes); return input; }
function client(options = {}) { return createUsageClient({ submissionId: ID, writeToken: TOKEN, enabled: true, timeoutMs: 20, ...options }); }
const acceptedResponse = (mode = 'test') => new Response(JSON.stringify({ ok: true, eventId: EVENT_ID, receivedAt: NOW, replayed: false, mode }), { status: 201, headers: { 'content-type': 'application/json' } });

test('usage SDK: default-off and absent end-user consent make zero network calls', async () => {
  const sent = [];
  const fetchImpl = async (...args) => { sent.push(args); return acceptedResponse(); };
  assert.deepEqual(await createUsageClient({ submissionId: ID, writeToken: TOKEN, fetchImpl }).record(clientEvent()), { ok: false, reason: 'disabled' });
  for (const enabled of ['false', 'true', 1, null]) assert.deepEqual(await client({ enabled, fetchImpl }).record(clientEvent()), { ok: false, reason: 'disabled' });
  for (const endUserConsent of [undefined, false, 'true', 1]) {
    assert.deepEqual(await client({ fetchImpl }).record(clientEvent({ endUserConsent })), { ok: false, reason: 'consent_required' });
  }
  assert.equal(sent.length, 0);
});

test('usage SDK: uppercase UUIDs agree with the server canonical ID without redundant retry', async () => {
  let calls = 0;
  const tool = client({ fetchImpl: async (_url, options) => {
    calls++;
    const { body, headers } = options;
    const db = spyDb({ rpcResult: async (_name, args) => ({ data: { status: 'created', eventId: args.p_event.eventId, receivedAt: NOW, mode: args.p_event.mode }, error: null }) });
    const result = await request('event', JSON.parse(body), { db, headers: Object.fromEntries(new Headers(headers)) });
    return new Response(JSON.stringify(result.body), { status: result.statusCode, headers: { 'content-type': 'application/json' } });
  } });
  const result = await tool.record(clientEvent({ eventId: EVENT_ID.toUpperCase() }));
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.eventId, EVENT_ID);
});

test('usage SDK: sensitive or malformed input does not leave the tool', async () => {
  let calls = 0;
  const tool = client({ fetchImpl: async () => { calls++; return acceptedResponse(); } });
  for (const additions of [
    { document: 'PRIVATE DOCUMENT' }, { prompt: 'PRIVATE PROMPT' }, { userId: 'abc' }, { error: 'PRIVATE STACK' }, { mode: 'live' },
    { durationMs: -1 }, { durationMs: '20' }, { eventId: undefined }, { baselineSeconds: 60 },
    { checkedItems: 5, correctItems: 6, checkMethod: 'human_review', criteriaVersion: '1' },
  ]) {
    assert.deepEqual(await tool.record({ ...clientEvent(), ...additions }), { ok: false, reason: 'invalid_event' });
  }
  assert.equal(calls, 0);
});

test('usage SDK: successful event uses server bearer transport and defaults to test mode', async () => {
  const sent = [];
  const result = await client({ fetchImpl: async (url, options) => { sent.push({ url, options }); return acceptedResponse(); } }).record(clientEvent());
  assert.equal(result.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://bccconsulting.kr/api/project-instruction-usage?action=event');
  assert.equal(sent[0].options.method, 'POST');
  const headers = new Headers(sent[0].options.headers);
  assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.match(headers.get('content-type'), /application\/json/);
  const body = JSON.parse(sent[0].options.body);
  assert.equal(body.id, ID);
  assert.equal(body.event.eventId, EVENT_ID);
  assert.equal(body.event.mode, 'test');
  assert.equal(sent[0].options.body.includes(TOKEN), false);
  assert.equal(sent[0].url.includes(TOKEN), false);
});

test('usage SDK: one network or server retry preserves exact event ID/body', async () => {
  for (const firstFailure of ['network', 'server']) {
    const sent = [];
    const tool = client({ mode: 'live', fetchImpl: async (url, options) => {
      sent.push({ url, body: options.body });
      if (sent.length === 1) { if (firstFailure === 'network') throw new Error(`private ${TOKEN}`); return new Response('private SQL error', { status: 503 }); }
      return acceptedResponse('live');
    } });
    const result = await tool.record(clientEvent());
    assert.equal(result.ok, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].body, sent[1].body);
    assert.equal(JSON.parse(sent[0].body).event.mode, 'live');
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});

test('usage SDK: persistent failures stop after two attempts and never expose error text', async () => {
  for (const kind of ['network', 'server']) {
    let calls = 0;
    const result = await client({ fetchImpl: async () => { calls++; if (kind === 'network') throw new Error(`private ${TOKEN}`); return new Response(`private ${TOKEN}`, { status: 503 }); } }).record(clientEvent());
    assert.deepEqual(result, { ok: false, reason: 'unavailable' });
    assert.equal(calls, 2);
  }
});

test('usage SDK: malformed successful responses are not reported as recorded', async () => {
  for (const body of [null, {}, { ok: true }, { ok: true, eventId: ID, receivedAt: NOW, replayed: false, mode: 'test' }, { ok: true, eventId: EVENT_ID, receivedAt: 'invalid', replayed: false, mode: 'test' }]) {
    let calls = 0;
    const result = await client({ fetchImpl: async () => { calls++; return new Response(JSON.stringify(body), { status: 200 }); } }).record(clientEvent());
    assert.deepEqual(result, { ok: false, reason: 'unavailable' });
    assert.equal(calls, 2);
  }
});

test('usage SDK: invalid/revoked/quota 4xx responses are not retried', async () => {
  for (const status of [400, 403, 404, 409, 413, 429]) {
    let calls = 0;
    const result = await client({ fetchImpl: async () => { calls++; return new Response(`private ${TOKEN}`, { status }); } }).record(clientEvent());
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'rejected');
    assert.equal(result.status, status);
    assert.equal(calls, 1);
  }
});

test('usage SDK: a hung network aborts and returns without breaking the main work', async () => {
  let calls = 0, aborts = 0;
  const started = Date.now();
  const result = await client({ timeoutMs: 20, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborts++; reject(new Error('private transport error')); }, { once: true }));
  } }).record(clientEvent());
  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
  assert.equal(calls, 2);
  assert.equal(aborts, 2);
  assert.ok(Date.now() - started < 8000);
});

test('usage SDK: browser environment never transmits the write key', async () => {
  const old = globalThis.window;
  globalThis.window = {};
  let calls = 0;
  try {
    const result = await client({ fetchImpl: async () => { calls++; return acceptedResponse(); } }).record(clientEvent());
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  } finally {
    if (old === undefined) delete globalThis.window; else globalThis.window = old;
  }
});

test('usage kit: reviewed original stays exact, connecting instructions do not contain management credentials', () => {
  const original = ' \n# 내가 검토한 문서\n\n원래 작성 내용.\n ';
  const output = buildUsageInstruction(original, ID, '2029-10-02T08:00:00.000Z');
  assert.equal(output.slice(0, original.length), original);
  assert.ok(output.includes(ID));
  assert.ok(output.includes('2029-10-02T08:00:00.000Z'));
  assert.equal(output.includes(TOKEN), false);
  assert.equal(output.includes(RECEIPT), false);
  assert.match(output, /기본값 OFF/);
  assert.match(output, /다른 사람의 동의는 승계되지/);
  assert.match(output, /같은 ID와 내용/);
});

test('usage kit: a separate server-only environment defaults off and test without the receipt secret', () => {
  const output = buildUsageEnvironment(ID, TOKEN);
  assert.match(output, /BCC_USAGE_ENABLED=false/);
  assert.match(output, /BCC_USAGE_MODE=test/);
  assert.ok(output.includes(TOKEN));
  assert.equal(output.includes(RECEIPT), false);
  assert.doesNotMatch(output, /SUPABASE|SERVICE_ROLE|RECEIPT_TOKEN/);
  assert.throws(() => buildUsageEnvironment(ID, 'invalid'));
});
