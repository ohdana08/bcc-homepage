import { supabaseAdmin } from '../supabase.js';
import { applyCors } from '../cors.js';
import { CLAUDE101_PRODUCT_ID } from '../groble-course.js';
import { createClaude101SignedAssets } from '../claude101-course-assets.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const productId = String(req.query?.productId || '');
  if (productId !== CLAUDE101_PRODUCT_ID) {
    return res.status(400).json({ error: '지원하지 않는 상품입니다.' });
  }

  const db = supabaseAdmin();
  const { data: { user } = {}, error: userError } = await db.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: '로그인이 만료되었습니다.' });

  const { data: enrollment } = await db
    .from('enrollments')
    .select('paid_at')
    .eq('user_id', user.id)
    .eq('product_id', productId)
    .eq('status', 'active')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!enrollment) return res.status(403).json({ allowed: false });
  const lessons = await createClaude101SignedAssets(
    db,
    process.env.CLAUDE101_STORAGE_BUCKET,
    3600,
  );
  return res.json({ allowed: true, productId, paidAt: enrollment.paid_at, lessons });
}
