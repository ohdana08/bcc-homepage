// Claude 101 유료 과정 API 묶음 — Vercel Hobby 함수 수 제한 안에서
// 수강권 확인, 그로블 결제 준비, 결제·환불 웹훅을 한 함수로 처리한다.
import courseAccess from '../lib/claude101-api/course-access.js';
import grobleCheckout from '../lib/claude101-api/groble-checkout.js';
import grobleEvent from '../lib/claude101-api/groble-claude101-event.js';
import publicSample from '../lib/claude101-api/public-sample.js';

const HANDLERS = {
  'course-access': courseAccess,
  'groble-checkout': grobleCheckout,
  'groble-event': grobleEvent,
  'public-sample': publicSample,
};

export default async function handler(req, res) {
  const handle = HANDLERS[String(req.query?.fn || '')];
  if (!handle) return res.status(404).json({ error: 'not found' });
  return handle(req, res);
}
