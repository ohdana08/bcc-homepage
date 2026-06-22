// POST /api/illustrate — 관리자 전용 AI 일러스트 생성(2탄 스타일)
// 카드 1장당 1회 호출(프롬프트 → 투명배경 PNG base64 반환). 클라이언트가 라이트 카드에 올린다.
// ★ OPENAI_API_KEY 는 이 서버 함수에만 존재한다. 미설정이면 503 → 프론트가 일러스트 없이 진행.
// Vercel 응답 4.5MB 제한 때문에 "배치"가 아니라 카드당 1장씩 받는다.
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

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY 미설정' });

  const { prompt } = req.body || {};
  if (!prompt || String(prompt).trim().length < 4) {
    return res.status(400).json({ error: 'prompt 가 필요합니다.' });
  }

  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        prompt: String(prompt).slice(0, 900),
        n: 1,
        size: '1024x1024',
        quality: process.env.OPENAI_IMAGE_QUALITY || 'low', // low|medium|high
        background: 'transparent',
        output_format: 'png',
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || ('이미지 생성 실패(' + r.status + ')');
      return res.status(r.status === 429 ? 429 : 502).json({ error: msg });
    }
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return res.status(502).json({ error: '이미지 응답이 비어 있습니다.' });
    return res.json({ b64 });
  } catch (err) {
    console.error('illustrate error:', err?.message || err);
    return res.status(500).json({ error: '일러스트 생성 중 오류가 발생했습니다.' });
  }
}
