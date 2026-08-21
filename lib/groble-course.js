import { randomUUID, timingSafeEqual } from 'node:crypto';

export const CLAUDE101_PRODUCT_ID = 'claude101-pro';

export function createSellerReference() {
  return `c101_${randomUUID().replaceAll('-', '')}`;
}

export function getGrobleObject(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data;
  if (!data || typeof data !== 'object') return null;
  const object = data.object;
  return object && typeof object === 'object' ? object : null;
}

export function parseGrobleCourseEvent(payload) {
  const object = getGrobleObject(payload);
  if (!object) return null;

  const content = object.content && typeof object.content === 'object' ? object.content : {};
  const pricing = object.pricing && typeof object.pricing === 'object' ? object.pricing : {};
  const merchantUid = String(object.merchantUid || '').trim();
  const sellerReference = String(object.sellerReference || '').trim();
  const amount = Number(pricing.finalAmount);

  return {
    eventId: String(payload.id || '').trim(),
    type: String(payload.type || '').trim(),
    merchantUid,
    sellerReference,
    contentId: String(content.id || '').trim(),
    amount: Number.isSafeInteger(amount) ? amount : null,
  };
}

export function isGroblePaymentCompleted(type) {
  return type === 'payment.completed';
}

export function isGroblePaymentRefunded(type) {
  return type === 'payment.refunded';
}

export function isValidSellerReference(value) {
  return /^c101_[a-f0-9]{32}$/.test(String(value || ''));
}

export function safeSecretEqual(received, expected) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
