// CORS — 프론트(bccconsulting.kr / GitHub Pages)와 백엔드(Vercel)가 다른 출처라 필요.
// 허용 출처는 ALLOWED_ORIGINS 환경변수(콤마 구분)로 덮어쓸 수 있음.
const DEFAULT_ALLOWED = [
  'https://bccconsulting.kr',
  'https://www.bccconsulting.kr',
  'https://ohdana08.github.io',
];

function allowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ALLOWED;
}

function isLocalhost(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// 반환값 true → preflight(OPTIONS)를 이미 응답했으니 핸들러는 즉시 return 해야 함.
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins().includes(origin) || isLocalhost(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
