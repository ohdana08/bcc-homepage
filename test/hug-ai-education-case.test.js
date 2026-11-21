import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('메인 HUG 수업 사례와 작품관의 두 실습 작품에서 같은 수업 기록으로 연결한다', async () => {
  const [home, gallery] = await Promise.all([read('index.html'), read('student-works/index.html')]);
  const detailLink = /<a\b[^>]*href="\/?cases\/hug-antigravity-netlify-20260828\.html"/;
  const articles = page => page.match(/<article\b[^>]*>[\s\S]*?<\/article>/g) ?? [];
  const homeCase = articles(home).find(card => card.includes('주택도시보증공사') && detailLink.test(card));
  assert.ok(homeCase, '메인에서 주택도시보증공사의 수업 기록을 열 수 있다');
  assert.match(homeCase, /<img\b[^>]*src="\/?assets\/results\/hug-result-01\.png"/);
  assert.match(home, /<a\b[^>]*href="\/student-works\/#hug-homepage"/);
  assert.match(home, /<a\b[^>]*href="\/student-works\/"/);

  const galleryCards = articles(gallery);
  for (const [id, image] of [['hug-homepage', 'hug-result-01.png'], ['hug-strategy-portal', 'hug-result-02.png']]) {
    const card = galleryCards.find(article => article.includes(`id="${id}"`));
    assert.ok(card, id);
    assert.ok(card.includes(`src="/assets/results/${image}"`), image);
    assert.ok(card.includes(`href="/assets/results/${image}"`), `${id} 원본 이미지`);
    assert.match(card, detailLink, `${id} 수업 기록`);
  }
});

test('HUG 상세 사례는 두 공개 결과물과 교육 실습 범위를 함께 밝힌다', async () => {
  const detail = await read('cases/hug-antigravity-netlify-20260828.html');

  assert.match(detail, /ubiquitous-medovik-6d6102\.netlify\.app/);
  assert.match(detail, /statuesque-figolla-4b7130\.netlify\.app/);
  assert.match(detail, /Netlify Drop/);
  assert.match(detail, /공식 운영 서비스 또는 확정된 사업 성과를 의미하지 않습니다/);
  assert.match(detail, /"datePublished": "2026-08-31"/);
  assert.match(detail, /"temporalCoverage": "2026-08-28"/);
});

test('사이트맵에 기관교육 사례 목록과 상세 주소를 공개한다', async () => {
  const sitemap = await read('sitemap.xml');

  assert.match(sitemap, /https:\/\/bccconsulting\.kr\/cases\//);
  assert.match(sitemap, /https:\/\/bccconsulting\.kr\/cases\/hug-antigravity-netlify-20260828\.html/);
});
