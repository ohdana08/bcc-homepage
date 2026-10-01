import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleProjectInstruction } from '../lib/project-instruction/handler.js';
import { normalizeSubmission, calendarYearsLater, documentTitle, hash, POLICY_VERSION } from '../lib/project-instruction/model.js';
import { purgeProjectInstructions } from '../lib/project-instruction/retention.js';
const NOW = '2026-10-01T15:00:00.000Z';
const ID = 'c394271c-28ee-4c4a-a27e-4c39da8bd42d';
const KEY = '9a2cd861-3f38-4d18-a433-531703492d2e';
const CLASS = '31c7a2b4-9088-40bf-bffc-0f0913f82ee5';
const TOKEN = 'ab'.repeat(32);
const BODY = { action: 'submit', idempotencyKey: KEY, receiptToken: TOKEN, classCode: '', participation: { institution: '', course: '', session: '', ageRange: '', gender: '', occupation: '', aiExperience: '' }, document: ' \n# AI 업무지시서\n\n정확히 검토한 문서입니다.\n ', consent: { version: POLICY_VERSION, age14: true, internal: true, overseas: true, caseStudy: false } };
const makeBody = changes => structuredClone({ ...BODY, ...changes });
function sampleRow(changes = {}) { return { id: ID, idempotency_key: KEY, class_id: CLASS, receipt_token_hash: hash(TOKEN), payload_hash: hash('secret'), title: '회의 정리', participation: { ageRange: '40대', gender: '', occupation: '', aiExperience: '', institution: '기관', course: '강의', session: '1회차' }, submitted_at: NOW, expires_at: '2029-10-01T15:00:00.000Z', consent_version: POLICY_VERSION, age14: true, internal_consent: true, overseas_consent: true, case_study: true, document: '# 원문 <script>alert(1)</script>', case_draft: '검토본', case_updated_at: NOW, ...changes }; }
function fakeDb({ rows = [], profile = true, rpc } = {}) {
  const store = { project_instruction_submissions: rows, project_instruction_classes: [{ id: CLASS, public_code: 'abcdefghijk12345', institution: '기관', course: '강의', session: '1회차', is_open: true, created_at: NOW }], profiles: [{ id: ID, is_admin: profile }], project_instruction_retention_status: [{ id: true, last_success_at: NOW, deleted_count: 3 }] };
  const queries = [], rpcCalls = [];
  const get = (row, column) => column.includes('->>') ? row[column.split('->>')[0]]?.[column.split('->>')[1]] : row[column];
  const db = {
    store, queries, rpcCalls,
    auth: { getUser: async token => token === 'invalid' ? { data: null, error: {} } : { data: { user: { id: ID, user_metadata: { is_admin: true } } }, error: null } },
    rpc: async (name, args) => { rpcCalls.push({ name, args }); if (rpc) return rpc(name, args); if (name === 'project_instruction_stats') return { data: { total: rows.filter(r => r.expires_at > args.p_at).length, caseStudy: 0, ageAnswered: 0, genderAnswered: 0, occupationAnswered: 0, aiExperienceAnswered: 0, distributions: {} }, error: null }; return { data: 0, error: null }; },
    from(table) {
      const predicates = []; let projection = '*', options = {}, mutation = null, single = false, range = null, limit = null;
      const query = { table, filters: predicates, operation: 'select' }; queries.push(query);
      const builder = {
        select(columns, settings = {}) { projection = columns; query.projection = columns; options = settings; return this; },
        update(values) { mutation = values; query.operation = 'update'; query.mutation = values; return this; },
        insert(values) { mutation = values; query.operation = 'insert'; return this; },
        eq(column, value) { predicates.push([column, 'eq', value]); return this; },
        neq(column, value) { predicates.push([column, 'neq', value]); return this; },
        gt(column, value) { predicates.push([column, 'gt', value]); return this; },
        lte(column, value) { predicates.push([column, 'lte', value]); return this; },
        ilike(column, value) { predicates.push([column, 'ilike', value]); return this; },
        order() { return this; }, range(from, to) { range = [from, to]; return this; }, limit(value) { limit = value; return this; },
        maybeSingle() { single = true; return this; }, single() { single = true; return this; },
        then(resolve, reject) {
          try {
            if (query.operation === 'insert') { const row = { id: CLASS, created_at: NOW, is_open: true, ...mutation }; store[table].push(row); return Promise.resolve({ data: single ? row : [row], error: null }).then(resolve, reject); }
            let data = (store[table] || []).filter(row => predicates.every(([column, op, value]) => {
              const actual = get(row, column);
              if (op === 'eq') return actual === value; if (op === 'neq') return actual !== value; if (op === 'gt') return actual > value; if (op === 'lte') return actual <= value;
              return String(actual).toLowerCase().includes(value.slice(1, -1).replace(/\\([_%\\])/g, '$1').toLowerCase());
            }));
            const count = data.length;
            if (mutation) data.forEach(row => Object.assign(row, mutation));
            if (range) data = data.slice(range[0], range[1] + 1); if (limit !== null) data = data.slice(0, limit);
            if (projection !== '*') data = data.map(row => Object.fromEntries(projection.split(',').map(key => [key, row[key]])));
            return Promise.resolve({ data: options.head ? null : single ? data[0] || null : data, error: null, count }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return builder;
    },
  };
  return db;
}
async function call(db, action, { body, method, headers = {}, query = {} } = {}) {
  const req = { method: method || (body ? 'POST' : 'GET'), query: { action, ...query }, body, headers };
  const response = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handleProjectInstruction(req, response, { db, now: () => NOW }); return response;
}
const admin = { authorization: 'Bearer admin' };

test('필수 동의와 연령 확인이 strict boolean이며 선택 사례 동의는 기본 false', () => {
  for (const field of ['age14', 'internal', 'overseas']) for (const value of [false, 'true', 1, null, undefined]) assert.throws(() => normalizeSubmission(makeBody({ consent: { ...BODY.consent, [field]: value } })), /동의/);
  const body = makeBody(); delete body.consent.caseStudy;
  assert.equal(normalizeSubmission(body).normalized.consent.caseStudy, false);
  assert.throws(() => normalizeSubmission(makeBody({ consent: { ...BODY.consent, caseStudy: 'yes' } })), /동의/);
  assert.throws(() => normalizeSubmission(makeBody({ consent: { ...BODY.consent, version: 'old' } })), /동의/);
});
test('추가 개인정보 필드·허용하지 않은 enum·과도한 문서를 조용히 저장하지 않는다', () => {
  for (const participation of [{ ...BODY.participation, email: 'private@example.test' }, { ...BODY.participation, ageRange: '13세' }, { ...BODY.participation, institution: '가'.repeat(121) }, { ...BODY.participation, gender: null }]) assert.throws(() => normalizeSubmission(makeBody({ participation })));
  assert.throws(() => normalizeSubmission(makeBody({ rawAnswers: [] })));
  assert.throws(() => normalizeSubmission(makeBody({ document: 'x'.repeat(60001) })));
  assert.throws(() => normalizeSubmission(makeBody({ document: '  \n ' })));
});
test('정확한 문서는 공백까지 보존하고 참여메타만 정규화한다', () => {
  const body = makeBody({ participation: { ...BODY.participation, institution: ' 기관 ' } });
  const parsed = normalizeSubmission(body);
  assert.equal(parsed.normalized.document, BODY.document);
  assert.equal(parsed.normalized.participation.institution, '기관');
  assert.equal(parsed.tokenHash, hash(TOKEN));
  assert.equal(JSON.stringify(parsed).includes(TOKEN), false);
  const changed = normalizeSubmission(makeBody({ document: BODY.document + ' ' }));
  assert.notEqual(parsed.payloadHash, changed.payloadHash);
});
test('idempotency 지문은 key순서와 연결강의 최신label조회에 영향받지 않는다', () => {
  const a = normalizeSubmission(makeBody()); const b = normalizeSubmission({ consent: { ...BODY.consent }, document: BODY.document, participation: { aiExperience: '', occupation: '', gender: '', ageRange: '', session: '', course: '', institution: '' }, receiptToken: TOKEN, idempotencyKey: KEY });
  assert.equal(a.payloadHash, b.payloadHash);
  assert.notEqual(a.payloadHash, normalizeSubmission(makeBody({ consent: { ...BODY.consent, caseStudy: true } })).payloadHash);
  assert.equal(a.payloadHash, normalizeSubmission(makeBody({ receiptToken: 'cd'.repeat(32) })).payloadHash);
});
test('달력 3년은 윤년 말일을 보정하고 기간을 일수로 환산하지 않는다', () => {
  assert.equal(calendarYearsLater('2024-02-29T12:34:56.000Z'), '2027-02-28T12:34:56.000Z');
  assert.equal(calendarYearsLater('2026-10-01T15:00:00.000Z'), '2029-10-01T15:00:00.000Z');
});
test('문서 내부 만들 것 이름이 제목이고 미정이면 헤딩으로 돌아간다', () => {
  assert.equal(documentTitle('# AI 업무지시서\n\n**만들 것의 이름**\n\n> 회의 메모 도우미\n'), '회의 메모 도우미');
  assert.equal(documentTitle('# AI 업무지시서\n\n**만들 것의 이름**\n\n> 아직 정하지 않음\n'), 'AI 업무지시서');
});
test('유효 submit은 SHA256만 RPC에 전달하고 공개 응답에는 토큰·원문이 없다', async () => {
  const db = fakeDb({ rpc: async () => ({ data: { status: 'created', id: ID, submittedAt: NOW, expiresAt: calendarYearsLater(NOW) }, error: null }) });
  const response = await call(db, 'submit', { body: makeBody() });
  assert.equal(response.code, 201); assert.equal(response.data.id, ID); assert.equal(response.data.replayed, false);
  assert.equal(db.rpcCalls[0].name, 'project_instruction_submit');
  assert.equal(db.rpcCalls[0].args.p_document, BODY.document); assert.equal(db.rpcCalls[0].args.p_receipt_hash, hash(TOKEN));
  assert.equal(JSON.stringify(db.rpcCalls).includes(TOKEN), false); assert.equal(JSON.stringify(response.data).includes('document'), false);
  assert.equal(response.headers['Cache-Control'], 'no-store, private');
});
test('동의·문서 검증 실패와 200KB초과 요청은 DB쓰기를 하지 않는다', async () => {
  const db = fakeDb();
  for (const body of [makeBody({ consent: { ...BODY.consent, age14: false } }), makeBody({ document: '' })]) assert.equal((await call(db, 'submit', { body })).code, 400);
  assert.equal((await call(db, 'submit', { body: makeBody(), headers: { 'content-length': '204801' } })).code, 413);
  assert.equal((await call(db, 'submit', { body: '{broken json' })).code, 400);
  assert.equal((await call(db, 'submit', { body: makeBody(), headers: { 'content-type': 'text/plain' } })).code, 415);
  assert.equal(db.rpcCalls.length, 0);
});
test('RPC의 replay/conflict/closed/quota 결과를 안정된 HTTP와 code로 반환한다', async () => {
  for (const [result, expected] of [['replayed', 200], ['conflict', 409], ['class_closed', 409], ['class_missing', 404], ['rate_limited', 429]]) {
    const db = fakeDb({ rpc: async () => ({ data: { status: result, id: ID, submittedAt: NOW, expiresAt: calendarYearsLater(NOW) }, error: null }) });
    const response = await call(db, 'submit', { body: makeBody() }); assert.equal(response.code, expected);
    if (result === 'replayed') assert.equal(response.data.replayed, true); else assert.equal(response.data.code, result);
  }
});
test('관리자는 getUser와profiles.is_admin true로만 확인하고 user_metadata권한을 믿지 않는다', async () => {
  assert.equal((await call(fakeDb(), 'admin-list')).code, 401);
  assert.equal((await call(fakeDb(), 'admin-list', { headers: { authorization: 'Bearer invalid' } })).code, 401);
  for (const profile of [false, 'true', 1, null]) assert.equal((await call(fakeDb({ profile }), 'admin-list', { headers: admin })).code, 403);
});
test('list/detail은 만료 정각부터 원문을 제외하고 목록은 해시와 원문을 반환하지 않는다', async () => {
  const active = sampleRow(), expired = sampleRow({ id: KEY, expires_at: NOW }); const db = fakeDb({ rows: [active, expired] });
  const list = await call(db, 'admin-list', { headers: admin });
  assert.equal(list.code, 200); assert.equal(list.data.total, 1); assert.equal(list.data.retention.expiredCount, 1);
  assert.equal(list.data.submissions.length, 1);
  assert.equal(JSON.stringify(list.data).includes('receipt_token_hash'), false); assert.equal(JSON.stringify(list.data).includes('<script>'), false);
  const detail = await call(db, 'admin-detail', { headers: admin, query: { id: KEY } }); assert.equal(detail.code, 404);
  const raw = await call(db, 'admin-detail', { headers: admin, query: { id: ID } }); assert.equal(raw.data.submission.document, active.document);
  assert.equal(raw.data.submission.receiptToken, undefined);
});
test('통계RPC와 페이지목록은 동일 class/q/시점 조건을 사용한다', async () => {
  const db = fakeDb({ rows: [sampleRow()] });
  const result = await call(db, 'admin-list', { headers: admin, query: { classId: CLASS, q: '회의', page: '2' } }); assert.equal(result.code, 200);
  assert.deepEqual(db.rpcCalls.find(call => call.name === 'project_instruction_stats').args, { p_class_id: CLASS, p_q: '회의', p_at: NOW });
  const listing = db.queries.find(query => query.projection?.includes('participation'));
  assert.ok(listing.filters.some(filter => filter[0] === 'class_id' && filter[2] === CLASS));
  assert.ok(listing.filters.some(filter => filter[0] === 'expires_at' && filter[2] === NOW));
});
test('공개강의조회는 하나의명시코드만 조회하며 개인정보응답을 노출하지 않는다', async () => {
  const db = fakeDb(); const result = await call(db, 'class', { query: { code: 'abcdefghijk12345' } });
  assert.equal(result.code, 200); assert.equal(result.data.class.institution, '기관');
  assert.equal((await call(db, 'class')).code, 400);
  assert.equal((await call(db, 'class', { query: { code: 'notfound12345' } })).code, 404);
});
test('receipt철회는 token hash와만료조건으로 보호하고 원문은 보존,편집본은 지운다', async () => {
  const row = sampleRow(); const db = fakeDb({ rows: [row] });
  const bad = await call(db, 'receipt-withdraw', { body: { action: 'receipt-withdraw', id: ID, receiptToken: 'ff'.repeat(32) } }); assert.equal(bad.code, 404); assert.equal(row.case_study, true);
  const ok = await call(db, 'receipt-withdraw', { body: { action: 'receipt-withdraw', id: ID, receiptToken: TOKEN } }); assert.equal(ok.code, 200);
  assert.equal(row.case_study, false); assert.equal(row.case_draft, ''); assert.equal(row.case_updated_at, null); assert.equal(row.document, '# 원문 <script>alert(1)</script>');
  const expiredDb = fakeDb({ rows: [sampleRow({ expires_at: NOW })] });
  assert.equal((await call(expiredDb, 'receipt-withdraw', { body: { id: ID, receiptToken: TOKEN } })).code, 404);
});
test('삭제는원자RPC를사용하고 잘못된영수증과미존재는generic404', async () => {
  const db = fakeDb({ rpc: async () => ({ data: false, error: null }) });
  assert.equal((await call(db, 'receipt-delete', { body: { id: ID, receiptToken: 'bad' } })).code, 404); assert.equal(db.rpcCalls.length, 0);
  assert.equal((await call(db, 'receipt-delete', { body: { id: ID, receiptToken: TOKEN } })).code, 404);
  assert.deepEqual(db.rpcCalls[0], { name: 'project_instruction_delete', args: { p_id: ID, p_receipt_hash: hash(TOKEN), p_admin: false } });
});
test('사례저장은현재동의와기간을 UPDATE조건으로검사해 철회후저장을 막는다', async () => {
  for (const row of [sampleRow({ case_study: false, case_draft: '' }), sampleRow({ expires_at: NOW })]) {
    const db = fakeDb({ rows: [row] });
    const result = await call(db, 'admin-save-case', { headers: admin, body: { id: ID, caseDraft: '새 편집본' } }); assert.equal(result.code, 409); assert.notEqual(row.case_draft, '새 편집본');
  }
  const row = sampleRow(), db = fakeDb({ rows: [row] }); const result = await call(db, 'admin-save-case', { headers: admin, body: { id: ID, caseDraft: '새 편집본' } }); assert.equal(result.code, 200); assert.equal(row.case_draft, '새 편집본'); assert.equal(row.document, '# 원문 <script>alert(1)</script>');
});
test('정리helper는전용RPC만호출하고 SQL은새테이블만다룬다', async () => {
  const db = fakeDb({ rpc: async () => ({ data: 5, error: null }) }); assert.deepEqual(await purgeProjectInstructions(db), { deleted: 5 }); assert.equal(db.rpcCalls[0].name, 'purge_project_instructions');
  const sql = await readFile(new URL('../supabase/project-instructions.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /delete\s+from\s+(?:auth\.|public\.(?:profiles|enrollments|orders))|security\s+definer/i);
  assert.match(sql, /interval '3 years'/); assert.match(sql, /project_instruction_tombstones/); assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /revoke all on function public\.project_instruction_submit/);
  assert.match(sql, /from public, anon, authenticated/);
});
test('관리자화면은sameorigin API와 안전한원문표시를쓰고 저장중상세창전환을막는다', async () => {
  const source = await readFile(new URL('../assets/project-instruction-admin.js', import.meta.url), 'utf8');
  assert.match(source, /const API = '\/api\/project-instruction'/); assert.doesNotMatch(source, /BCC_API_BASE|innerHTML/);
  assert.match(source, /original-text'\)\.textContent = submission\.document/);
  assert.match(source, /if \(state\.busy\) return false/);
  assert.match(source, /state\.detail\?\.id !== id/);
});
