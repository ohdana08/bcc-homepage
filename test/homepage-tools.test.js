import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('홈페이지의 잇툴즈에서 창업 실습과 지원사업 찾기·진단·사업계획서, AI 코치를 연다', async () => {
  const [home, tools, directory] = await Promise.all([
    read('index.html'), read('tools.html'), read('ddakfit/index.html'),
  ]);
  assert.match(home, /<a\b[^>]*href="\/?tools\.html"[^>]*>잇툴즈<\/a>/);

  const groups = tools.split(/<div class="it-group"\s+/);
  const startup = groups.find(group => group.startsWith('id="startup"'));
  assert.ok(startup, '잇툴즈의 창업 준비 도구 모음');
  const cards = new Map();
  for (const [, href, content] of startup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = content.match(/<h3>([^<]+)<\/h3>/)?.[1];
    if (title) cards.set(title, new URL(href.replaceAll('&amp;', '&'), 'https://bccconsulting.kr/tools.html'));
  }
  assert.equal(cards.get('창업 아이템 빈칸 찾기')?.href,
    'https://ai-job-metacognition-lab.jinjoopower.chatgpt.site/startup/metacognition');
  assert.equal(cards.get('지원사업 공고 사이트 모음')?.href, 'https://bccconsulting.kr/ddakfit/#links');
  assert.match(directory, /<section\b[^>]*id="links"/);
  for (const title of ['공고 진단받기', '사업계획서 쓰기']) {
    const link = cards.get(title);
    assert.ok(link, title);
    assert.equal(link.origin + link.pathname, 'https://ddakfit.bccconsulting.kr/embed', title);
    assert.equal(link.searchParams.get('start'), title === '공고 진단받기' ? 'direct' : null, title);
  }
  assert.match(tools, /<a\b[^>]*href="#coach"[^>]*>AI 코치/);
  const coach = groups.find(group => group.startsWith('id="coach"'));
  assert.ok(coach, 'AI 코치 목록');
  for (const id of ['coach-startup', 'coach-marketing', 'coach-job']) {
    assert.ok(coach.includes(`href="#${id}"`));
  }
  const job = groups.find(group => group.startsWith('id="job"'));
  assert.ok(job.includes('id="coach-job"'));
  assert.ok(job.includes('href="/resume-workbook.html"'));
  assert.ok(startup.includes('id="coach-marketing"'));
  assert.ok(startup.includes('href="tools/funnel-map/"'));
  assert.match(startup, /<a\b[^>]*href="\/?tools\/chatbots\/\?bot=business-process"[^>]*>\s*<div><b>창업아이디어검증코치<\/b>/);
});
