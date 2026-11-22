import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const works = JSON.parse(read('student-works/works.json'));
const page = read('student-works/index.html');
const home = read('index.html');
test('registered works have distinct anchors and readable existing images', () => {
  assert.equal(new Set(works.map(work => work.id)).size, works.length);
  for (const work of works) {
    assert.ok(page.includes(`id="${work.id}"`), work.id);
    if (work.privateWorkspace) {
      assert.equal(work.images.length, 0);
      assert.ok(page.includes('href="/api/mentoring-entry"'));
      continue;
    }
    assert.ok(work.images.length > 0);
    for (const image of work.images) {
      assert.match(image.src, /^\/assets\/results\/[a-z0-9-]+\.(jpg|png)$/);
      assert.ok(image.alt.length > 5);
      assert.ok(existsSync(resolve(root, image.src.slice(1))), image.src);
      assert.ok(page.includes(`href="${image.src}"`), 'image must remain accessible without JavaScript');
    }
    if (work.download) {
      const pdf = readFileSync(resolve(root, work.download.src.slice(1)));
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(page.includes(`href="${work.download.src}" download`));
    }
    if (work.record) assert.ok(existsSync(resolve(root, work.record.slice(1))));
  }
});
test('homepage featured works link to real gallery entries and gallery is discoverable', () => {
  for (const work of works.filter(work => work.featured)) assert.ok(home.includes(`href="/student-works/#${work.id}"`));
  assert.match(home, /href="\/student-works\/"/);
  assert.ok(read('sitemap.xml').includes('https://bccconsulting.kr/student-works/'));
  assert.ok(page.includes('href="https://bccconsulting.kr/student-works/"'));
});
test('gallery provides category and search controls, empty-state reset and native dialog', () => {
  for (const category of new Set(works.map(work => work.category))) assert.ok(page.includes(`data-filter="${category}"`));
  assert.match(page, /for="work-search"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /data-reset/);
  assert.match(page, /<dialog[^>]+aria-labelledby="work-dialog-title"/);
  assert.match(page, /data-close aria-label=/);
  assert.match(page, /href="\/lecture-request\//);
});
test('gallery excludes unrelated photos, reviews and unverified current-day submissions', () => {
  assert.ok(!page.includes('/assets/field/'));
  assert.ok(!page.includes('/assets/reviews'));
  assert.ok(!JSON.stringify(works).includes('261116'));
  assert.ok(!page.includes('4컷 콘티'));
});
