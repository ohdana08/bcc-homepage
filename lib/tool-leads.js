// 잇툴즈 도구 이용 신청 — 이름·휴대전화(필수)·이메일(선택)을 받아 tool_leads에 저장한다.
// 입력 원문은 로그에 남기지 않는다. IP는 일별 HMAC 해시로만 2일간 오남용 확인에 쓴다.
import { createHmac } from 'node:crypto';

export const TOOL_LEAD_CONSENT_VERSION = '2026-11-12-v1';
const TOOLS = new Set([
  'funnel-map', 'bmc',
  'business-process', 'customer-persona', 'customer-interview', 'business-filter', 'ppt-plan', 'press-release', 'cardnews-plan', 'instagram-profile', 'video-storyboard', 'storyboard-caption', 'customer-psychology', 'detail-page', 'cover-motivation', 'cover-aspiration', 'cover-growth', 'cover-strength', 'self-development', 'issue-opinion', 'conflict-collab', 'job-analysis', 'ksa-extract', 'value-worldcup', 'self-awareness',
]);
const MAX_BYTES = 4000;
const DAILY_LIMIT = 80; // 강의장은 교육생 전원이 같은 와이파이(IP)를 쓴다
const RETENTION_DAYS = 365;
const fail = (status, message) => Object.assign(new Error(message), { httpStatus: status });

function parse(req) {
  if (Number(req.headers?.['content-length']) > MAX_BYTES) throw fail(413, '입력 내용이 너무 큽니다.');
  if (req.headers?.['content-type'] && !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) throw fail(415, 'JSON 형식으로 전송해 주세요.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BYTES) throw fail(413, '입력 내용이 너무 큽니다.');
    try { body = JSON.parse(String(body)); } catch { throw fail(400, '입력 형식을 확인해 주세요.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '입력 내용을 확인해 주세요.');
  return body;
}

function str(value, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw fail(400, '입력 길이와 형식을 확인해 주세요.');
  return value.trim();
}

const SOURCE_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'landing'];
function source(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw fail(400, '유입 정보 형식을 확인해 주세요.');
  const out = {};
  for (const key of SOURCE_KEYS) {
    const v = str(value[key], 200);
    if (v) out[key] = v.replace(/[\u0000-\u001f]/g, '');
  }
  return out;
}

export function normalizeLead(body) {
  const tool = str(body.tool, 40);
  if (!TOOLS.has(tool)) throw fail(400, '지원하지 않는 도구입니다.');
  const name = str(body.name, 40);
  if (!name) throw fail(400, '이름을 입력해 주세요.');
  const phone = str(body.phone, 20).replace(/[\s-]/g, '');
  if (!/^01[0-9]{8,9}$/.test(phone)) throw fail(400, '휴대전화 번호를 확인해 주세요. 예: 010-1234-5678');
  const email = str(body.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, '이메일 주소를 확인해 주세요.');
  if (body.consent !== true || body.overseas_consent !== true || body.consent_version !== TOOL_LEAD_CONSENT_VERSION) {
    throw fail(400, '개인정보 수집·이용과 국외 처리 안내에 동의해 주세요.');
  }
  if (body.marketing_consent !== undefined && typeof body.marketing_consent !== 'boolean') throw fail(400, '소식 받기 선택을 확인해 주세요.');
  return {
    tool, name, phone, email: email || null,
    marketing_consent: body.marketing_consent === true,
    consent_version: TOOL_LEAD_CONSENT_VERSION,
    overseas_consent: true,
    source: source(body.source),
  };
}

function checked(result) {
  if (result.error) throw fail(503, '지금은 신청을 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  return result.data;
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

export async function handleToolLeads(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw fail(405, '지원하지 않는 요청 방식입니다.'); }
    const origin = req.headers?.origin;
    const approved = new Set(['https://bccconsulting.kr', 'https://www.bccconsulting.kr']);
    if (process.env.VERCEL_URL) approved.add(`https://${process.env.VERCEL_URL}`);
    const local = process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || '');
    if (origin && !approved.has(origin) && !local) throw fail(403, 'BCC 잇툴즈 페이지에서 신청해 주세요.');
    const body = parse(req);

    if (body.action === 'submit') {
      if (body.website) throw fail(400, '신청을 처리하지 못했습니다.');
      const lead = normalizeLead(body);
      const db = deps.db || (await import('./supabase.js')).supabaseAdmin();
      const now = deps.now ? deps.now() : Date.now();
      const pepper = deps.rateSecret || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!pepper) throw fail(503, '신청 환경을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.');
      const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').slice(0, 150);
      const day = new Date(now).toISOString().slice(0, 10);
      const bucket = createHmac('sha256', pepper).update(`tool-leads:${day}:${ip}`).digest('hex');
      const since1d = new Date(now - 86400000).toISOString();

      // 정리: 2일 지난 IP 해시 제거, 보유기간 지난 신청 삭제
      await db.from('tool_leads').update({ ip_bucket: null }).lt('created_at', new Date(now - 2 * 86400000).toISOString()).not('ip_bucket', 'is', null);
      await db.from('tool_leads').delete().lt('created_at', new Date(now - RETENTION_DAYS * 86400000).toISOString());

      const countResult = await db.from('tool_leads').select('id', { count: 'exact', head: true }).eq('ip_bucket', bucket).gte('created_at', since1d);
      if (countResult.error) throw fail(503, '지금은 신청을 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      if ((countResult.count || 0) >= DAILY_LIMIT) throw fail(429, '오늘 신청이 너무 많습니다. 내일 다시 시도해 주세요.');

      // 하루 안에 같은 번호로 다시 신청하면 새 줄을 만들지 않고, 새로 받은 이메일·소식 동의만 반영한다.
      // 응답은 항상 같게 해서 특정 번호의 신청 여부를 알아낼 수 없게 한다.
      const dup = checked(await db.from('tool_leads').select('id,email,marketing_consent').eq('phone', lead.phone).eq('tool', lead.tool).gte('created_at', since1d).limit(1));
      if (Array.isArray(dup) && dup.length) {
        const patch = {};
        if (lead.email && lead.email !== dup[0].email) patch.email = lead.email;
        if (lead.marketing_consent && !dup[0].marketing_consent) patch.marketing_consent = true;
        if (Object.keys(patch).length) checked(await db.from('tool_leads').update(patch).eq('id', dup[0].id));
        return res.status(200).json({ ok: true });
      }

      checked(await db.from('tool_leads').insert({ ...lead, ip_bucket: bucket }));
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'list' || body.action === 'delete') {
      if (!req.headers?.authorization) throw fail(401, '관리자 로그인이 필요합니다.');
      const db = deps.db || (await import('./supabase.js')).supabaseAdmin();
      await requireAdmin(db, req);
      if (body.action === 'list') {
        const rows = checked(await db.from('tool_leads')
          .select('id,tool,name,phone,email,marketing_consent,consent_version,source,created_at')
          .order('created_at', { ascending: false }).limit(1000));
        return res.json({ leads: rows, limited: rows.length >= 1000 });
      }
      if (!Number.isInteger(body.id) || body.id < 1) throw fail(400, '삭제할 신청을 확인해 주세요.');
      checked(await db.from('tool_leads').delete().eq('id', body.id));
      return res.json({ ok: true });
    }
    throw fail(400, '지원하지 않는 요청입니다.');
  } catch (error) {
    return res.status(error.httpStatus || 503).json({ error: error.httpStatus ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
