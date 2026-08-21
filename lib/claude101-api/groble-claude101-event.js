import { supabaseAdmin } from '../supabase.js';
import {
  CLAUDE101_PRODUCT_ID,
  isGroblePaymentCompleted,
  isGroblePaymentRefunded,
  isValidSellerReference,
  parseGrobleCourseEvent,
  safeSecretEqual,
} from '../groble-course.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const expectedSecret = process.env.BCC_GROBLE_FORWARD_SECRET;
  const receivedSecret = req.headers['x-bcc-groble-secret'];
  if (!expectedSecret || !safeSecretEqual(receivedSecret, expectedSecret)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const event = parseGrobleCourseEvent(req.body);
  const expectedContentId = String(process.env.GROBLE_CLAUDE101_CONTENT_ID || '').trim();
  if (!event || !expectedContentId || event.contentId !== expectedContentId) {
    return res.status(202).json({ ok: true, ignored: true });
  }
  if (!isValidSellerReference(event.sellerReference) || !event.merchantUid) {
    return res.status(422).json({ error: 'invalid Groble reference' });
  }

  const db = supabaseAdmin();
  const providerOrderId = `groble:${event.merchantUid}`;

  if (isGroblePaymentRefunded(event.type)) {
    await db
      .from('enrollments')
      .update({ status: 'refunded' })
      .eq('order_id', providerOrderId)
      .eq('product_id', CLAUDE101_PRODUCT_ID);
    await db
      .from('pending_orders')
      .update({ status: 'refunded' })
      .eq('order_id', event.sellerReference)
      .eq('product_id', CLAUDE101_PRODUCT_ID);
    return res.json({ ok: true, action: 'refunded' });
  }

  if (!isGroblePaymentCompleted(event.type)) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const { data: existing } = await db
    .from('enrollments')
    .select('id')
    .eq('order_id', providerOrderId)
    .maybeSingle();
  if (existing) return res.json({ ok: true, alreadyProcessed: true });

  const { data: pending, error: pendingError } = await db
    .from('pending_orders')
    .select('*')
    .eq('order_id', event.sellerReference)
    .eq('product_id', CLAUDE101_PRODUCT_ID)
    .maybeSingle();
  if (pendingError || !pending) return res.status(422).json({ error: 'pending order not found' });
  if (pending.status !== 'pending' && pending.status !== 'paid') {
    return res.status(409).json({ error: 'pending order is not payable' });
  }
  if (event.amount === null || event.amount !== pending.amount) {
    return res.status(422).json({ error: 'payment amount mismatch' });
  }

  const { error: enrollmentError } = await db.from('enrollments').insert({
    user_id: pending.user_id,
    product_id: CLAUDE101_PRODUCT_ID,
    paid_amount: pending.amount,
    is_recourse: false,
    order_id: providerOrderId,
    provider: 'groble',
    provider_order_id: event.merchantUid,
    status: 'active',
  });
  if (enrollmentError && enrollmentError.code !== '23505') {
    return res.status(500).json({ error: 'enrollment write failed' });
  }

  await db.from('profiles').update({ status: 'active' }).eq('id', pending.user_id);
  await db
    .from('pending_orders')
    .update({ status: 'paid', provider: 'groble', provider_order_id: event.merchantUid })
    .eq('order_id', event.sellerReference);

  return res.json({ ok: true, action: 'enrolled' });
}
