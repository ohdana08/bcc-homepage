import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleLectureOperations, financeConfig } from '../lib/lecture-operations.js';
import { normalizeOperations, normalizeSettings, normalizePayment, normalizeLedgerSnapshot, settlementView, timestamp } from '../lib/lecture-operations-domain.js';
import { createMemoryDb, ADMIN_ID, ADMIN_TOKEN, MEMBER_TOKEN } from '../scripts/lecture-request-local-server.mjs';

// These are API/domain tests using synthetic I/O. Real SQL transactions, RLS and
// concurrent calls are separately exercised by verify-lecture-operations.mjs.
const CASE = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FINANCE_TOKEN = 'synthetic-finance-owner';
const headers = { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json', origin: 'https://bccconsulting.kr' };
const financeHeaders = { 'x-finance-authorization': `Bearer ${FINANCE_TOKEN}` };
const checklist = () => ({ materials_ready: false, venue_ready: false, documents_ready: false, completed: false, notes: '' });
const settings = () => ({ contract_amount: 1000000, deduction_amount: 33000, due_date: '2026-11-30', invoice_status: 'not_issued', invoice_number: '', notes: '' });
const session = (values = {}) => ({ id: randomUUID(), title: '합성 교육', start_at: '2026-11-02T01:00:00.000Z', end_at: '2026-11-02T04:00:00.000Z', instructor: '합성 강사', location: '합성 교육장', status: 'confirmed', ...values });
const legacy = (values = {}) => ({ id: randomUUID(), date: '2026-11-02', organization: '합성 기관', topic: '합성 교육', fee: 1000000, promised_fee: 1000000, actual_fee: 200000, is_paid: false, paid_at: null, ...values });
function fixture(overrides = {}) {
  return createMemoryDb({ tables: {
    proposal_cases: [{ id: CASE, institution_name: '합성 기관', status: 'inquiry', updated_at: '2026-10-22T01:02:03.123456+00:00', created_at: '2026-10-22T01:00:00Z' }],
    lecture_operations: [], lecture_operations_history: [],
    ...overrides.tables,
  }, rpcHandlers: overrides.rpcHandlers || {} });
}
function financeFixture({ owner = true, tables = {}, mutate = () => ({ data: {}, error: null }) } = {}) {
  const db = createMemoryDb({ tables: { lectures: [], lecture_finance_links: [], lecture_finance_payments: [], ...tables }, rpcHandlers: {
    is_finance_owner: () => ({ data: owner, error: null }), lecture_finance_mutate: mutate,
  } });
  db.auth.getUser = async token => token === FINANCE_TOKEN ? { data: { user: { id: OWNER } }, error: null } : { data: { user: null }, error: { message: 'Synthetic credential rejected' } };
  return db;
}
async function call(db, body, { reqHeaders = {}, method = 'POST', financeDb, ...dependencies } = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = structuredClone(value); return this; } };
  await handleLectureOperations({ method, headers: { ...headers, ...reqHeaders }, body }, res, { db, financeDb, ...dependencies });
  return res;
}

