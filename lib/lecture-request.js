import { createHash, createHmac } from 'node:crypto';

export const CONSENT_VERSION = '2026-10-21-v1';
const MAX_BYTES = 40000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_FIELDS = {
  institution_name: 160, contact_name: 80, contact_email: 254, contact_phone: 40,
  project_name: 160, audience: 500, age_range: 100, ai_experience: 500, ai_tools: 500,
  lecture_date: 10, date_notes: 300, time: 100, location: 500, desk_layout: 200,
  computer_access: 300, tool_access: 300, purpose: 2000, learner_expectations: 2000,
  organizer_expectations: 2000, desired_outputs: 2000, required_documents: 1000,
  deadline_notes: 300, special_notes: 2000, parking: 500, total_budget_range: 100, lecturer_fee_range: 100,
};
const NUMBERS = { audience_size: [1, 100000, true], duration_hours: [0.25, 1000, false], total_budget: [0, 2147483647, true], lecturer_fee: [0, 2147483647, true] };
const PUBLIC = new Set(['submit', 'get', 'update']);
const ADMIN = new Set(['list', 'create_institution', 'link_institution', 'ensure_survey']);
const fail = (status, message) => Object.assign(new Error(message), { httpStatus: status });
const hash = (value) => createHash('sha256').update(value).digest('hex');
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '입력 내용을 확인해 주세요.'); return value; }
function text(value, max, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw fail(400, `${field} 입력 길이와 형식을 확인해 주세요.`);
  return value.trim();
}
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) throw fail(400, '기록 번호를 확인해 주세요.'); return value; }
function keyHash(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw fail(404, '수정 링크를 확인해 주세요.'); return hash(value); }
export function normalizePayload(input) {
  object(input);
  const allowed = new Set([...Object.keys(TEXT_FIELDS), ...Object.keys(NUMBERS), 'equipment', 'schedule_candidates']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw fail(400, '지원하지 않는 입력 항목입니다.');
  const payload = {};
  for (const [field, max] of Object.entries(TEXT_FIELDS)) payload[field] = text(input[field], max, field);
  for (const [field, [min, max, integer]] of Object.entries(NUMBERS)) {
    const value = input[field];
    if (value === '' || value === null || value === undefined) { payload[field] = null; continue; }
    if (!['number', 'string'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value))) throw fail(400, `${field} 숫자를 확인해 주세요.`);
    const num = Number(value);
    if (!Number.isFinite(num) || num < min || num > max || (integer && !Number.isInteger(num))) throw fail(400, `${field} 범위를 확인해 주세요.`);
    payload[field] = num;
  }
  if (input.equipment !== undefined && (!Array.isArray(input.equipment) || input.equipment.length > 10)) throw fail(400, '장비 항목을 확인해 주세요.');
  payload.equipment = [...new Set((input.equipment || []).map(v => text(v, 80, '장비')))];
  for (const field of ['institution_name', 'contact_name', 'contact_email', 'audience', 'purpose']) if (!payload[field]) throw fail(400, '기관명·담당자·이메일·교육대상·교육목적을 입력해 주세요.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.contact_email)) throw fail(400, '이메일 주소를 확인해 주세요.');
  if (payload.lecture_date && (!/^\d{4}-\d{2}-\d{2}$/.test(payload.lecture_date) || !Number.isFinite(Date.parse(payload.lecture_date)) || new Date(payload.lecture_date).toISOString().slice(0,10) !== payload.lecture_date)) throw fail(400, '강의 날짜를 확인해 주세요.');
  const candidates = input.schedule_candidates === undefined
    ? (payload.lecture_date || payload.time ? [{ lecture_date: payload.lecture_date, time: payload.time }] : [])
    : input.schedule_candidates;
  if (!Array.isArray(candidates) || candidates.length > 5) throw fail(400, '날짜·시간 후보는 최대 5개까지 입력해 주세요.');
  payload.schedule_candidates = candidates.map((candidate) => {
    object(candidate);
    if (Object.keys(candidate).some((key) => !['lecture_date', 'time'].includes(key))) throw fail(400, '날짜·시간 후보 항목을 확인해 주세요.');
    const lecture_date = text(candidate.lecture_date, 10, '희망 날짜');
    const time = text(candidate.time, 100, '희망 시간대');
    if (lecture_date && (!/^\d{4}-\d{2}-\d{2}$/.test(lecture_date) || !Number.isFinite(Date.parse(lecture_date)) || new Date(lecture_date).toISOString().slice(0,10) !== lecture_date)) throw fail(400, '강의 날짜를 확인해 주세요.');
    return { lecture_date, time };
  }).filter((candidate) => candidate.lecture_date || candidate.time);
  const dates = [...new Set(payload.schedule_candidates.map((candidate) => candidate.lecture_date).filter(Boolean))];
  // Multiple requested dates must not silently become one confirmed survey date.
  payload.lecture_date = dates.length === 1 ? dates[0] : '';
  payload.time = payload.schedule_candidates.length === 1 ? payload.schedule_candidates[0].time : '';
  return payload;
}
function parse(req) {
  if (Number(req.headers?.['content-length']) > MAX_BYTES) throw fail(413, '입력 내용이 너무 큽니다.');
  if (req.headers?.['content-type'] && !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) throw fail(415, 'JSON 형식으로 전송해 주세요.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BYTES) throw fail(413, '입력 내용이 너무 큽니다.');
    try { body = JSON.parse(String(body)); } catch { throw fail(400, '입력 형식을 확인해 주세요.'); }
  }
  object(body);
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BYTES) throw fail(413, '입력 내용이 너무 큽니다.');
  return body;
}
function checked(result) { if (result.error) throw fail(503, '지금은 저장소에 연결할 수 없습니다. 입력을 유지한 채 잠시 후 다시 시도해 주세요.'); return result.data; }
async function rpc(db, name, args) {
  const result = checked(await db.rpc(name, args));
  if (result?.error === 'not_found') throw fail(404, '수정 링크가 올바르지 않거나 유효기간이 지났습니다.');
  if (result?.error === 'conflict') throw fail(409, '다른 창에서 수정되었거나 이미 접수된 요청입니다. 수정 링크를 다시 열어 확인해 주세요.');
  if (result?.error === 'limit') throw fail(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  if (result?.error) throw fail(503, '현재 접수를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return result;
}
async function requireAdmin(db, req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !/^Bearer \S+$/i.test(header)) throw fail(401, '관리자 로그인이 필요합니다.');
  const result = await db.auth.getUser(header.slice(7));
  if (result.error || !result.data?.user?.id) throw fail(401, '관리자 로그인을 다시 해주세요.');
  const profile = checked(await db.from('profiles').select('is_admin').eq('id', result.data.user.id).maybeSingle());
  if (profile?.is_admin !== true) throw fail(403, '관리자만 사용할 수 있습니다.');
  return result.data.user;
}
async function adminList(db) {
  const [institutions, cases, requests, surveys] = await Promise.all([
    db.from('lecture_institutions').select('id,name').order('name').limit(1000),
    db.from('proposal_cases').select('*').order('updated_at', { ascending: false }).limit(500),
    db.from('lecture_requests').select('case_id,receipt,payload,revision,created_at,updated_at').order('updated_at', { ascending: false }).limit(500),
    db.from('training_need_surveys').select('id,case_id,title,public_code,status,is_sample,training_need_responses(count)').order('created_at', { ascending: false }).limit(1000),
  ]);
  return { institutions: checked(institutions), cases: checked(cases), requests: checked(requests), surveys: checked(surveys).map(({training_need_responses, ...s}) => ({ ...s, response_count: training_need_responses?.[0]?.count || 0 })), limited: (cases.data?.length || 0) >= 500 || (institutions.data?.length || 0) >= 1000 || (surveys.data?.length || 0) >= 1000 };
}
export async function handleLectureRequest(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw fail(405, '지원하지 않는 요청 방식입니다.'); }
    const origin = req.headers?.origin;
    const approvedOrigins = new Set(['https://bccconsulting.kr', 'https://www.bccconsulting.kr']);
    if (process.env.VERCEL_URL) approvedOrigins.add(`https://${process.env.VERCEL_URL}`);
    if (origin && !approvedOrigins.has(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) throw fail(403, 'BCC 강의의뢰 페이지에서 접속해 주세요.');
    const body = parse(req);
    if (!PUBLIC.has(body.action) && !ADMIN.has(body.action)) throw fail(400, '지원하지 않는 요청입니다.');
    if (['owner_id', 'case_id', 'institution_id', 'status'].some(k => k in body) && PUBLIC.has(body.action)) throw fail(400, '지원하지 않는 입력 항목입니다.');
    // Reject missing admin credentials before connecting to any database.
    if (ADMIN.has(body.action) && !req.headers?.authorization) throw fail(401, '관리자 로그인이 필요합니다.');
    if (PUBLIC.has(body.action)) {
      keyHash(body.key);
      if (body.action === 'submit') id(body.idempotency_key); else id(body.receipt);
      if (body.action !== 'get') {
        if (body.website) throw fail(400, '제출을 처리하지 못했습니다.');
        if (body.consent !== true || body.overseas_consent !== true || body.consent_version !== CONSENT_VERSION) throw fail(400, '개인정보 수집·이용과 국외 처리 안내에 동의해 주세요.');
        body.payload = normalizePayload(body.payload);
      }
      if (body.action === 'update' && (!Number.isInteger(body.expected_revision) || body.expected_revision < 1)) throw fail(400, '수정 버전을 확인해 주세요.');
    }
    const db = dependencies.db || (await import('./supabase.js')).supabaseAdmin();
    if (PUBLIC.has(body.action)) {
      // Vercel overwrites x-forwarded-for. Only a daily keyed digest is stored.
      const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').slice(0,150);
      const day = new Date(dependencies.now ? dependencies.now() : Date.now()).toISOString().slice(0,10);
      const pepper = dependencies.rateSecret || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!pepper) throw fail(503, '접수 환경을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.');
      const bucket = createHmac('sha256', pepper).update(`${day}:${ip}`).digest('hex');
      await rpc(db, 'lecture_request_rate', { p_bucket: bucket, p_action: body.action });
      if (body.action === 'submit') {
        const result = await rpc(db, 'lecture_request_submit', { p_key_hash: keyHash(body.key), p_idempotency: body.idempotency_key, p_payload: body.payload, p_consent_version: CONSENT_VERSION });
        return res.status(result.duplicate ? 200 : 201).json(result);
      }
      if (body.action === 'get') return res.json(await rpc(db, 'lecture_request_get', { p_receipt: body.receipt, p_key_hash: keyHash(body.key) }));
      return res.json(await rpc(db, 'lecture_request_update', { p_receipt: body.receipt, p_key_hash: keyHash(body.key), p_payload: body.payload, p_revision: body.expected_revision, p_consent_version: CONSENT_VERSION }));
    }
    const user = await requireAdmin(db, req);
    if (body.action === 'list') return res.json(await adminList(db));
    if (body.action === 'create_institution') {
      const name = text(body.name, 160, '기관명');
      if (!name) throw fail(400, '기관명을 입력해 주세요.');
      const institution = checked(await db.from('lecture_institutions').insert({ name, created_by: user.id }).select('id,name').single());
      return res.status(201).json({ institution });
    }
    if (body.action === 'link_institution') {
      const target = checked(await db.from('lecture_institutions').select('id').eq('id', id(body.institution_id)).maybeSingle());
      if (!target) throw fail(404, '기관을 찾을 수 없습니다.');
      const row = checked(await db.from('proposal_cases').update({ institution_id: target.id, updated_at: new Date().toISOString() }).eq('id', id(body.case_id)).select('id').maybeSingle());
      if (!row) throw fail(404, '강의 기록을 찾을 수 없습니다.');
      return res.json({ ok: true });
    }
    const result = await rpc(db, 'lecture_request_ensure_survey', { p_case_id: id(body.case_id), p_admin: user.id });
    return res.json({ ...result, url: `https://bccconsulting.kr/tools/training-needs/?form=${encodeURIComponent(result.survey.public_code)}` });
  } catch (error) {
    return res.status(error.httpStatus || 503).json({ error: error.httpStatus ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
