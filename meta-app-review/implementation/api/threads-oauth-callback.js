import { parseCookies, reviewConfig, sealSession, threadsFetch, verifyState } from '../../../lib/threads-review.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET 요청만 허용됩니다.' });
  const config = reviewConfig();
  const cookies = parseCookies(req.headers.cookie);
  const state = String(req.query?.state || '');
  if (!verifyState(state, config.sessionSecret) || state !== cookies.threads_review_state) {
    return res.redirect(302, '/api/threads-review?status=oauth_error&reason=state');
  }
  if (req.query?.error || !req.query?.code) {
    return res.redirect(302, '/api/threads-review?status=oauth_denied');
  }
  try {
    const tokenUrl = new URL('https://graph.threads.net/oauth/access_token');
    const body = new URLSearchParams({
      client_id: config.appId,
      client_secret: config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
      code: String(req.query.code),
    });
    const response = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tokenData = await response.json().catch(() => ({}));
    if (!response.ok || !tokenData.access_token) throw new Error(tokenData?.error_message || 'OAuth 토큰 교환 실패');
    const permissions = await threadsFetch('/me/permissions', { token: tokenData.access_token });
    const session = sealSession({ token: tokenData.access_token, permissions: permissions.data || [], createdAt: Date.now() }, config.sessionSecret);
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
