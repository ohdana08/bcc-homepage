import { openSession, parseCookies, reviewConfig, safeApiError, threadsFetch } from '../../../lib/threads-review.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function page({ connected = false, permissions = [], query = '', results = null, error = null }) {
  const permissionRows = permissions.length ? permissions.map((p) => `<li>${escapeHtml(p.permission || p.name)} — ${escapeHtml(p.status)}</li>`).join('') : '<li>OAuth 연결 후 표시됩니다.</li>';
  const resultRows = Array.isArray(results) ? results.map((item) => `<article><strong>@${escapeHtml(item.username || 'unknown')}</strong><p>${escapeHtml(item.text || '(텍스트 없음)')}</p><small>${escapeHtml(item.timestamp || '')}</small>${item.permalink ? ` <a href="${escapeHtml(item.permalink)}" target="_blank" rel="noreferrer">원문</a>` : ''}</article>`).join('') : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Threads Keyword Search App Review</title><style>body{font:16px system-ui;max-width:860px;margin:40px auto;padding:0 20px;color:#171717}section,article{border:1px solid #ddd;border-radius:12px;padding:18px;margin:14px 0}.notice{background:#f4f7ff}input{padding:11px;width:min(420px,70%)}button,a.button{padding:11px 16px;background:#111;color:#fff;border:0;border-radius:8px;text-decoration:none}.error{color:#a40000}small{color:#666}</style></head><body><h1>Threads 키워드 검색 — 읽기 전용 검수 데모</h1><section class="notice"><strong>안전 고지</strong><p>이 화면은 OAuth, 권한 확인, 키워드 검색만 수행합니다. 게시물·댓글·답글을 생성하거나 수정하지 않습니다.</p></section><section><h2>1. OAuth 연결</h2><p>상태: ${connected ? '연결됨' : '연결 필요'}</p><a class="button" href="/api/threads-oauth-start">Threads로 계속</a></section><section><h2>2. 승인 권한</h2><ul>${permissionRows}</ul></section><section><h2>3. 키워드 검색</h2><form method="get" action="/api/threads-review"><input name="q" value="${escapeHtml(query)}" maxlength="60" placeholder="예: 생성형 AI"><button type="submit">읽기 전용 검색</button></form>${error ? `<p class="error">오류: ${escapeHtml(error.message)}${error.code ? ` (code ${escapeHtml(error.code)})` : ''}</p>` : ''}${results ? `<p>검색 결과 ${results.length}건 (최대 10건 표시)</p>${resultRows || '<p>일치하는 공개 게시물이 없습니다.</p>'}` : ''}</section><section><h2>검수자가 확인할 사항</h2><ol><li>OAuth에서 threads_basic 및 threads_keyword_search 권한을 확인합니다.</li><li>검색어를 입력하고 공개 Threads 결과가 표시되는지 확인합니다.</li><li>이 데모에는 POST 기반 게시·댓글 API가 없음을 확인합니다.</li></ol></section></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET 요청만 허용됩니다.' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  let config;
  try { config = reviewConfig(); } catch (error) { return res.status(503).send(page({ error: { message: error.message } })); }
  const session = openSession(parseCookies(req.headers.cookie).threads_review_session, config.sessionSecret);
  const query = String(req.query?.q || '').trim().slice(0, 60);
  if (!session?.token) return res.status(200).send(page({ query, error: query ? { message: '먼저 OAuth 연결을 완료해 주세요.' } : null }));
  if (!query) return res.status(200).send(page({ connected: true, permissions: session.permissions }));
  try {
    const data = await threadsFetch('/keyword_search', { token: session.token, params: { q: query, search_type: 'TOP', limit: 10, fields: 'id,username,text,timestamp,permalink' } });
    return res.status(200).send(page({ connected: true, permissions: session.permissions, query, results: Array.isArray(data.data) ? data.data.slice(0, 10) : [] }));
  } catch (error) {
    return res.status(502).send(page({ connected: true, permissions: session.permissions, query, error: safeApiError(error) }));
  }
}
