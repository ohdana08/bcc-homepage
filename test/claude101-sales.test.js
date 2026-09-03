import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('판매 페이지와 홈페이지는 9,900원 실습팩으로 일치한다', async () => {
  const landing = await readFile(new URL('../claude101-pro.html', import.meta.url), 'utf8');
  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const freeLibrary = await readFile(new URL('../claude101.html', import.meta.url), 'utf8');

  assert.match(landing, /AI 업무 결과물 3종 실습팩/);
  assert.equal((landing.match(/9,900원/g) || []).length >= 3, true);
  assert.match(landing, /프롬프트·샘플·완성 파일·검수표/);
  assert.match(landing, /막힐 때 확인하는 보조 영상 6개/);
  assert.doesNotMatch(landing, /29,000원/);
  assert.match(home, /실습팩 · 9,900원/);
  assert.doesNotMatch(home, /7명 파일럿 · 149,000원/);
  assert.match(freeLibrary, /9,900원 AI 업무 결과물 실습팩/);
});

test('가격 변경 SQL과 실매출 집계는 9,900원 외부 결제만 사용한다', async () => {
  const activation = await readFile(new URL('../revenue-launch/ACTIVATE_PRODUCT.sql', import.meta.url), 'utf8');
  const metrics = await readFile(new URL('../revenue-launch/SALES_METRICS.sql', import.meta.url), 'utf8');
  const campaign = await readFile(new URL('../revenue-launch/KAKAO_CAMPAIGN.md', import.meta.url), 'utf8');

  assert.match(activation, /price = 9900/);
  assert.match(activation, /where id = 'claude101-pro'/);
  assert.match(metrics, /paid_amount > 0/);
  assert.match(metrics, /status = 'active'/);
  assert.match(metrics, /provider = 'groble'/);
  assert.match(metrics, /102 - count/);
  assert.match(campaign, /대상: 카카오톡 채널 친구 전체 457명/);
});
