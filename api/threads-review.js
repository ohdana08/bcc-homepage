import callbackHandler from '../meta-app-review/implementation/api/threads-oauth-callback.js';
import startHandler from '../meta-app-review/implementation/api/threads-oauth-start.js';
import pageHandler from '../meta-app-review/implementation/api/threads-review.js';

export default async function handler(req, res) {
  const action = String(req.query?.action || '');
  if (action === 'oauth_start') return startHandler(req, res);
  if (
    action === 'deauthorize'
    || action === 'delete'
    || req.query?.code
    || req.query?.error
    || req.query?.state
  ) {
    return callbackHandler(req, res);
  }
  return pageHandler(req, res);
}
