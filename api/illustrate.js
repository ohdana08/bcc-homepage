// POST /api/illustrate — 관리자 전용 AI 일러스트(2탄). Pollinations AI(무료·키 불필요) 프록시.
// 캔버스 PNG 내보내기가 깨지지 않도록 서버에서 이미지를 받아 base64 로 돌려준다(CORS 안전).
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 로그인 + 관리자 검증
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });
  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  const { prompt, seed } = req.body || {};
  if (!prompt || String(prompt).trim().length < 4) {
    return res.status(400).json({ error: 'prompt 가 필요합니다.' });
  }

  try {
    const p = String(prompt).slice(0, 900);
    const sd = Number.isFinite(seed) ? seed : 0;
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(p)
      + '?width=1024&height=1024&nologo=true&model=flux&seed=' + sd;
    const r = await fetch(url, { headers: { Accept: 'image/*' } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(r.status === 429 ? 429 : 502).json({ error: '이미지 생성 실패(' + r.status + ') ' + t.slice(0, 120) });
    }
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return res.status(502).json({ error: '이미지 응답이 비어 있습니다.' });
    return res.json({ b64: buf.toString('base64'), mediaType: ct });
  } catch (err) {
    console.error('illustrate error:', err?.message || err);
    return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
  }
}
