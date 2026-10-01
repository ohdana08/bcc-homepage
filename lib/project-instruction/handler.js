import { randomBytes } from 'node:crypto';
import { POLICY_VERSION, MAX_BODY_BYTES, MAX_DOCUMENT_LENGTH, normalizeSubmission, httpError, object, onlyKeys, boundedString, uuid, receiptToken, classCode, hash, documentTitle, publicClass, submissionSummary } from './model.js';

const SUBMISSIONS = 'project_instruction_submissions';
const CLASSES = 'project_instruction_classes';
const SUMMARY_COLUMNS = 'id,class_id,title,participation,submitted_at,expires_at,consent_version,age14,internal_consent,overseas_consent,case_study,case_updated_at,case_withdrawn_at';
const CLASS_COLUMNS = 'id,public_code,institution,course,session,is_open,created_at';
const GET_ACTIONS = new Set(['health', 'class', 'admin-list', 'admin-detail']);
const POST_ACTIONS = new Set(['submit', 'receipt-delete', 'receipt-withdraw', 'admin-create-class', 'admin-set-class', 'admin-save-case', 'admin-delete']);
function checked(result) { if (result.error) throw httpError(503, '지금은 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return result.data; }
function queryValue(query, key, fallback = '') { const value = query?.[key]; if (value === undefined) return fallback; if (typeof value !== 'string') throw httpError(400, '요청 주소를 확인해 주세요.'); return value; }
function parseBody(req) {
  const length = Number(req.headers?.['content-length']);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw httpError(413, '제출 내용의 크기가 너무 큽니다.');
  if (req.headers?.['content-type'] && !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) throw httpError(415, 'JSON 형식으로 요청해 주세요.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw httpError(413, '제출 내용의 크기가 너무 큽니다.');
    try { body = JSON.parse(String(body)); } catch { throw httpError(400, '제출 내용을 확인해 주세요.'); }
  }
  object(body, '요청 내용');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) throw httpError(413, '제출 내용의 크기가 너무 큽니다.');
  return body;
}
async function requireAdmin(db, req) {
  const auth = req.headers?.authorization;
  const token = typeof auth === 'string' && /^Bearer\s+\S+$/i.test(auth) ? auth.replace(/^Bearer\s+/i, '') : '';
  if (!token) throw httpError(401, '관리자 로그인이 필요합니다.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user?.id) throw httpError(401, '관리자 로그인을 다시 해주세요.');
  const profile = await db.from('profiles').select('is_admin').eq('id', data.user.id).maybeSingle();
  if (profile.error) throw httpError(503, '관리자 권한을 확인하지 못했습니다.');
  if (profile.data?.is_admin !== true) throw httpError(403, '관리자만 사용할 수 있습니다.');
  return data.user;
}
function receiptBody(body) {
  onlyKeys(body, ['action', 'id', 'receiptToken']);
  // Invalid tokens and unknown/expired IDs intentionally share the same response.
  try { return { id: uuid(body.id), tokenHash: hash(receiptToken(body.receiptToken)) }; }
  catch { throw httpError(404, '제출 확인 정보를 찾을 수 없습니다.'); }
}
function filters(builder, { classId, q, now }) {
  let next = builder.gt('expires_at', now);
  if (classId) next = next.eq('class_id', classId);
  if (q) next = next.ilike('title', '%' + q.replace(/[\\%_]/g, '\\$&') + '%');
  return next;
}
async function adminList(db, req, now) {
  const rawPage = queryValue(req.query, 'page', '1');
  if (!/^[1-9]\d{0,5}$/.test(rawPage)) throw httpError(400, '목록 페이지를 확인해 주세요.');
  const page = Number(rawPage), pageSize = 30;
  const classId = queryValue(req.query, 'classId');
  if (classId) uuid(classId);
  const q = boundedString(queryValue(req.query, 'q'), 100, '검색어');
  const scope = { classId, q, now };
  const [classes, rows, statistics, retention, expired] = await Promise.all([
    db.from(CLASSES).select(CLASS_COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).limit(1000),
    filters(db.from(SUBMISSIONS).select(SUMMARY_COLUMNS, { count: 'exact' }), scope).order('submitted_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
    db.rpc('project_instruction_stats', { p_class_id: classId || null, p_q: q, p_at: now }),
    db.from('project_instruction_retention_status').select('last_success_at,deleted_count').eq('id', true).maybeSingle(),
    db.from(SUBMISSIONS).select('id', { count: 'exact', head: true }).lte('expires_at', now),
  ]);
  [classes, rows, statistics, retention, expired].forEach(checked);
  return { classes: (classes.data || []).map(publicClass), classesTruncated: (classes.count || 0) > (classes.data || []).length,
    submissions: (rows.data || []).map(submissionSummary), total: rows.count || 0, page, pageSize,
    stats: statistics.data,
    retention: { lastSuccessAt: retention.data?.last_success_at || null, deletedCount: Number(retention.data?.deleted_count || 0), expiredCount: expired.count || 0 } };

}
export async function handleProjectInstruction(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const method = req.method || 'GET';
    if (!['GET', 'POST'].includes(method)) { res.setHeader('Allow', 'GET, POST'); throw httpError(405, '지원하지 않는 요청 방식입니다.'); }
    const body = method === 'POST' ? parseBody(req) : {};
    const action = queryValue(req.query, 'action') || body.action;
    if (typeof action !== 'string' || !(method === 'GET' ? GET_ACTIONS : POST_ACTIONS).has(action)) throw httpError(400, '지원하지 않는 요청입니다.');
    if (body.action !== undefined && body.action !== action) throw httpError(400, '요청 종류를 확인해 주세요.');
    if (action === 'health') {
      const configured = !!dependencies.db || !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
      return res.status(configured ? 200 : 503).json({ configured, policyVersion: POLICY_VERSION });
    }
    const db = dependencies.db || (await import('../supabase.js')).supabaseAdmin();
    const now = new Date(dependencies.now ? dependencies.now() : Date.now()).toISOString();
    const admin = action.startsWith('admin-') ? await requireAdmin(db, req) : null;
    if (action === 'class') {
      const code = classCode(queryValue(req.query, 'code'));
      if (!code) throw httpError(400, '강의 링크를 확인해 주세요.');
      const row = checked(await db.from(CLASSES).select(CLASS_COLUMNS).eq('public_code', code).maybeSingle());
      if (!row) throw httpError(404, '강의 링크를 찾을 수 없습니다.');
      return res.json({ class: publicClass(row) });
    }
    if (action === 'submit') {
      const { normalized, tokenHash, payloadHash } = normalizeSubmission(body);
      const result = checked(await db.rpc('project_instruction_submit', {
        p_key: normalized.idempotencyKey, p_receipt_hash: tokenHash, p_payload_hash: payloadHash,
        p_class_code: normalized.classCode, p_participation: normalized.participation, p_document: normalized.document,
        p_title: documentTitle(normalized.document), p_consent_version: POLICY_VERSION, p_case_study: normalized.consent.caseStudy,
      }));
      if (!result || !['created', 'replayed'].includes(result.status)) {
        const failure = { conflict: [409, '이미 사용했거나 내용이 달라진 제출 정보입니다.'], class_missing: [404, '강의 링크를 찾을 수 없습니다.'], class_closed: [409, '이 강의의 결과물 제출이 마감되었습니다.'], rate_limited: [429, '지금은 제출이 많습니다. 잠시 후 다시 시도해 주세요.'], invalid: [400, '제출 내용을 확인해 주세요.'] }[result?.status] || [503, '제출을 완료하지 못했습니다.'];
        if (failure[0] === 429) res.setHeader('Retry-After', '3600');
        throw Object.assign(httpError(...failure), { code: result?.status || 'unavailable' });
      }
      return res.status(result.status === 'created' ? 201 : 200).json({ id: result.id, submittedAt: result.submittedAt, expiresAt: result.expiresAt, replayed: result.status === 'replayed' });
    }
    if (action === 'receipt-delete' || action === 'receipt-withdraw') {
      const { id, tokenHash } = receiptBody(body);
      if (action === 'receipt-delete') {
        const deleted = checked(await db.rpc('project_instruction_delete', { p_id: id, p_receipt_hash: tokenHash, p_admin: false }));
        if (!deleted) throw httpError(404, '제출 확인 정보를 찾을 수 없습니다.');
      } else {
        const row = checked(await db.from(SUBMISSIONS).update({ case_study: false, case_draft: '', case_updated_at: null, case_withdrawn_at: now }).eq('id', id).eq('receipt_token_hash', tokenHash).gt('expires_at', now).select('id').maybeSingle());
        if (!row) throw httpError(404, '제출 확인 정보를 찾을 수 없습니다.');
      }
      return res.json({ ok: true });
    }
    if (action === 'admin-list') return res.json(await adminList(db, req, now));
    if (action === 'admin-detail') {
      const id = uuid(queryValue(req.query, 'id'));
      const row = checked(await db.from(SUBMISSIONS).select(SUMMARY_COLUMNS + ',document,case_draft').eq('id', id).gt('expires_at', now).maybeSingle());
      if (!row) throw httpError(404, '보관 중인 제출 자료를 찾을 수 없습니다.');
      return res.json({ submission: { ...submissionSummary(row), document: row.document, caseDraft: row.case_draft || '' } });
    }
    if (action === 'admin-create-class') {
      onlyKeys(body, ['action', 'institution', 'course', 'session']);
      const row = { public_code: randomBytes(18).toString('base64url'), institution: boundedString(body.institution, 120, '기관명', true), course: boundedString(body.course, 120, '강의명', true), session: boundedString(body.session, 120, '회차', true), created_by: admin.id };
      const created = checked(await db.from(CLASSES).insert(row).select(CLASS_COLUMNS).single());
      return res.status(201).json({ class: publicClass(created) });
    }
    if (action === 'admin-set-class') {
      onlyKeys(body, ['action', 'id', 'isOpen']);
      if (typeof body.isOpen !== 'boolean') throw httpError(400, '강의 접수 상태를 확인해 주세요.');
      const row = checked(await db.from(CLASSES).update({ is_open: body.isOpen }).eq('id', uuid(body.id)).select(CLASS_COLUMNS).maybeSingle());
      if (!row) throw httpError(404, '강의를 찾을 수 없습니다.');
      return res.json({ class: publicClass(row) });
    }
    if (action === 'admin-save-case') {
      onlyKeys(body, ['action', 'id', 'caseDraft']);
      if (typeof body.caseDraft !== 'string' || body.caseDraft.length > MAX_DOCUMENT_LENGTH || body.caseDraft.includes('\0')) throw httpError(400, '사례 편집본은 60,000자까지 입력해 주세요.');
      // The authorization condition is part of the UPDATE, not a stale prior read.
      const row = checked(await db.from(SUBMISSIONS).update({ case_draft: body.caseDraft, case_updated_at: now }).eq('id', uuid(body.id)).eq('case_study', true).gt('expires_at', now).select('id,case_updated_at').maybeSingle());
      if (!row) throw httpError(409, '사례 사용 동의가 없거나 보관이 끝난 자료입니다.');
      return res.json({ ok: true, caseUpdatedAt: row.case_updated_at });
    }
    if (action === 'admin-delete') {
      onlyKeys(body, ['action', 'id']);
      const deleted = checked(await db.rpc('project_instruction_delete', { p_id: uuid(body.id), p_receipt_hash: null, p_admin: true }));
      if (!deleted) throw httpError(404, '보관 중인 제출 자료를 찾을 수 없습니다.');
      return res.json({ ok: true });
    }
    throw httpError(400, '지원하지 않는 요청입니다.');
  } catch (error) {
    // Never log payloads, documents, receipt tokens or database error detail.
    return res.status(Number.isInteger(error.status) ? error.status : 503).json({ error: Number.isInteger(error.status) ? error.message : '지금은 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: error.code || (error.status === 400 ? 'invalid' : 'unavailable') });
  }
}
