// POST /api/confirm-payment  — 가장 중요한 함수
// 토스 successUrl 리다이렉트 후 프론트가 { paymentKey, orderId, amount } 로 호출.
//   1) 우리 DB 주문 금액과 대조 (★조작 방지 핵심★)
//   2) 토스 승인 API 호출 (서버에서만, 시크릿 키)
//   3) 승인 성공 → enrollment 기록(멱등) + 계정 active
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { paymentKey, orderId } = req.body || {};
  const amount = Number(req.body?.amount);
  if (!paymentKey || !orderId || !Number.isFinite(amount))
    return res.status(400).json({ error: '결제 정보가 올바르지 않습니다.' });

  const db = supabaseAdmin();

  // 0) 멱등: 이미 처리된 주문이면 토스 재호출 없이 성공 반환 (새로고침 대비)
  const { data: existing } = await db
    .from('enrollments')
    .select('order_id, product_id, paid_amount, products(name)')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existing) {
    return res.json({
      success: true,
      alreadyProcessed: true,
      orderName: existing.products?.name || null,
      amount: existing.paid_amount,
    });
  }

  // 1) 우리 DB 주문 금액과 대조 (★조작 방지 핵심★)
  const { data: order } = await db
    .from('pending_orders').select('*').eq('order_id', orderId).single();
  if (!order)
    return res.status(400).json({ error: '존재하지 않는 주문입니다.' });
  if (order.status === 'expired')
    return res.status(400).json({ error: '만료된 주문입니다. 다시 신청해 주세요.' });
  if (order.amount !== amount)
    return res.status(400).json({ error: '결제 금액이 일치하지 않습니다.' });

  // 2) 토스 승인 API 호출 (서버에서만)
  const secret = process.env.TOSS_SECRET_KEY;
  if (!secret) return res.status(500).json({ error: '결제 설정 오류' });

  let tossData;
  try {
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(secret + ':').toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    tossData = await tossRes.json();
    if (!tossRes.ok) {
      return res.status(400).json({
        error: tossData?.message || '결제 승인에 실패했습니다.',
        code: tossData?.code,
      });
    }
  } catch (e) {
    return res.status(502).json({ error: '결제 승인 서버 통신 오류' });
  }

  // 3) 승인 성공 → enrollment 기록(order_id UNIQUE 로 중복 방지) + 계정 active
  const { error: enrErr } = await db.from('enrollments').insert({
    user_id: order.user_id,
    product_id: order.product_id,
    paid_amount: order.amount,
    is_recourse: order.is_recourse,
    order_id: orderId,
  });
  // 동시성으로 이미 들어갔다면(23505) 멱등 성공 처리
  if (enrErr && enrErr.code !== '23505')
    return res.status(500).json({ error: '수강 등록 저장 실패 (결제는 승인됨, 관리자 문의)' });

  await db.from('profiles').update({ status: 'active' }).eq('id', order.user_id);
  await db.from('pending_orders').update({ status: 'paid' }).eq('order_id', orderId);

  // GA purchase 이벤트용 데이터 반환
  const { data: product } = await db
    .from('products').select('name').eq('id', order.product_id).single();

  return res.json({
    success: true,
    orderName: product?.name || null,
    amount: order.amount,
    isRecourse: order.is_recourse,
    productId: order.product_id,
    customerEmail: (await db.from('profiles').select('email').eq('id', order.user_id).single()).data?.email || null,
  });
}
