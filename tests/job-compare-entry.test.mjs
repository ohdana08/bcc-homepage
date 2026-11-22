import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('잇툴즈 취업 카드에서 사이트 안의 이력서 비교 도구를 연다', () => {
  const page = readFileSync(new URL('../tools.html', import.meta.url), 'utf8');
  const group = page.split('<div class="it-group" id="job">')[1].split('<div class="it-group"')[0];
  const cards = [...group.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/g)];
  const matches = cards.filter(([, , body]) => body.includes('내 이력서로 채용 공고 3개 비교하기'));
  assert.equal(matches.length, 1);
  assert.match(matches[0][1], /href="tools\/job-compare\/"/);
  assert.doesNotMatch(matches[0][1], /target="_blank"/);
});
