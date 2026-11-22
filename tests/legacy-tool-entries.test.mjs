import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const script = readFileSync(new URL('../assets/tool-entry-redirect.js', import.meta.url), 'utf8');

test('이전 통합 주소와 북마크가 같은 분야의 새 페이지로 이동하며 캠페인 정보는 유지된다', () => {
  for (const [hash, destination] of [
    ['', '/?utm_source=course#tool-entries'],
    ['#coach', '/?utm_source=course#tool-entries'],
    ['#job', '/employment-tools/?utm_source=course'],
    ['#startup', '/startup-tools/?utm_source=course'],
    ['#work', '/work-tools/?utm_source=course'],
    ['#coach-job', '/employment-tools/?utm_source=course#coach-job'],
    ['#coach-startup', '/startup-tools/?utm_source=course#coach-startup'],
    ['#coach-marketing', '/startup-tools/?utm_source=course#coach-marketing'],
    ['#marketing-research', '/startup-tools/?utm_source=course#marketing-research'],
  ]) {
    let actual;
    const location = { origin:'https://bccconsulting.kr', hostname:'bccconsulting.kr', search:'?utm_source=course', hash,
      replace(url) { actual = url; } };
    runInNewContext(script, {location, URL});
    assert.equal(actual, location.origin + destination);
  }
});

test('기존 주소 두 곳에서 같은 이동 스크립트와 자바스크립트 없는 직접 링크를 제공한다', () => {
  for (const path of ['tools.html', 'tools/index.html']) {
    const page = new URL('../' + path, import.meta.url);
    const html = readFileSync(page, 'utf8');
    const scriptSrc = html.match(/<script src="([^"]+)"/)[1];
    assert.equal(new URL(scriptSrc, page).href, new URL('../assets/tool-entry-redirect.js', import.meta.url).href);
    for (const href of ['/employment-tools/', '/startup-tools/', '/work-tools/']) assert.ok(html.includes('href="' + href + '"'));
  }
});
