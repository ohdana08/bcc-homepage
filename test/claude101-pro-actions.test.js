import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Claude 101 판매 페이지의 결과물과 6강 카드가 실제 구매·수강 흐름으로 연결된다', async () => {
  const html = await readFile(new URL('../claude101-pro.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../claude101-pro.js', import.meta.url), 'utf8');

  assert.equal((html.match(/class="result-file"[^>]*data-purchase/g) || []).length, 3);
  assert.equal((html.match(/class="lesson-tile lesson-action"[^>]*data-purchase/g) || []).length, 6);
  assert.equal((html.match(/자료실에서 받기 →/g) || []).length, 6);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(script, /getAttribute\('aria-disabled'\) === 'true'/);
});
