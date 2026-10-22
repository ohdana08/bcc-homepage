import { CASE_STATUSES, LEDGER_FIELDS, date, fail, integer, normalizeLedgerSnapshot, normalizeOperations, normalizePayment, normalizeSettings, only, settlementView, text, timestamp, uuid } from './lecture-operations-domain.js';

const PAGE = 100;
const CASE_COLUMNS = 'id,institution_id,institution_name,project_name,contact_name,contact_email,contact_phone,status,next_action,next_action_at,lecture_date,budget,audience,audience_size,goals,created_at,updated_at';
const OP_COLUMNS = 'case_id,revision,sessions,checklist,updated_at';
const FINANCE_URL = 'https://epyaaenpnljoqycccesz.supabase.co';
const ACTION_KEYS = {
  config: [], list: ['page'], detail: ['case_id'],
  case_update: ['case_id', 'expected_updated_at', 'mutation_id', 'fields'],
  save_operations: ['case_id', 'expected_revision', 'mutation_id', 'sessions', 'checklist'],
  finance_list: ['page'], finance_detail: ['case_id'],
  finance_link: ['case_id', 'mutation_id', 'lecture_id', 'expected_lecture', 'create', 'opening_received', 'settings'],
  finance_save: ['case_id', 'expected_revision', 'mutation_id', 'settings'],
  finance_payment: ['case_id', 'expected_revision', 'mutation_id', 'payment'],
  finance_void: ['case_id', 'expected_revision', 'mutation_id', 'payment_id', 'reason'],
};
const emptyOperation = case_id => ({ case_id, revision: 0, sessions: [], checklist: { materials_ready: false, venue_ready: false, documents_ready: false, completed: false, notes: '' }, updated_at: null });