test('operations boundary rejects wrong method/origin/type/size/unknown action/forged identity before database work', async t => {
  for (const [name, body, options, code] of [
    ['method', { action: 'list' }, { method: 'GET' }, 405],
    ['origin', { action: 'list' }, { reqHeaders: { origin: 'https://attacker.invalid' } }, 403],
    ['missing token', { action: 'list' }, { reqHeaders: { authorization: '' } }, 401],
    ['json', '{', {}, 400], ['array', [], {}, 400], ['unknown action', { action: 'generate' }, {}, 400],
    ['content type', { action: 'list' }, { reqHeaders: { 'content-type': 'text/plain' } }, 415],
    ['size', { action: 'list' }, { reqHeaders: { 'content-length': '60001' } }, 413],
    ['actor override', { action: 'detail', case_id: CASE, actor_id: OWNER }, {}, 400],
    ['owner override', { action: 'finance_list', owner_id: OWNER }, {}, 400],
  ]) await t.test(name, async () => { const db = fixture(); const r = await call(db, body, options); assert.equal(r.statusCode, code); assert.equal(db.calls.length, 0); });
});
test('business members and invalid bearer cannot read operational records', async () => {
  const db = fixture();
  assert.equal((await call(db, { action: 'list' }, { reqHeaders: { authorization: `Bearer ${MEMBER_TOKEN}` } })).statusCode, 403);
  assert.equal((await call(db, { action: 'list' }, { reqHeaders: { authorization: 'Bearer expired' } })).statusCode, 401);
  assert.ok(db.calls.every(c => c.table === 'profiles'));
});
test('detail returns a private default operation and no inquiry edit secret', async () => {
  const db = fixture({ tables: { lecture_requests: [{ case_id: CASE, receipt: randomUUID(), payload: { purpose: '합성 문의' }, key_hash: 'must-never-return' }] } });
  const r = await call(db, { action: 'detail', case_id: CASE });
  assert.equal(r.statusCode, 200); assert.equal(r.body.operation.revision, 0); assert.deepEqual(r.body.operation.sessions, []);
  assert.equal(JSON.stringify(r.body).includes('must-never-return'), false); assert.match(r.headers['cache-control'], /no-store/);
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
});
test('manually created case inquiry is included in detail but excluded from the list', async () => {
  const inquiry_text = '수동으로 접수한 합성 문의 원문';
  const db = fixture({ tables: { proposal_cases: [{ id: CASE, institution_name: '합성 기관', inquiry_text }] } });
  const detail = await call(db, { action: 'detail', case_id: CASE });
  assert.equal(detail.statusCode, 200); assert.equal(detail.body.case.inquiry_text, inquiry_text); assert.equal(detail.body.request, null);
  const list = await call(db, { action: 'list' });
  assert.equal(list.statusCode, 200); assert.equal('inquiry_text' in list.body.cases[0], false);
});
test('list explicitly paginates and includes operations only for returned cases', async () => {
  const cases = Array.from({ length: 101 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, created_at: '2026-01-01', institution_name: `합성 ${i}` }));
  const db = fixture({ tables: { proposal_cases: cases, lecture_operations: [{ case_id: cases[100].id, revision: 2, sessions: [] }] } });
  const a = await call(db, { action: 'list' });
  assert.equal(a.body.cases.length, 100); assert.equal(a.body.next_page, 1); assert.equal(a.body.limited, true); assert.equal(a.body.operations.length, 0);
  const b = await call(db, { action: 'list', page: 1 });
  assert.equal(b.body.cases.length, 1); assert.equal(b.body.next_page, null); assert.equal(b.body.operations.length, 1);
});
test('operations keeps candidate date out of schedule mutation and binds actor to authenticated administrator', async () => {
  let args;
  const db = fixture({ rpcHandlers: { lecture_ops_save: input => { args = input; return { data: { operation: { ...input.p_payload, revision: 1 } }, error: null }; } } });
  const s = session();
  const r = await call(db, { action: 'save_operations', case_id: CASE, expected_revision: 0, mutation_id: randomUUID(), sessions: [s], checklist: checklist() });
  assert.equal(r.statusCode, 200); assert.equal(args.p_admin, ADMIN_ID); assert.equal(args.p_case_id, CASE);
  assert.deepEqual(args.p_payload.sessions, [s]); assert.equal('lecture_date' in args.p_payload, false);
  assert.equal(db.calls.some(c => c.operation === 'insert' || c.operation === 'update'), false);
});
test('case CAS preserves DB microseconds while normalizing editable next-action timestamp', async () => {
  let args;
  const db = fixture({ rpcHandlers: { lecture_ops_case_update: input => { args = input; return { data: { case: input.p_fields }, error: null }; } } });
  const r = await call(db, { action: 'case_update', case_id: CASE, mutation_id: randomUUID(), expected_updated_at: '2026-10-22T01:02:03.123456+00:00', fields: { status: 'won', next_action: '준비', next_action_at: '2026-11-02T09:00:00+09:00' } });
  assert.equal(r.statusCode, 200); assert.equal(args.p_updated_at, '2026-10-22T01:02:03.123456+00:00'); assert.equal(args.p_fields.next_action_at, '2026-11-02T00:00:00.000Z');
});
test('DB conflict/overlap and failures become safe statuses, never database internals', async () => {
  for (const [value, status] of [[{ data: { error: 'conflict' }, error: null }, 409], [{ data: { error: 'schedule_conflict' }, error: null }, 409], [{ data: null, error: { code: 'XX000', message: 'fake-secret-dsn' } }, 503]]) {
    const db = fixture({ rpcHandlers: { lecture_ops_save: () => value } });
    const r = await call(db, { action: 'save_operations', case_id: CASE, expected_revision: 0, mutation_id: randomUUID(), sessions: [], checklist: checklist() });
    assert.equal(r.statusCode, status); assert.equal(JSON.stringify(r.body).includes('fake-secret-dsn'), false);
  }
});
test('session calendar validates impossible dates, reverse intervals, duplicates, and overlapping instructors', () => {
  assert.throws(() => timestamp('2026-02-30T09:00:00+09:00'));
  assert.throws(() => timestamp('2026-11-02T24:00:00Z'));
  const first = session();
  for (const sessions of [[session({ end_at: first.start_at })], [first, first], [first, session({ instructor: ' 합성 강사 ' })], Array.from({ length: 51 }, () => session())]) assert.throws(() => normalizeOperations({ sessions, checklist: checklist() }));
  assert.equal(normalizeOperations({ sessions: [first, session({ start_at: first.end_at, end_at: '2026-11-02T05:00:00Z' })], checklist: checklist() }).sessions.length, 2);
  assert.equal(normalizeOperations({ sessions: [first, session({ status: 'cancelled' })], checklist: checklist() }).sessions.length, 2);
  assert.equal(normalizeOperations({ sessions: [first, session({ instructor: '다른 강사' })], checklist: checklist() }).sessions.length, 2);
});
test('settings and payment amounts reject fractions, negatives, numeric strings, excess deductions, and unknown fields', () => {
  for (const contract_amount of [-1, 0.1, '100', 2147483648, Infinity]) assert.throws(() => normalizeSettings({ ...settings(), contract_amount }));
  assert.throws(() => normalizeSettings({ ...settings(), deduction_amount: 1000001 }));
  assert.throws(() => normalizeSettings({ ...settings(), due_date: '2026-02-30' }));
  assert.throws(() => normalizeSettings({ ...settings(), user_id: OWNER }));
  const payment = { id: randomUUID(), kind: 'receipt', amount: 1, date: '2026-11-02', note: '' };
  for (const amount of [0, -1, 0.1, '10', 2147483648]) assert.throws(() => normalizePayment({ ...payment, amount }));
  assert.deepEqual(normalizePayment(payment), payment);
});
test('settlement amounts distinguish unpaid/partial/paid/overpaid with integer deductions', () => {
  for (const [received_amount, state, receivable_amount] of [[0, 'unpaid', 967000], [200000, 'partial', 767000], [967000, 'paid', 0], [1000000, 'overpaid', 0]]) {
    const result = settlementView({ ...settings(), received_amount }); assert.equal(result.status, state); assert.equal(result.receivable_amount, receivable_amount);
  }
});
test('finance config refuses service-role keys and wrong-project URLs', () => {
  const fakeJwt = role => `synthetic.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.not-a-signature`;
  assert.deepEqual(financeConfig({ FINANCE_SUPABASE_ANON_KEY: fakeJwt('service_role') }), { enabled: false });
  assert.deepEqual(financeConfig({ FINANCE_SUPABASE_ANON_KEY: fakeJwt('anon'), FINANCE_SUPABASE_URL: 'https://other.supabase.co' }), { enabled: false });
  assert.equal(financeConfig({ FINANCE_SUPABASE_ANON_KEY: fakeJwt('anon') }).enabled, true);
});
test('finance requires a separately valid finance-project token plus current owner approval', async () => {
  const db = fixture(), financeDb = financeFixture();
  assert.equal((await call(db, { action: 'finance_list' }, { financeDb })).statusCode, 401);
  assert.equal((await call(db, { action: 'finance_list' }, { financeDb, reqHeaders: { 'x-finance-authorization': `Bearer ${ADMIN_TOKEN}` } })).statusCode, 401);
  assert.equal(financeDb.calls.length, 0);
  assert.equal((await call(db, { action: 'finance_list' }, { financeDb: financeFixture({ owner: false }), reqHeaders: financeHeaders })).statusCode, 403);
});
test('finance listing is lecture-only and scoped to the authenticated finance owner', async () => {
  const own = legacy(), other = legacy();
  const financeDb = financeFixture({ tables: { lectures: [{ ...own, user_id: OWNER }, { ...other, user_id: ADMIN_ID }], expenses: [{ user_id: OWNER, amount: 999 }] } });
  const r = await call(fixture(), { action: 'finance_list' }, { financeDb, reqHeaders: financeHeaders });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.body.lectures, [own]); assert.equal(financeDb.calls.some(c => c.table === 'expenses'), false);
});
test('finance link preserves explicit opening baseline, legacy whitespace and snapshot precision', async () => {
  let args;
  const selected = legacy({ organization: ' 합성 기관 ', topic: '\t합성 교육\n', paid_at: '2026-10-22T01:02:03.123456+00:00' });
  assert.deepEqual(normalizeLedgerSnapshot(selected), selected);
  assert.equal(normalizeLedgerSnapshot(legacy({ topic: null })).topic, null);
  assert.throws(() => normalizeLedgerSnapshot(legacy({ organization: null })));
  assert.throws(() => normalizeLedgerSnapshot(legacy({ topic: 42 })));
  const financeDb = financeFixture({ mutate: input => { args = input; return { data: { settlement: { ...settings(), received_amount: 200000, revision: 1 }, payments: [] }, error: null }; } });
  const r = await call(fixture(), { action: 'finance_link', case_id: CASE, mutation_id: randomUUID(), lecture_id: selected.id, expected_lecture: selected, opening_received: 200000, settings: settings() }, { financeDb, reqHeaders: financeHeaders });
  assert.equal(r.statusCode, 200); assert.equal(args.p_payload.opening_received, 200000); assert.deepEqual(args.p_payload.expected_lecture, selected); assert.equal(args.p_revision, 0); assert.equal(r.body.settlement.receivable_amount, 767000);
  assert.equal('owner_id' in args, false); assert.equal(args.p_action, 'link');
});
test('finance refuses ambiguous linkage, wrong original ID, and unknown business case', async () => {
  const selected = legacy(); const db = fixture(), financeDb = financeFixture();
  const body = { action: 'finance_link', case_id: CASE, mutation_id: randomUUID(), lecture_id: selected.id, expected_lecture: selected, opening_received: 200000, settings: settings() };
  assert.equal((await call(db, { ...body, create: { date: '2026-11-02', organization: '합성' } }, { financeDb, reqHeaders: financeHeaders })).statusCode, 400);
  assert.equal((await call(db, { ...body, expected_lecture: { ...selected, id: randomUUID() } }, { financeDb, reqHeaders: financeHeaders })).statusCode, 400);
  assert.equal((await call(db, { ...body, case_id: randomUUID() }, { financeDb, reqHeaders: financeHeaders })).statusCode, 404);
  assert.equal(financeDb.calls.some(c => c.rpc === 'lecture_finance_mutate'), false);
});
test('finance payments and voids bind case, expected revision and retry key without changing actor', async () => {
  const received = [];
  const financeDb = financeFixture({ mutate: args => { received.push(args); return { data: { settlement: { ...settings(), revision: args.p_revision + 1, received_amount: 200000 }, payments: [] }, error: null }; } });
  const mutation_id = randomUUID(), payment = { id: randomUUID(), kind: 'refund', amount: 100000, date: '2026-11-02', note: '합성 환불' };
  const request = { action: 'finance_payment', case_id: CASE, expected_revision: 2, mutation_id, payment };
  assert.equal((await call(fixture(), request, { financeDb, reqHeaders: financeHeaders })).statusCode, 200);
  assert.equal((await call(fixture(), request, { financeDb, reqHeaders: financeHeaders })).statusCode, 200);
  assert.deepEqual(received[0], received[1]); assert.equal(received[0].p_action, 'payment');
  const r = await call(fixture(), { action: 'finance_void', case_id: CASE, expected_revision: 3, mutation_id: randomUUID(), payment_id: payment.id, reason: '입력 오류' }, { financeDb, reqHeaders: financeHeaders });
  assert.equal(r.statusCode, 200); assert.equal(received[2].p_action, 'void'); assert.equal(received[2].p_payload.reason, '입력 오류');
});
