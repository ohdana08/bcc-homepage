import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('마이페이지에서 Claude 101 활성 수강권을 수강실로 연결한다', async () => {
  const source = await readFile(new URL('../mypage.html', import.meta.url), 'utf8');

  assert.match(source, /'claude101-pro':\s*'course-claude101-pro\.html'/);
  assert.match(source, /class="course-link"/);
  assert.match(source, /수강실 바로가기/);
});

test('관리자 마이페이지에서 기관 제안 운영실을 노출한다', async () => {
  const source = await readFile(new URL('../mypage.html', import.meta.url), 'utf8');

  assert.match(source, /id="proposalsLink"[^>]+href="admin-proposals\.html"/);
  assert.match(source, /getElementById\('proposalsLink'\)\.style\.display = 'block'/);
});
