import { boundedString, httpError, object, onlyKeys, uuid } from './model.js';
import { normalizeUsageEvent, normalizeUsageOwner, usageWriteHash, USAGE_MAX_BODY_BYTES, USAGE_POLICY_VERSION } from './telemetry-model.js';

const GET_ACTIONS = new Set(['health', 'admin-summary', 'admin-detail']);
const POST_ACTIONS = new Set(['enable', 'status', 'rotate', 'revoke', 'event']);
function checked(result) { if (result.error) throw httpError(503, '지금은 사용 기록을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return result.data; }
function queryValue(query, key, fallback = '') { const value = query?.[key]; if (value === undefined) return fallback; if (typeof value !== 'string') throw httpError(400, '요청 주소를 확인해 주세요.'); return value; }
function parseBody(req) {
  const length = Number(req.headers?.['content-length']);
  if (Number.isFinite(length) && length > USAGE_MAX_BODY_BYTES) throw httpError(413, '사용 기록의 크기가 너무 큽니다.');
  if (typeof req.headers?.['content-type'] !== 'string' || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'])) throw httpError(415, 'JSON 형식으로 요청해 주세요.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > USAGE_MAX_BODY_BYTES) throw httpError(413, '사용 기록의 크기가 너무 큽니다.');
    try { body = JSON.parse(String(body)); } catch { throw httpError(400, '사용 기록 요청을 확인해 주세요.'); }
  }
  object(body, '요청 내용');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > USAGE_MAX_BODY_BYTES) throw httpError(413, '사용 기록의 크기가 너무 큽니다.');
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
}
function failure(result, res) {
  const [status, message] = {
    missing: [404, '사용 기록 연결 또는 제출 확인 정보를 찾을 수 없습니다.'],
    conflict: [409, '이미 변경되었거나 철회한 연결입니다. 현재 상태를 확인해 주세요.'],
    invalid: [400, '사용 기록의 항목과 값을 확인해 주세요.'],
    rate_limited: [429, '사용 기록 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'],
  }[result?.status] || [503, '지금은 사용 기록을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'];
  if (status === 429) res.setHeader('Retry-After', '86400');
  throw Object.assign(httpError(status, message), { code: result?.status || 'unavailable' });
}
async function detail(db, id, receiptHash, admin, now) {
  const result = checked(await db.rpc('project_instruction_usage_detail', { p_id: id, p_receipt_hash: receiptHash, p_admin: admin, p_at: now }));
  if (!result) throw httpError(404, '사용 기록 연결 또는 제출 확인 정보를 찾을 수 없습니다.');
  return result;
}
export async function handleProjectInstructionUsage(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const method = req.method || 'GET';
    if (!['GET', 'POST'].includes(method)) { res.setHeader('Allow', 'GET, POST'); throw httpError(405, '지원하지 않는 요청 방식입니다.'); }
    const body = method === 'POST' ? parseBody(req) : {};
    const action = queryValue(req.query, 'action') || body.action;
    if (typeof action !== 'string' || !(method === 'GET' ? GET_ACTIONS : POST_ACTIONS).has(action)) throw httpError(400, '지원하지 않는 요청입니다.');
    if (body.action !== undefined && body.action !== action) throw httpError(400, '요청 종류를 확인해 주세요.');
    // Tokens are never accepted in URL parameters, including unused/extra parameters.
    onlyKeys(req.query || {}, ['action', 'fn', ...(action === 'admin-summary' ? ['classId', 'q'] : action === 'admin-detail' ? ['id'] : [])]);
    if (req.query?.fn !== undefined && req.query.fn !== 'project-instruction-usage') throw httpError(400, '요청 주소를 확인해 주세요.');
    if (action === 'event' && Object.hasOwn(req.headers || {}, 'origin')) throw httpError(403, '사용 기록은 도구의 서버에서 전송해 주세요.');
    if (action === 'health') {
      const configured = !!dependencies.db || !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
      return res.status(configured ? 200 : 503).json({ configured, policyVersion: USAGE_POLICY_VERSION });
    }
    const db = dependencies.db || (await import('../supabase.js')).supabaseAdmin();
    const now = new Date(dependencies.now ? dependencies.now() : Date.now()).toISOString();
    if (action.startsWith('admin-')) await requireAdmin(db, req);
    if (action === 'admin-summary') {
      const classId = queryValue(req.query, 'classId'), q = boundedString(queryValue(req.query, 'q'), 100, '검색어');
      if (classId) uuid(classId);
      return res.json(checked(await db.rpc('project_instruction_usage_summary', { p_class_id: classId || null, p_q: q, p_at: now })));
    }
    if (action === 'admin-detail') return res.json(await detail(db, uuid(queryValue(req.query, 'id')), null, true, now));
    if (action === 'event') {
      onlyKeys(body, ['action', 'id', 'event']);
      const writeHash = usageWriteHash(req.headers?.authorization);
      let id;
      try { id = uuid(body.id); } catch { throw httpError(404, '사용 기록 연결을 찾을 수 없습니다.'); }
      const event = normalizeUsageEvent(body.event);
      const result = checked(await db.rpc('project_instruction_usage_ingest', { p_id: id, p_write_hash: writeHash, p_event: event }));
      if (!['created', 'replayed'].includes(result?.status)) failure(result, res);
      return res.status(result.status === 'created' ? 201 : 200).json({ ok: true, eventId: result.eventId, receivedAt: result.receivedAt, replayed: result.status === 'replayed', mode: result.mode });
    }
    const owner = normalizeUsageOwner(body, action);
    let status = 200;
    if (action !== 'status') {
      const result = checked(await db.rpc('project_instruction_usage_manage', { p_action: action, p_id: owner.id, p_receipt_hash: owner.receiptHash,
        p_write_hash: owner.writeHash, p_expected_generation: owner.expectedGeneration, p_consent_version: owner.consentVersion }));
      if (!['created', 'replayed', 'updated', 'revoked'].includes(result?.status)) failure(result, res);
      if (result.status === 'created') status = 201;
    }
    return res.status(status).json(await detail(db, owner.id, owner.receiptHash, false, now));
  } catch (error) {
    // No payloads, original documents, credentials, or provider error details are logged.
    return res.status(Number.isInteger(error.status) ? error.status : 503).json({ error: Number.isInteger(error.status) ? error.message : '지금은 사용 기록을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: error.code || (error.status === 400 ? 'invalid' : 'unavailable') });
  }
}
