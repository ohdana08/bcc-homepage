import crypto from 'node:crypto';

export const THREADS_API_BASE = 'https://graph.threads.com/v1.0';
export const THREADS_OAUTH_BASE = 'https://threads.com/oauth/authorize';
export const REVIEW_SCOPES = ['threads_basic', 'threads_keyword_search'];

function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function keyFromSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

export function reviewConfig(env = process.env) {
  return {
    appId: required(env, 'THREADS_REVIEW_APP_ID'),
    appSecret: required(env, 'THREADS_REVIEW_APP_SECRET'),
    redirectUri: required(env, 'THREADS_REVIEW_REDIRECT_URI'),
    sessionSecret: required(env, 'THREADS_REVIEW_SESSION_SECRET'),
  };
}

export function createState(secret, now = Date.now()) {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ nonce, iat: now })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyState(state, secret, now = Date.now()) {
  const [payload, signature] = String(state || '').split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return false; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(parsed.iat) && now - parsed.iat >= 0 && now - parsed.iat <= 10 * 60_000;
  } catch { return false; }
}

export function buildAuthorizationUrl(config, state) {
  const url = new URL(THREADS_OAUTH_BASE);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', REVIEW_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

export function sealSession(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function openSession(value, secret) {
  try {
    const [iv, tag, encrypted] = String(value || '').split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  } catch { return null; }
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
  }));
}

export function parseSignedRequest(value, secret) {
  const [encodedSignature, encodedPayload] = String(value || '').split('.');
  if (!encodedSignature || !encodedPayload) return null;
  let supplied;
  try { supplied = Buffer.from(encodedSignature, 'base64url'); } catch { return null; }
  const expected = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try { return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')); } catch { return null; }
}

export function deletionConfirmation(userId, secret) {
  return crypto.createHmac('sha256', secret).update(String(userId || 'anonymous')).digest('hex').slice(0, 24);
}

export async function threadsFetch(path, { token, params = {}, fetchImpl = fetch }) {
  const url = new URL(`${THREADS_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const error = new Error(body?.error?.message || `Threads API HTTP ${response.status}`);
    error.code = body?.error?.code || response.status;
    throw error;
  }
  return body;
}

export function safeApiError(error) {
  const raw = String(error?.message || 'Threads API 요청에 실패했습니다.');
  const message = raw
    .replace(/(access[_ -]?token|client[_ -]?secret|token)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 300);
  return { message, code: error?.code || null };
}
