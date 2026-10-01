const ERROR_MESSAGES = {
  401: '관리자 로그인이 필요합니다.',
  403: '관리자만 사용할 수 있습니다.',
  405: '지원하지 않는 요청 방식입니다.',
  503: '지금은 사주 서비스를 열 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

class RequestError extends Error {
  constructor(status) {
    super(ERROR_MESSAGES[status]);
    this.status = status;
  }
}

function bearerToken(req) {
  // Node normalizes header names to lowercase. Arrays, duplicate credentials,
  // whitespace/control characters and comma-joined values are not credentials.
  const authorization = req.headers?.authorization;
  if (Array.isArray(req.rawHeaders)) {
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() === 'authorization') count += 1;
    }
    if (count > 1) throw new RequestError(401);
  }
  const match = typeof authorization === 'string'
    ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization)
    : null;
  // `$` also matches before a final newline in JavaScript; require full length.
  if (!match || match[0] !== authorization) throw new RequestError(401);
  // Deliberately never read req.query, cookies or client-provided admin flags.
  return match[1];
}

export async function handleSajuAdmin(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new RequestError(405);
    }
    const token = bearerToken(req);
    const db = dependencies.db || (await import('../supabase.js')).supabaseAdmin();
    // Validate with the auth server on every request, then read current access.
    // A decoded JWT, stored session or user_metadata is not an admin decision.
    const userResult = await db.auth.getUser(token);
    const userId = userResult?.data?.user?.id;
    if (userResult?.error || typeof userId !== 'string' || !userId) throw new RequestError(401);
    const profile = await db.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
    if (!profile || profile.error) throw new RequestError(503);
    if (profile.data?.is_admin !== true) throw new RequestError(403);

    // The dispatcher owns a server-only bundle. Do not import or open a public
    // app file here, and never load/decompress the HTML before both auth checks.
    if (typeof dependencies.loadHtml !== 'function') throw new RequestError(503);
    const html = await dependencies.loadHtml();
    if (typeof html !== 'string' || !html.trim()) throw new RequestError(503);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (error) {
    // Never reflect or log tokens, generated HTML, auth/database error details.
    const status = error instanceof RequestError ? error.status : 503;
    return res.status(status).json({ error: ERROR_MESSAGES[status] });
  }
}
