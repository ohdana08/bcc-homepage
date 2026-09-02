import { REVIEW_SCOPES, deletionConfirmation, parseCookies, parseSignedRequest, reviewConfig, sealSession, threadsFetch, verifyState } from '../../../lib/threads-review.js';

function signedRequestFrom(req) {
  if (typeof req.body === 'string') return new URLSearchParams(req.body).get('signed_request') || '';
  if (Buffer.isBuffer(req.body)) return new URLSearchParams(req.body.toString()).get('signed_request') || '';
  return String(req.body?.signed_request || '');
}

export default async function handler(req, res) {
  const config = reviewConfig();
  const action = String(req.query?.action || '');
  if (req.method === 'POST' && (action === 'deauthorize' || action === 'delete')) {
    const payload = parseSignedRequest(signedRequestFrom(req), config.appSecret);
    if (!payload?.user_id) return res.status(400).json({ error: '유효하지 않은 signed_request입니다.' });
    res.setHeader('Cache-Control', 'no-store');
    if (action === 'deauthorize') return res.status(200).json({ success: true });
    const code = deletionConfirmation(payload.user_id, config.appSecret);
    const statusUrl = new URL('/api/threads-review', config.redirectUri);
    statusUrl.searchParams.set('deletion', code);
    return res.status(200).json({ url: statusUrl.toString(), confirmation_code: code });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: '허용되지 않은 요청입니다.' });
  const cookies = parseCookies(req.headers.cookie);
  const state = String(req.query?.state || '');
  if (!verifyState(state, config.sessionSecret) || state !== cookies.threads_review_state) {
    return res.redirect(302, '/api/threads-review?status=oauth_error&reason=state');
  }
  if (req.query?.error || !req.query?.code) {
    return res.redirect(302, '/api/threads-review?status=oauth_denied');
  }
  try {
    const tokenUrl = new URL('https://graph.threads.com/oauth/access_token');
    const body = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
      code: String(req.query.code),
    });
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokenData = await response.json().catch(() => ({}));
    if (!response.ok || !tokenData.access_token) throw new Error(tokenData?.error_message || 'OAuth 토큰 교환 실패');
    const tokenDebug = await threadsFetch('/debug_token', {
      token: tokenData.access_token,
      params: { input_token: tokenData.access_token },
    });
    if (!tokenDebug?.data?.is_valid) throw new Error('OAuth 토큰 검증 실패');
    const grantedScopes = new Set(tokenDebug.data.scopes || []);
    const permissions = REVIEW_SCOPES.filter((permission) => grantedScopes.has(permission))
      .map((permission) => ({ permission, status: 'granted' }));
    const session = sealSession({
      token: tokenData.access_token,
      permissions,
      createdAt: Date.now(),
    }, config.sessionSecret);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', [
      `threads_review_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/api/threads-review; Max-Age=3600`,
      'threads_review_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    ]);
    return res.redirect(302, '/api/threads-review?status=connected');
  } catch {
    return res.redirect(302, '/api/threads-review?status=oauth_error&reason=exchange');
  }
}
