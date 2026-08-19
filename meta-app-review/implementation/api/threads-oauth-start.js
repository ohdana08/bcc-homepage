import { buildAuthorizationUrl, createState, reviewConfig } from '../../../lib/threads-review.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET 요청만 허용됩니다.' });
  try {
    const config = reviewConfig();
    const state = createState(config.sessionSecret);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', `threads_review_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
    return res.redirect(302, buildAuthorizationUrl(config, state));
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
}
