import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COURSE_LESSONS } from '../claude101-course-data.js';
import {
  listClaude101AssetPaths,
  mapClaude101SignedAssets,
} from '../lib/claude101-course-assets.js';

test('every published Claude 101 video has practice materials directly attached', () => {
  const published = COURSE_LESSONS.filter((lesson) => lesson.status === 'ready');
  assert.ok(published.length > 0);
  for (const lesson of published) {
    assert.ok(lesson.practice, `${lesson.id} practice materials are required`);
    assert.ok(lesson.practice.sampleText.length > 20);
    assert.ok(lesson.practice.prompts.length >= 3);
    assert.ok(lesson.practice.checklist.length >= 4);
    assert.ok(lesson.practice.downloads.length >= 1);
  }
});

test('paid advanced course stays at six lessons and does not absorb the 18 free practices', () => {
  assert.equal(COURSE_LESSONS.length, 6);
  assert.deepEqual(COURSE_LESSONS.map((lesson) => lesson.number), ['01', '02', '03', '04', '05', '06']);
  assert.equal(COURSE_LESSONS.filter((lesson) => lesson.status === 'ready').length, 6);
  assert.equal(COURSE_LESSONS.filter((lesson) => lesson.status === 'pending').length, 0);
});

test('lesson 1-6 keeps the my-work transfer flow with data classification and review log', () => {
  const lesson = COURSE_LESSONS.find((item) => item.id === '1-6');
  const prompts = lesson.practice.prompts.map((item) => item.text).join('\n');
  assert.equal(lesson.practice.outcome, '내업무_AI_작업절차.md');
  assert.match(lesson.practice.description, /Claude, ChatGPT, Gemini/);
  assert.match(lesson.practice.description, /공개 가능·비식별 필요·입력 금지/);
  assert.match(lesson.practice.sampleText, /업무 정보/);
  assert.match(lesson.practice.sampleText, /외부 전달 전 사람 검수 기록/);
  assert.match(prompts, /아직 보고서는 만들지 마세요/);
  assert.match(prompts, /분모\(건수\)를 함께 적습니다/);
  assert.match(prompts, /어떤 형태로도 넣지 않음/);
  assert.match(lesson.practice.sampleHelp, /가상 자료/);
  assert.equal(lesson.practice.prompts.length, 5);
  assert.equal(lesson.practice.checklist.length, 10);
  assert.equal(lesson.practice.downloads.length, 6);
});

test('lesson 1-5 keeps the project-instruction workspace flow with the week2 source', () => {
  const lesson = COURSE_LESSONS.find((item) => item.id === '1-5');
  const prompts = lesson.practice.prompts.map((item) => item.text).join('\n');
  assert.equal(lesson.practice.outcome, '프로젝트_지침서.md');
  assert.match(lesson.practice.description, /Claude Projects/);
  assert.match(lesson.practice.description, /제품·계정·실행 시점/);
  assert.match(lesson.practice.sampleText, /고정 지침/);
  assert.match(lesson.practice.sampleText, /이번 작업 자료/);
  assert.match(lesson.practice.sampleText, /0분으로 바꾸지 않고/);
  assert.match(prompts, /이 프로젝트의 지침대로 진행합니다/);
  assert.match(prompts, /평균 응답시간은 어떻게 계산하기로 했나요/);
  assert.match(lesson.practice.sampleHelp, /민감정보/);
  assert.equal(lesson.practice.prompts.length, 5);
  assert.equal(lesson.practice.checklist.length, 10);
  assert.equal(lesson.practice.downloads.length, 4);
});

test('lesson 1-4 keeps the human-baseline review flow with the planted-error draft', () => {
  const lesson = COURSE_LESSONS.find((item) => item.id === '1-4');
  const prompts = lesson.practice.prompts.map((item) => item.text).join('\n');
  assert.equal(lesson.practice.outcome, 'AI_결과물_통합검수표.md');
  assert.match(lesson.practice.description, /Claude, ChatGPT, Gemini/);
  assert.match(lesson.practice.description, /기준값은 사람이 원본에서 직접/);
  assert.match(lesson.practice.sampleText, /약 32분/);
  assert.match(lesson.practice.sampleText, /김민아/);
  assert.match(lesson.practice.sampleHelp, /가상 이름/);
  assert.match(prompts, /35\.5분 \(639 ÷ 18\)/);
  assert.match(prompts, /빈칸을 0분으로 바꾸지 않습니다/);
  assert.match(prompts, /원문에 없음/);
  assert.equal(lesson.practice.prompts.length, 5);
  assert.equal(lesson.practice.checklist.length, 10);
  assert.equal(lesson.practice.downloads.length, 5);
});

