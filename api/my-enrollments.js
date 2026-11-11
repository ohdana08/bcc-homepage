// GET /api/my-enrollments — 로그인 토큰을 검증하고 본인 프로필(관리자 여부 포함)만 돌려준다.
// 관리자 화면(admin.html 등)이 관리자 확인에 쓴다. 손님용 수강이력 조회는 2026-11-12 제거.
// 이름은 기존 관리자 화면 호환을 위해 유지한다.
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });

  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });

  const { data: profile } = await db
    .from('profiles').select('name, email, is_admin').eq('id', user.id).single();

  return res.json({ profile: profile || null, enrollments: [] });
}
