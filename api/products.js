// GET /api/products — 판매 중 상품 목록(가격 표시용). 공개.
// 실제 결제 금액은 절대 이 값을 신뢰하지 않고 create-checkout 가 서버에서 재산정한다.
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const { data, error } = await supabaseAdmin()
    .from('products')
    .select('id, name, price, recourse_price')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: '상품 조회 실패' });
  return res.json({ products: data || [] });
}
