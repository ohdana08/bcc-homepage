import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const html = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('홈페이지의 네 입구는 실습 도구 두 분류와 작품관 두 곳을 순서대로 연다', () => {
  const nav = html('index.html').match(/<nav class="entry-works"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const cards = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<strong>([^<]+)/g)];
  assert.deepEqual(cards.map(([,href,label])=>[href,label.trim()]), [
    ['/tools.html#job','AI 활용 취업도구'],
    ['/tools.html#startup','AI 활용 창업도구'],
    ['/projects.html','강사결과물'],
    ['/student-works/','수업결과물'],
  ]);
  assert.doesNotMatch(html('projects.html'), /class="catalog-item"[^>]*id="ittools"/);
});