test('lesson 1-3 keeps the report-to-slide decision flow and source verification', () => {
  const lesson = COURSE_LESSONS.find((item) => item.id === '1-3');
  const prompts = lesson.practice.prompts.map((item) => item.text).join('\n');
  assert.equal(lesson.duration, '09:45');
  assert.equal(lesson.practice.publicUrl, 'claude101-2-5.html');
  assert.match(lesson.practice.description, /Claude, ChatGPT, Gemini/);
  assert.match(lesson.practice.description, /원문에 없는 내용이 추가될 수/);
  assert.match(lesson.practice.sampleText, /639분/);
  assert.match(lesson.practice.sampleText, /35\.5분/);
  assert.match(prompts, /고객응대 운영팀장과 실무자/);
  assert.match(prompts, /아직 PowerPoint 파일은 만들지 마세요/);
  assert.match(prompts, /원본에 없는 만족도, 증가율, 원인/);
  assert.equal(lesson.practice.prompts.length, 5);
  assert.equal(lesson.practice.checklist.length, 12);
  assert.equal(lesson.practice.downloads.length, 5);
});

test('lesson 1-2 includes the synthetic CSV, AI-specific uncertainty, and numeric verification', () => {
  const lesson = COURSE_LESSONS.find((item) => item.id === '1-2');
  const prompts = lesson.practice.prompts.map((item) => item.text).join('\n');
  assert.match(lesson.practice.sampleText, /Q001/);
  assert.match(lesson.practice.sampleText, /Q020/);
  assert.match(lesson.practice.description, /도구와 실행 시점에 따라 달라질 수/);
  assert.match(prompts, /639|18건의 합계와 평균/);
  assert.match(prompts, /35\.5|평균 응답시간/);
  assert.equal(lesson.practice.checklist.length, 10);
  assert.equal(lesson.practice.downloads.length, 5);
});

test('lesson 1-1 includes the source memo, detailed prompt, Word prompt, and verification rules', () => {
  const lesson = COURSE_LESSONS.find((item) => item.id === '1-1');
  assert.match(lesson.practice.sampleText, /이수진/);
  assert.match(lesson.practice.sampleText, /박도현/);
  assert.match(lesson.practice.prompts.map((item) => item.text).join('\n'), /확인 필요/);
  assert.match(lesson.practice.prompts.map((item) => item.text).join('\n'), /Word 업무보고서/);
  assert.match(lesson.practice.prompts.map((item) => item.text).join('\n'), /원본 회의 메모/);
  assert.match(lesson.practice.sampleHelp, /가상 이름/);
});

