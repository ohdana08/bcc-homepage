// POST /api/create-checkout
// 신청 3칸(name/phone/email) + productId 를 받아:
//   1) 상품 조회(가격은 DB에서만)
//   2) 계정 먼저 생성(pending) 또는 기존 계정 조회
//   3) 구매이력 → 재수강 여부 → 금액 결정 (★서버에서만★)
//   4) 주문번호 생성 + pending_orders 저장 + 토스 결제정보 반환
// 절대 원칙: 결제 금액은 프론트에서 결정하지 않는다.
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').replace(/\D/g, ''); // 숫자만 정규화(전화 매칭·합성이메일 일관성)
  const email = String(body.email || '').trim().toLowerCase();
  const productId = String(body.productId || '').trim();
  // 마케팅 정보 수신 동의(선택) — 동의 시 시점도 기록
  const marketingConsent = body.marketingConsent === true;
  const marketingConsentAt = marketingConsent ? new Date().toISOString() : null;
  // 환불(청약철회) 제한 고지 동의(필수) — 결제 건마다 기록(환불 분쟁 증거)
  const refundConsent = body.refundConsent === true;
  const refundConsentAt = refundConsent ? new Date().toISOString() : null;
  // 허니팟(봇 차단): 사람은 비워둠
  if (body.website) return res.status(200).json({ ok: true });

  if (!name || !phone || !email || !productId)
    return res.status(400).json({ error: '이름·연락처·이메일·상품을 모두 입력해 주세요.' });
  if (!EMAIL_RE.test(email))
    return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });

  const db = supabaseAdmin();

  // 1) 상품 조회 — 가격은 DB에서, 프론트 신뢰 금지
  const { data: product, error: pErr } = await db
    .from('products').select('*').eq('id', productId).single();
  if (pErr || !product || !product.is_active)
    return res.status(400).json({ error: '판매하지 않는 상품입니다.' });

  // 2) 계정 먼저 생성(pending) 또는 기존 계정 조회
  //    이메일로 먼저 찾고, 없으면 전화번호로도 조회한다.
  //    (기존 수강생은 전화번호로 시드됨 → 새 이메일로 재신청해도 전화가 같으면 재수강가 연결)
  let { data: profile } = await db
    .from('profiles').select('*').eq('email', email).maybeSingle();
  if (!profile && phone)
    ({ data: profile } = await db.from('profiles').select('*').eq('phone', phone).maybeSingle());

  if (!profile) {
    const { data: created, error: aErr } = await db.auth.admin.createUser({
      email, email_confirm: false,
    });
    if (aErr || !created?.user) {
      // 인증 유저는 있는데 profiles 가 없는 희귀 케이스 대비: 한 번 더 조회
      const retry = await db.from('profiles').select('*').eq('email', email).single();
      if (retry.data) {
        profile = retry.data;
      } else {
        return res.status(500).json({ error: '계정 생성에 실패했습니다.' });
      }
    } else {
      const { data: newProfile, error: insErr } = await db.from('profiles')
        .insert({ id: created.user.id, name, phone, email, status: 'pending', marketing_consent: marketingConsent, marketing_consent_at: marketingConsentAt })
        .select().single();
      if (insErr || !newProfile)
        return res.status(500).json({ error: '프로필 생성에 실패했습니다.' });
      profile = newProfile;
    }
  } else {
    // 아직 결제 전(pending)이면 최신 입력으로 갱신
    const upd = { name, phone };
    // 이번에 마케팅 동의한 경우에만 기록(과거 동의 이력을 미체크로 덮어쓰지 않음)
    if (marketingConsent) { upd.marketing_consent = true; upd.marketing_consent_at = marketingConsentAt; }
    await db.from('profiles').update(upd).eq('id', profile.id);
  }

  // 3) 구매 이력 → 재수강 여부 → 금액 결정 (★서버에서만★)
  const { count } = await db
    .from('enrollments').select('*', { count: 'exact', head: true })
    .eq('user_id', profile.id);
  const isRecourse = (count || 0) > 0;
  const amount = isRecourse
    ? (product.recourse_price ?? product.price)
    : product.price;

  // 4) 주문번호 + pending_orders 저장 (금액 대조 기준)
  const orderId = `${productId}_${profile.id}_${Date.now()}`;
  const { error: oErr } = await db.from('pending_orders').insert({
    order_id: orderId,
    user_id: profile.id,
    product_id: productId,
    amount,
    is_recourse: isRecourse,
    status: 'pending',
    refund_policy_agreed: refundConsent,
    refund_policy_agreed_at: refundConsentAt,
  });
  if (oErr) return res.status(500).json({ error: '주문 생성에 실패했습니다.' });

  return res.json({
    orderId,
    amount,
    isRecourse,
    orderName: product.name,
    customerName: name,
    customerEmail: email,
    customerKey: profile.id, // 토스 customerKey 용 (uuid, 추측 불가)
  });
}