function checked(result) {
  if (result?.error) {
    if (['23505', '40001', '40P01'].includes(result.error.code)) throw fail(409, '다른 창에서 변경되었습니다. 최신 내용을 다시 확인해 주세요.', 'conflict');
    throw fail(503, '저장소에 연결할 수 없습니다. 입력을 유지한 채 다시 시도해 주세요.', 'storage_unavailable');
  }
  return result?.data;
}
async function rpc(db, name, params) {
  const data = checked(await db.rpc(name, params));
  const errors = {
    not_found: [404, '해당 강의 기록을 찾을 수 없습니다.'], forbidden: [403, '이 기록을 처리할 권한이 없습니다.'],
    conflict: [409, '다른 창에서 변경되었거나 요청 내용이 달라졌습니다. 최신 내용을 다시 확인해 주세요.'],
    already_linked: [409, '이미 다른 강의 건에 연결된 장부입니다.'], schedule_conflict: [409, '같은 강사의 확정 시간이 다른 강의와 겹칩니다.'],
    invalid: [400, '입력 내용을 확인해 주세요.'], negative_received: [400, '환불·취소 후 입금 합계가 0원보다 작아질 수 없습니다.'],
    limit: [400, '이 강의 건의 기록 한도를 초과했습니다.'], ledger_changed: [409, '기존 수입 장부가 변경되었습니다. 다시 불러온 뒤 연결해 주세요.'],
  };
  if (data?.error) {
    const [status, message] = errors[data.error] || [503, '저장하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.'];
    throw fail(status, message, errors[data.error] ? data.error : 'storage_unavailable');
  }
  if (!data || typeof data !== 'object') throw fail(503, '저장 결과를 확인하지 못했습니다.', 'storage_unavailable');
  return data;
}
function bearer(value, finance = false) {
  if (typeof value !== 'string' || !/^Bearer \S+$/i.test(value) || value.length > 16384) throw fail(401, finance ? '정산 장부 연결 로그인이 필요합니다.' : '관리자 로그인이 필요합니다.', finance ? 'finance_auth_required' : 'auth_required');
  return value.slice(7);
}
async function requireAdmin(db, token) {
  const result = await db.auth.getUser(token);
  if (result.error || !result.data?.user?.id) throw fail(401, '관리자 로그인을 다시 해주세요.', 'auth_required');
  const profile = checked(await db.from('profiles').select('is_admin').eq('id', result.data.user.id).maybeSingle());
  if (profile?.is_admin !== true) throw fail(403, '관리자만 사용할 수 있습니다.', 'forbidden');
  return result.data.user;
}
export function financeConfig(env = process.env) {
  const url = env.FINANCE_SUPABASE_URL || FINANCE_URL;
  const key = env.FINANCE_SUPABASE_ANON_KEY || '';
  let publicKey = key.startsWith('sb_publishable_');
  if (!publicKey && key.split('.').length === 3) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { publicKey = false; }
  }
  // Never send service_role credentials or a differently scoped project to the browser.
  return url === FINANCE_URL && publicKey ? { enabled: true, url, anonKey: key } : { enabled: false };
}
async function requireFinance(req, dependencies) {
  const token = bearer(req.headers?.['x-finance-authorization'], true);
  let db = dependencies.financeDb;
  if (!db) {
    const config = financeConfig();
    if (!config.enabled) throw fail(503, '정산 장부 연결 설정을 준비하고 있습니다.', 'finance_not_configured');
    const { createClient } = await import('@supabase/supabase-js');
    db = createClient(config.url, config.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  }
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data?.user?.id) throw fail(401, '정산 장부에 다시 로그인해 주세요.', 'finance_auth_required');
  if (checked(await db.rpc('is_finance_owner')) !== true) throw fail(403, '재무 소유자만 정산 장부를 사용할 수 있습니다.', 'finance_forbidden');
  return { db, user: auth.data.user };
}
async function caseRecord(db, id, includeInquiry = false) {
  const row = checked(await db.from('proposal_cases').select(CASE_COLUMNS + (includeInquiry ? ',inquiry_text' : '')).eq('id', id).maybeSingle());
  if (!row) throw fail(404, '해당 강의 기록을 찾을 수 없습니다.', 'not_found');
  return row;
}
async function financeDetail(db, ownerId, caseId) {
  const settlement = checked(await db.from('lecture_finance_links').select('*').eq('owner_id', ownerId).eq('case_id', caseId).maybeSingle());
  if (!settlement) return { settlement: null, payments: [] };
  const payments = checked(await db.from('lecture_finance_payments').select('id,case_id,kind,amount,date,note,voided_at,void_reason,created_at').eq('owner_id', ownerId).eq('case_id', caseId).order('created_at').limit(500));
  return { settlement: settlementView(settlement), payments };
}
function parse(req) {
  if (Number(req.headers?.['content-length']) > 60000) throw fail(413, '입력 내용이 너무 큽니다.');
  if (req.headers?.['content-type'] && !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) throw fail(415, 'JSON 형식으로 전송해 주세요.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > 60000) throw fail(413, '입력 내용이 너무 큽니다.');
    try { body = JSON.parse(String(body)); } catch { throw fail(400, '입력 형식을 확인해 주세요.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '입력 내용을 확인해 주세요.');
  if (Buffer.byteLength(JSON.stringify(body)) > 60000) throw fail(413, '입력 내용이 너무 큽니다.');
  if (!Object.hasOwn(ACTION_KEYS, body.action)) throw fail(400, '지원하지 않는 요청입니다.');
  return only(body, ['action', ...ACTION_KEYS[body.action]]);
}

export async function handleLectureOperations(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw fail(405, '지원하지 않는 요청 방식입니다.'); }
    const origins = new Set(['https://bccconsulting.kr', 'https://www.bccconsulting.kr']);
    if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
    const origin = req.headers?.origin;
    if (origin && !origins.has(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) throw fail(403, 'BCC 관리자 화면에서 접속해 주세요.');
    const token = bearer(req.headers?.authorization);
    const body = parse(req);
    const db = dependencies.db || (await import('./supabase.js')).supabaseAdmin();
    const admin = await requireAdmin(db, token);
    if (body.action === 'config') return res.status(200).json({ finance: dependencies.financeConfig || financeConfig() });
    if (body.action === 'list') {
      const page = integer(body.page ?? 0, 0, 10000);
      const fetched = checked(await db.from('proposal_cases').select(CASE_COLUMNS).order('created_at', { ascending: false }).order('id').range(page * PAGE, page * PAGE + PAGE));
      const cases = fetched.slice(0, PAGE), ids = cases.map(row => row.id);
      const operations = ids.length ? checked(await db.from('lecture_operations').select(OP_COLUMNS).in('case_id', ids)) : [];
      return res.status(200).json({ cases, operations, next_page: fetched.length > PAGE ? page + 1 : null, limited: fetched.length > PAGE });
    }
    if (body.action === 'finance_list') {
      const finance = await requireFinance(req, dependencies);
      const page = integer(body.page ?? 0, 0, 10000);
      const fetched = checked(await finance.db.from('lectures').select(LEDGER_FIELDS).eq('user_id', finance.user.id).order('date', { ascending: false }).order('id').range(page * PAGE, page * PAGE + PAGE));
      const lectures = fetched.slice(0, PAGE), ids = lectures.map(row => row.id);
      const settlements = ids.length ? checked(await finance.db.from('lecture_finance_links').select('*').eq('owner_id', finance.user.id).in('lecture_id', ids)) : [];
      return res.status(200).json({ lectures, settlements: settlements.map(settlementView), next_page: fetched.length > PAGE ? page + 1 : null, limited: fetched.length > PAGE });
    }
    const caseId = uuid(body.case_id);
    const record = await caseRecord(db, caseId, body.action === 'detail');
    if (body.action === 'detail') {
      const [request, surveys, operation, history] = await Promise.all([
        db.from('lecture_requests').select('receipt,case_id,payload,revision,created_at,updated_at').eq('case_id', caseId).maybeSingle(),
        db.from('training_need_surveys').select('id,title,public_code,status,is_sample,created_at').eq('case_id', caseId).order('created_at', { ascending: false }).limit(100),
        db.from('lecture_operations').select(OP_COLUMNS).eq('case_id', caseId).maybeSingle(),
        db.from('lecture_operations_history').select('id,action,revision,created_at').eq('case_id', caseId).order('created_at', { ascending: false }).limit(30),
      ]);
      return res.status(200).json({ case: record, request: checked(request), surveys: checked(surveys), operation: checked(operation) || emptyOperation(caseId), history: checked(history) });
    }
    if (body.action === 'case_update') {
      only(body.fields, ['status', 'next_action', 'next_action_at']);
      if (!CASE_STATUSES.includes(body.fields.status)) throw fail(400, '진행 상태를 확인해 주세요.');
      const fields = { status: body.fields.status, next_action: text(body.fields.next_action, 1000), next_action_at: timestamp(body.fields.next_action_at, true) };
      // Keep the database's microsecond precision in the optimistic-lock token.
      timestamp(body.expected_updated_at);
      return res.status(200).json(await rpc(db, 'lecture_ops_case_update', { p_case_id: caseId, p_admin: admin.id, p_updated_at: body.expected_updated_at, p_mutation: uuid(body.mutation_id), p_fields: fields }));
    }
    if (body.action === 'save_operations') {
      const payload = normalizeOperations(body);
      return res.status(200).json(await rpc(db, 'lecture_ops_save', { p_case_id: caseId, p_admin: admin.id, p_revision: integer(body.expected_revision), p_mutation: uuid(body.mutation_id), p_payload: payload }));
    }
    const finance = await requireFinance(req, dependencies);
    if (body.action === 'finance_detail') return res.status(200).json(await financeDetail(finance.db, finance.user.id, caseId));
    const mutation = uuid(body.mutation_id);
    let action, payload, revision = 0;
    if (body.action === 'finance_link') {
      action = 'link';
      payload = { settings: normalizeSettings(body.settings), opening_received: integer(body.opening_received) };
      if (body.lecture_id) {
        if (body.create) throw fail(400, '기존 장부 연결과 새 강의 등록 중 하나를 선택해 주세요.');
        payload.lecture_id = uuid(body.lecture_id);
        payload.expected_lecture = normalizeLedgerSnapshot(body.expected_lecture);
        if (payload.expected_lecture.id !== payload.lecture_id) throw fail(400, '선택한 장부 기록을 다시 확인해 주세요.');
      } else {
        if (body.expected_lecture) throw fail(400, '새 장부 등록 내용을 확인해 주세요.');
        only(body.create, ['date', 'organization', 'topic']);
        payload.create = { date: date(body.create.date), organization: text(body.create.organization, 200, true), topic: text(body.create.topic, 300) };
      }
    } else {
      revision = integer(body.expected_revision, 1);
      if (body.action === 'finance_save') { action = 'settings'; payload = { settings: normalizeSettings(body.settings) }; }
      if (body.action === 'finance_payment') { action = 'payment'; payload = { payment: normalizePayment(body.payment) }; }
      if (body.action === 'finance_void') { action = 'void'; payload = { payment_id: uuid(body.payment_id), reason: text(body.reason, 500, true) }; }
    }
    const result = await rpc(finance.db, 'lecture_finance_mutate', { p_case_id: caseId, p_action: action, p_revision: revision, p_mutation: mutation, p_payload: payload });
    return res.status(200).json({ ...result, settlement: settlementView(result.settlement) });
  } catch (error) {
    const status = error.httpStatus || 503;
    return res.status(status).json({ error: error.httpStatus ? error.message : '처리하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.', code: error.publicCode || (status >= 500 ? 'unavailable' : 'invalid') });
  }
}
