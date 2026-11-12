import test from 'node:test';
import assert from 'node:assert/strict';
import { handleToolLeads, normalizeLead, TOOL_LEAD_CONSENT_VERSION } from '../lib/tool-leads.js';

function fakeDb({ rows = [], admin = false, failInsert = false } = {}) {
  const ops = [];
  const db = {
    rows, ops,
    auth: { getUser: async (t) => (t === 'good' ? { data: { user: { id: 'u1' } } } : { error: new Error('x'), data: {} }) },
    from(table) {
      const q = { table, op: 'select', filters: [], opts: {} };
      const b = {
        select(cols, opts = {}) { if (q.op === 'select') { q.cols = cols; q.opts = opts; } return b; },
        insert(v) { q.op = 'insert'; q.value = v; return b; },
        update(v) { q.op = 'update'; q.value = v; return b; },
        delete() { q.op = 'delete'; return b; },
        eq(k, v) { q.filters.push(['eq', k, v]); return b; },
        gte(k, v) { q.filters.push(['gte', k, v]); return b; },
        lt(k, v) { q.filters.push(['lt', k, v]); return b; },
        not() { return b; }, order() { return b; }, limit() { return b; },
        maybeSingle() { q.single = true; return b; },
        then(resolve) {
          ops.push(q);
          if (table === 'profiles') return resolve({ data: { is_admin: admin } });
          const match = (r) => q.filters.every(([op, k, v]) => op === 'eq' ? r[k] === v : op === 'gte' ? r[k] >= v : r[k] < v);
          if (q.op === 'insert') { if (failInsert) return resolve({ error: new Error('db') }); rows.push({ ...q.value, created_at: new Date().toISOString(), id: rows.length + 1 }); return resolve({ data: null }); }
          if (q.op === 'update' || q.op === 'delete') return resolve({ data: null });
          const found = rows.filter(match);
          if (q.opts.head) return resolve({ count: found.length, data: null });
          return resolve({ data: found });
        },
      };
      return b;
    },
  };
  return db;
}
function res() {
  const r = { code: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const valid = () => ({ action: 'submit', tool: 'funnel-map', name: '홍길동', phone: '010-1234-5678', email: '', consent: true, overseas_consent: true, marketing_consent: false, consent_version: TOOL_LEAD_CONSENT_VERSION, source: { utm_source: 'threads', ref: 'threads.net' } });
const req = (body, headers = {}) => ({ method: 'POST', headers: { origin: 'https://bccconsulting.kr', 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers }, body });

test('normalizes phone and keeps only known source keys', () => {
  const lead = normalizeLead({ ...valid(), source: { utm_source: 'threads', evil: 'x' } });
  assert.equal(lead.phone, '01012345678');
  assert.deepEqual(lead.source, { utm_source: 'threads' });
  assert.equal(lead.email, null);
});

test('rejects bad phone, missing consent, unknown tool, wrong origin', async () => {
  for (const [patch, headers] of [[{ phone: '02-123-4567' }], [{ overseas_consent: false }], [{ tool: 'other' }], [{}, { origin: 'https://evil.example' }], [{ consent_version: 'old' }]]) {
    const r = res();
    await handleToolLeads(req({ ...valid(), ...patch }, headers), r, { db: fakeDb(), rateSecret: 's' });
    assert.ok(r.code >= 400, JSON.stringify(patch));
  }
});

test('stores a lead, dedups same phone+tool within a day', async () => {
  const db = fakeDb();
  const r1 = res(); await handleToolLeads(req(valid()), r1, { db, rateSecret: 's' });
  assert.equal(r1.code, 200);
  assert.equal(db.rows.length, 1);
  assert.ok(db.rows[0].ip_bucket && db.rows[0].ip_bucket.length === 64);
  assert.ok(!JSON.stringify(db.rows[0]).includes('1.2.3.4'));
  const r2 = res(); await handleToolLeads(req(valid()), r2, { db, rateSecret: 's' });
  assert.equal(r2.code, 200); assert.equal(r2.body.duplicate, undefined); assert.equal(db.rows.length, 1);
});

test('rate limits per ip per day', async () => {
  const db = fakeDb();
  for (let i = 0; i < 10; i++) { const r = res(); await handleToolLeads(req({ ...valid(), phone: '0101234' + String(5000 + i) }), r, { db, rateSecret: 's' }); assert.equal(r.code, 200); }
  const r = res(); await handleToolLeads(req({ ...valid(), phone: '01099998888' }), r, { db, rateSecret: 's' });
  assert.equal(r.code, 429);
});

test('honeypot and db failure', async () => {
  const r = res(); await handleToolLeads(req({ ...valid(), website: 'x' }), r, { db: fakeDb(), rateSecret: 's' }); assert.equal(r.code, 400);
  const r2 = res(); await handleToolLeads(req(valid()), r2, { db: fakeDb({ failInsert: true }), rateSecret: 's' }); assert.equal(r2.code, 503);
});

test('admin list requires admin', async () => {
  const r = res(); await handleToolLeads(req({ action: 'list' }), r, { db: fakeDb() }); assert.equal(r.code, 401);
  const r2 = res(); await handleToolLeads(req({ action: 'list' }, { authorization: 'Bearer good' }), r2, { db: fakeDb({ admin: false }) }); assert.equal(r2.code, 403);
  const db = fakeDb({ admin: true, rows: [{ id: 1, tool: 'funnel-map', name: 'a', phone: '01011112222' }] });
  const r3 = res(); await handleToolLeads(req({ action: 'list' }, { authorization: 'Bearer good' }), r3, { db }); assert.equal(r3.code, 200); assert.equal(r3.body.leads.length, 1);
});
