import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSellerReference,
  isGroblePaymentCompleted,
  isGroblePaymentRefunded,
  isValidSellerReference,
  parseGrobleCourseEvent,
  safeSecretEqual,
} from '../lib/groble-course.js';

test('Claude101 seller reference is opaque and Groble-safe', () => {
  const ref = createSellerReference();
  assert.match(ref, /^c101_[a-f0-9]{32}$/);
  assert.equal(isValidSellerReference(ref), true);
  assert.equal(ref.includes('@'), false);
});

test('Groble payment event parser reads the documented fields', () => {
  const event = parseGrobleCourseEvent({
    id: 'evt_1',
    type: 'payment.completed',
    data: {
      object: {
        merchantUid: '202608140000000001',
        sellerReference: 'c101_1234567890abcdef1234567890abcdef',
        content: { id: 'nSq3PJ' },
        pricing: { finalAmount: 29000 },
      },
    },
  });
  assert.deepEqual(event, {
    eventId: 'evt_1',
    type: 'payment.completed',
    merchantUid: '202608140000000001',
    sellerReference: 'c101_1234567890abcdef1234567890abcdef',
    contentId: 'nSq3PJ',
    amount: 29000,
  });
  assert.equal(isGroblePaymentCompleted(event.type), true);
  assert.equal(isGroblePaymentRefunded(event.type), false);
});

test('refund event and shared secret checks are strict', () => {
  assert.equal(isGroblePaymentRefunded('payment.refunded'), true);
  assert.equal(isGroblePaymentRefunded('payment.cancel_requested'), false);
  assert.equal(safeSecretEqual('same-secret', 'same-secret'), true);
  assert.equal(safeSecretEqual('same-secret', 'other-secret'), false);
  assert.equal(safeSecretEqual('', ''), false);
});
