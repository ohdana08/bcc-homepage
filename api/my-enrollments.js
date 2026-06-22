// GET /api/my-enrollments — 로그인 토큰 검증 후 본인 수강이력만
// 프론트(mypage)가 Supabase 로그인 세션의 access_token 을 Bearer 로 전달.
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });

  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });

  const { data, error } = await db
    .from('enrollments')
    .select('id, product_id, paid_amount, is_recourse, order_id, paid_at, products(name)')
    .eq('user_id', user.id)
    .order('paid_at', { ascending: false });

  if (error) return res.status(500).json({ error: '수강이력 조회에 실패했습니다.' });

  const { data: profile } = await db
    .from('profiles').select('name, email, status, is_admin').eq('id', user.id).single();

  return res.json({ profile: profile || null, enrollments: data || [] });
}
