import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('메인 사례·후기 영역에서 HUG 기관교육 상세 사례로 연결한다', async () => {
  const homepage = await read('index.html');

  assert.match(homepage, /주택도시보증공사 AI 활용 교육/);
  assert.match(homepage, /cases\/hug-antigravity-netlify-20260828\.html/);
  assert.match(homepage, /hug-result-01\.png/);
  assert.match(homepage, /hug-result-02\.png/);
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