test('private video, subtitle, and exercise downloads map to short-lived URLs', () => {
  const paths = listClaude101AssetPaths();
  assert.deepEqual(paths, [
    'lessons/1-1/claude101-vod-1-1-v3.mp4',
    'lessons/1-1/claude101-vod-1-1-v3-ko.srt',
    'lessons/1-1/meeting-memo.txt',
    'lessons/1-1/prompts.txt',
    'lessons/1-1/review-checklist.txt',
    'lessons/1-1/meeting-report.docx',
    'lessons/1-2/claude101-vod-1-2-v1.mp4',
    'lessons/1-2/claude101-vod-1-2-v1-ko.srt',
    'lessons/1-2/customer-inquiries.csv',
    'lessons/1-2/prompts.txt',
    'lessons/1-2/review-checklist.txt',
    'lessons/1-2/answer-key.csv',
    'lessons/1-2/customer-inquiries-analysis.xlsx',
    'lessons/1-3/claude101-vod-1-3-v1.mp4',
    'lessons/1-3/claude101-vod-1-3-v1-ko.srt',
    'lessons/1-3/customer-inquiry-operations-report.txt',
    'lessons/1-3/prompts.md',
    'lessons/1-3/review-checklist.md',
    'lessons/1-3/slide-answer-key.txt',
    'lessons/1-3/customer-inquiry-operations-deck.pptx',
    'lessons/1-4/claude101-vod-1-4-v1.mp4',
    'lessons/1-4/claude101-vod-1-4-v1-ko.srt',
    'lessons/1-4/ai-summary-draft.txt',
    'lessons/1-4/customer-inquiries.csv',
    'lessons/1-4/prompts.md',
    'lessons/1-4/ai-review-master-checklist.md',
    'lessons/1-4/answer-key.md',
    'lessons/1-5/claude101-vod-1-5-v1.mp4',
    'lessons/1-5/claude101-vod-1-5-v1-ko.srt',
    'lessons/1-5/project-instructions.md',
    'lessons/1-5/customer-inquiries-week2.csv',
    'lessons/1-5/answer-key-week2.md',
    'lessons/1-5/prompts.md',
    'lessons/1-6/claude101-vod-1-6-v1.mp4',
    'lessons/1-6/claude101-vod-1-6-v1-ko.srt',
    'lessons/1-6/my-work-ai-procedure.md',
    'lessons/1-6/example-weekly-sales-procedure.md',
    'lessons/1-6/weekly-orders-deidentified.csv',
    'lessons/1-6/answer-key-orders.md',
    'lessons/1-6/data-classification-guide.md',
    'lessons/1-6/prompts.md',
  ]);

  const mapped = mapClaude101SignedAssets(paths.map((path) => ({
    path,
    signedUrl: `https://private.example/${path}`,
  })));
  assert.equal(mapped[0].id, '1-1');
  assert.match(mapped[0].videoUrl, /claude101-vod-1-1-v3\.mp4$/);
  assert.match(mapped[0].subtitleUrl, /beginner-v3-ko|v3-ko|v3_ko|v3-ko\.srt|v3-ko/);
  assert.equal(mapped[0].downloads.length, 4);
  assert.ok(mapped[0].downloads.every((item) => item.url));
  assert.equal(mapped[1].id, '1-2');
  assert.match(mapped[1].videoUrl, /claude101-vod-1-2-v1\.mp4$/);
  assert.match(mapped[1].subtitleUrl, /claude101-vod-1-2-v1-ko\.srt$/);
  assert.equal(mapped[1].downloads.length, 5);
  assert.ok(mapped[1].downloads.every((item) => item.url));
  assert.equal(mapped[2].id, '1-3');
  assert.match(mapped[2].videoUrl, /claude101-vod-1-3-v1\.mp4$/);
  assert.match(mapped[2].subtitleUrl, /claude101-vod-1-3-v1-ko\.srt$/);
  assert.equal(mapped[2].downloads.length, 5);
  assert.ok(mapped[2].downloads.every((item) => item.url));
  assert.equal(mapped[3].id, '1-4');
  assert.match(mapped[3].videoUrl, /claude101-vod-1-4-v1\.mp4$/);
  assert.match(mapped[3].subtitleUrl, /claude101-vod-1-4-v1-ko\.srt$/);
  assert.equal(mapped[3].downloads.length, 5);
  assert.ok(mapped[3].downloads.every((item) => item.url));
  assert.equal(mapped[4].id, '1-5');
  assert.match(mapped[4].videoUrl, /claude101-vod-1-5-v1\.mp4$/);
  assert.match(mapped[4].subtitleUrl, /claude101-vod-1-5-v1-ko\.srt$/);
  assert.equal(mapped[4].downloads.length, 4);
  assert.ok(mapped[4].downloads.every((item) => item.url));
  assert.equal(mapped[5].id, '1-6');
  assert.match(mapped[5].videoUrl, /claude101-vod-1-6-v1\.mp4$/);
  assert.match(mapped[5].subtitleUrl, /claude101-vod-1-6-v1-ko\.srt$/);
  assert.equal(mapped[5].downloads.length, 6);
  assert.ok(mapped[5].downloads.every((item) => item.url));
});

test('course UI renders the video before its exercise materials', async () => {
  const source = await readFile(new URL('../course-claude101-pro.js', import.meta.url), 'utf8');
  const bodyTemplate = source.slice(source.indexOf('function renderLesson'));
  assert.ok(bodyTemplate.indexOf('${renderVideo(lesson, assets)}') >= 0);
  assert.ok(bodyTemplate.indexOf('${renderPractice(lesson, assets)}') >= 0);
  assert.ok(bodyTemplate.indexOf('${renderVideo(lesson, assets)}') < bodyTemplate.indexOf('${renderPractice(lesson, assets)}'));
  assert.match(source, /data-copy-key/);
  assert.match(source, /data-course-checklist/);
  assert.match(source, /\['127\.0\.0\.1', 'localhost'\]/);
  assert.match(source, /get\('preview'\) === 'course'/);
});
