import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = f => readFileSync(resolve(root, f), 'utf8');

test('카페 3D 페이지 3종이 같은 엔진과 로컬 three.js 를 쓴다', () => {
  for (const k of ['a', 'b', 'c']) {
    const html = read(`tools/cafe-3d/${k}/index.html`);
    assert.match(html, new RegExp(`data-key="${k}"`));
    assert.ok(html.includes('/assets/vendor/three.r128.min.js') && html.includes('/assets/cafe3d.js'));
    assert.ok(html.includes('시공용 도면이 아닙니다'));
    assert.ok(!/https?:\/\/(?!cdn\.jsdelivr\.net|bccconsulting\.kr)/.test(html.replace(/<meta[^>]*>/g, '')), '외부 주소는 글꼴 CDN뿐이어야 한다');
  }
  assert.ok(existsSync(resolve(root, 'assets/vendor/three.r128.min.js')));
});

test('샘플 건물 자료에 실제 건물·기관 식별 정보가 없다', () => {
  const files = ['assets/cafe3d.js', 'scripts/build-cafe-3d.mjs', 'student-works/works.json', 'student-works/index.html', 'projects.html',
    ...['a', 'b', 'c'].map(k => `tools/cafe-3d/${k}/index.html`)];
  for (const f of files) assert.ok(!/위촌|wichon|부산주거복지|주거복지센터/i.test(read(f)), `${f} 에 식별 정보가 남아 있다`);
});

test('갤러리 B 작품과 강사결과물 A·C 카드가 연결된다', () => {
  const works = JSON.parse(read('student-works/works.json'));
  const b = works.find(w => w.id === 'octagon-cafe-3d');
  assert.ok(b && b.record === '/tools/cafe-3d/b/' && b.images.length === 4);
  for (const im of b.images) assert.ok(existsSync(resolve(root, im.src.slice(1))));
  const projects = read('projects.html');
  for (const [id, k] of [['cafe-a', 'a'], ['cafe-c', 'c']]) {
    assert.ok(projects.includes(`id="${id}"`) && projects.includes(`href="/tools/cafe-3d/${k}/"`) && projects.includes(`href="#${id}"`));
  }
});
