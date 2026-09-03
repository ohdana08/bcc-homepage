import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../ai-workroom-pilot.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../ai-workroom-pilot.js', import.meta.url), 'utf8');

test('맞춤 업무 설치팩의 가격, 범위, 정직한 파일럿 한도를 명시한다', () => {
  assert.match(html, /149,000/);
  assert.match(html, /7명 한정/);
  assert.match(html, /반복업무 1개 맞춤 설계/);
  assert.match(html, /7일 이내 수정 1회/);
  assert.doesNotMatch(html, /마감 임박|오늘만|무조건|100%/);
});

test('신청 전에 결과물, 보안 경계, 환불 기준을 설명한다', () => {
  assert.match(html, /맞춤 AI 작업실/);
  assert.match(html, /검수 체크리스트/);
  assert.match(html, /개인정보와 기밀을 지운 샘플자료/);
  assert.match(html, /맞춤 제작이 시작되기 전에는 전액 환불/);
});

test('전환 폼은 필수 적합성 질문과 기존 리드 수집 엔드포인트를 사용한다', () => {
  assert.match(html, /id="workroomForm"/);
  assert.match(html, /name="workflow" required/);
  assert.match(html, /name="frequency" required/);
  assert.match(html, /name="pain"[\s\S]*required/);
  assert.match(script, /bcc-admin-eight\.vercel\.app\/api\/lead/);
  assert.match(script, /workroom_application_submitted/);
  assert.match(script, /\[AI 업무 작업실 파일럿\]/);
});

test('맞춤 제작 결제는 별도 상품 화면과 명시적 환불 동의를 사용한다', async () => {
  const checkout = await readFile(new URL('../apply.html', import.meta.url), 'utf8');
  const refund = await readFile(new URL('../refund.html', import.meta.url), 'utf8');
  const success = await readFile(new URL('../success.html', import.meta.url), 'utf8');

  assert.match(checkout, /requestedProduct === 'ai-workroom-pilot'/);
  assert.match(checkout, /맞춤 제작 시작 시점과 위 청약철회 안내를 확인하고 동의/);
  assert.match(refund, /id="custom-service"/);
  assert.match(refund, /별도로 고지하고, 소비자의 서면 또는 전자문서 동의/);
  assert.match(success, /ai-workroom-pilot_/);
  assert.match(success, /맞춤 작업실 신청과 결제가 완료/);
});

test('신청부터 납품까지 운영 문서는 범위·보안·승인 조건을 고정한다', async () => {
  const triage = await readFile(new URL('../revenue-launch/LEAD_TRIAGE.md', import.meta.url), 'utf8');
  const replies = await readFile(new URL('../revenue-launch/REPLY_TEMPLATES.md', import.meta.url), 'utf8');
  const onboarding = await readFile(new URL('../revenue-launch/CUSTOMER_ONBOARDING.md', import.meta.url), 'utf8');
  const scope = await readFile(new URL('../revenue-launch/SCOPE_CONFIRMATION_TEMPLATE.md', import.meta.url), 'utf8');
  const fulfillment = await readFile(new URL('../revenue-launch/FULFILLMENT_CHECKLIST.md', import.meta.url), 'utf8');

  assert.match(triage, /대표 승인 없이 가격 변경, 할인 제안, 결제 링크 발송, 외부 답변 발송을 하지 않는다/);
  assert.match(triage, /업무 흐름 한 가지/);
  assert.match(replies, /149,000원\(VAT 포함\)/);
  assert.match(replies, /무리하게 약속한 뒤 결과가 달라지는 일을 피하기 위해/);
  assert.match(onboarding, /비밀번호, API 키, 인증서, 로그인 쿠키/);
  assert.match(scope, /영업일 5일 안에 1차본/);
  assert.match(scope, /서면 또는 전자문서로 동의/);
  assert.match(fulfillment, /외부 실결제 149,000원 확인/);
  assert.match(fulfillment, /동일 샘플로 기준 결과와 비교/);
  assert.match(fulfillment, /불필요한 고객 원본과 임시파일 삭제/);
});

test('결제 서버와 매출 집계는 동의 없는 주문·테스트·환불 매출을 제외한다', async () => {
  const checkoutApi = await readFile(new URL('../api/create-checkout.js', import.meta.url), 'utf8');
  const metrics = await readFile(new URL('../revenue-launch/SALES_METRICS.sql', import.meta.url), 'utf8');
  const runbook = await readFile(new URL('../revenue-launch/LAUNCH_RUNBOOK.md', import.meta.url), 'utf8');

  assert.match(checkoutApi, /if \(!refundConsent\)/);
  assert.match(checkoutApi, /환불·청약철회 안내를 확인하고 동의/);
  assert.match(metrics, /paid_amount > 0/);
  assert.match(metrics, /status = 'active'/);
  assert.match(metrics, /'manual-test', 'test', 'internal'/);
  assert.match(runbook, /페이지 배포, 메시지 발송, 신청 수는 완료 기준이 아니다/);
  assert.match(runbook, /각 주문을 토스 관리자 승인 내역과 대조/);
});
