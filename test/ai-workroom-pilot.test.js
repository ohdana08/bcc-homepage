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
