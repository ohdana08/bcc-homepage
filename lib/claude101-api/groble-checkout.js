import { supabaseAdmin } from '../supabase.js';
import { applyCors } from '../cors.js';
import { CLAUDE101_PRODUCT_ID, createSellerReference } from '../groble-course.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: '로그인 후 결제해 주세요.' });

  const productId = String(req.body?.productId || '');
  if (productId !== CLAUDE101_PRODUCT_ID) {
    return res.status(400).json({ error: '지원하지 않는 상품입니다.' });
  }

  const db = supabaseAdmin();
  const { data: { user } = {}, error: userError } = await db.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: '로그인이 만료되었습니다.' });

  const { data: product, error: productError } = await db
    .from('products')
    .select('id, name, price, is_active')
    .eq('id', productId)
    .maybeSingle();
  if (productError || !product || !product.is_active) {
    return res.status(409).json({ error: '아직 판매 준비 중인 상품입니다.' });
  }

  const { data: existing } = await db
    .from('enrollments')
    .select('id')
    .eq('user_id', user.id)
    .eq('product_id', productId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: '이미 수강권을 보유하고 있습니다.' });

  const contentId = String(process.env.GROBLE_CLAUDE101_CONTENT_ID || '').trim();
  if (!/^[A-Za-z0-9]+$/.test(contentId)) {
    return res.status(503).json({ error: '그로블 결제창 연결이 아직 완료되지 않았습니다.' });
  }

  const reference = createSellerReference();
  const { error: orderError } = await db.from('pending_orders').insert({
    order_id: reference,
    user_id: user.id,
    product_id: product.id,
    amount: product.price,
    is_recourse: false,
    status: 'pending',
    provider: 'groble',
  });
  if (orderError) return res.status(500).json({ error: '결제 준비에 실패했습니다.' });

  const checkoutUrl = new URL(`https://www.groble.im/payment/${contentId}`);
  checkoutUrl.searchParams.set('ref', reference);

  return res.json({
    checkoutUrl: checkoutUrl.toString(),
    orderName: product.name,
    amount: product.price,
  });
}
