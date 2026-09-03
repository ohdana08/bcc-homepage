import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createClaude101SignedLessonAssets,
  listClaude101LessonAssetPaths,
} from '../lib/claude101-course-assets.js';

test('비로그인 무료 1강 페이지는 영상, 실습자료, 9,900원 전환을 함께 제공한다', async () => {
  const html = await readFile(new URL('../claude101-pro-sample.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../claude101-pro-sample.js', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

  assert.match(html, /로그인 없이 무료 공개/);
  assert.match(html, /회의 메모 7줄/);
  assert.match(html, /유료 실전팩의 보조 영상 6개 중 첫 번째 영상/);
  assert.match(html, /전체 실습팩 9,900원으로 시작/);
  assert.match(script, /api\/claude101-public-sample/);
  assert.match(script, /sample_lesson_start/);
  assert.match(script, /sample_purchase_click/);
  assert.ok(config.rewrites.some((item) => item.source === '/api/claude101-public-sample'));
});

test('공개 API는 1강 자산만 서명하고 나머지 다섯 강은 노출하지 않는다', async () => {
  const requested = [];
  const db = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'claude101-pro');
        return {
          async createSignedUrls(paths, expiresIn) {
            requested.push(...paths);
            assert.equal(expiresIn, 1800);
            return {
              data: paths.map((path) => ({ path, signedUrl: `https://sample.example/${path}` })),
              error: null,
            };
          },
        };
      },
    },
  };

  const paths = listClaude101LessonAssetPaths('1-1');
  assert.equal(paths.length, 6);
  assert.ok(paths.every((path) => path.startsWith('lessons/1-1/')));
  assert.equal(listClaude101LessonAssetPaths('1-2').some((path) => paths.includes(path)), false);

  const lesson = await createClaude101SignedLessonAssets(db, 'claude101-pro', '1-1', 1800);
  assert.deepEqual(requested, paths);
  assert.equal(lesson.id, '1-1');
  assert.match(lesson.videoUrl, /claude101-vod-1-1-v3\.mp4$/);
  assert.equal(lesson.downloads.length, 4);
  assert.ok(lesson.downloads.every((item) => item.url));
});
