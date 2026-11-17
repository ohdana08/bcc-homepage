// Public, read-only adapter to the existing persisted-notice recommendation engine.
// Only four enumerated conditions cross this boundary: never cookies, identity,
// authorization, caller IP, arbitrary URLs or extra profile fields. No paid AI call.
const UPSTREAM = 'https://ddakfit.bccconsulting.kr/api/entry/results';
const PRODUCT = 'https://ddakfit.bccconsulting.kr';
const MAX_BYTES = 2048;
const CONDITIONS = Object.freeze({
  age: ['under_30', '30_39', '40_49', '50_plus'],
  region: ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'],
  business: ['pre', 'under_3', '3_7', 'over_7'],
  industry: ['tech', 'manufacturing', 'food', 'retail', 'service', 'other'],
});
const failure = (status, message) => Object.assign(new Error(message), { status });

function allowedOrigin(req, env) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers?.origin;
  if (!origin) return true; // server clients and same-origin clients without Origin
  const allowed = new Set(['https://bccconsulting.kr', 'https://www.bccconsulting.kr']);
  // Exact deployment hostname only, never all *.vercel.app projects.
  if (env.VERCEL_URL && /^[a-z0-9-]+\.vercel\.app$/i.test(env.VERCEL_URL)) allowed.add(`https://${env.VERCEL_URL}`);
  return allowed.has(origin) || (env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
}

function conditions(req) {
  if (Number(req.headers?.['content-length']) > MAX_BYTES) throw failure(413, '입력 크기를 확인해 주세요.');
  if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw failure(415, '입력 형식을 확인해 주세요.');
  let value = req.body;
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    if (Buffer.byteLength(value) > MAX_BYTES) throw failure(413, '입력 크기를 확인해 주세요.');
    try { value = JSON.parse(String(value)); } catch { throw failure(400, '조건을 다시 선택해 주세요.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, '네 가지 조건을 선택해 주세요.');
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw failure(413, '입력 크기를 확인해 주세요.');
  const result = {};
  for (const [key, options] of Object.entries(CONDITIONS)) {
    if (!options.includes(value[key])) throw failure(400, '네 가지 조건을 선택해 주세요.');
    result[key] = value[key];
  }
  return result;
}

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('invalid_notice_url');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) throw new Error('invalid_notice_url');
  return url.href;
}

function normalizedResults(value) {
  if (!value || !Array.isArray(value.results) || value.results.length > 3 ||
      !Number.isSafeInteger(value.total) || value.total < 0 ||
      value.results.length !== Math.min(value.total, 3)) throw new Error('invalid_results');
  const seen = new Set();
  const results = value.results.map((card) => {
    if (!card || typeof card !== 'object') throw new Error('invalid_card');
    const result = {};
    for (const key of ['id', 'title', 'description', 'who', 'amount', 'deadline']) {
      if (typeof card[key] !== 'string' || card[key].length > 12000 || (['id', 'title'].includes(key) && !card[key].trim())) throw new Error('invalid_card');
      result[key] = card[key];
    }
    if (seen.has(result.id)) throw new Error('duplicate_card');
    seen.add(result.id);
    result.url = safeUrl(card.url);
    // Never trust upstream previewUrl as a navigation destination.
    result.previewUrl = `${PRODUCT}/embed?start=direct&noticeUrl=${encodeURIComponent(result.url)}`;
    return result;
  });
  return { results, total: value.total };
}

export async function handleDdakfitRecommendations(req, res, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '조건 선택 후 다시 조회해 주세요.' });
  }
  if (!allowedOrigin(req, env)) return res.status(403).json({ error: '딱지원핏 페이지에서 다시 조회해 주세요.' });
  let input;
  try { input = conditions(req); }
  catch (error) { return res.status(error.status || 400).json({ error: error.status ? error.message : '조건을 다시 선택해 주세요.' }); }
  try {
    const response = await fetchImpl(UPSTREAM, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (!response.ok) throw new Error('upstream_unavailable');
    if (Number(response.headers?.get('content-length')) > 200000) throw new Error('response_too_large');
    const body = await response.text();
    if (Buffer.byteLength(body) > 200000) throw new Error('response_too_large');
    return res.status(200).json(normalizedResults(JSON.parse(body)));
  } catch {
    // An outage must never look like a genuine zero-match response.
    return res.status(503).json({ error: '추천 공고를 불러오지 못했어요. 잠시 후 다시 조회하거나 아래 공고 사이트 모음을 이용해 주세요.' });
  }
}
