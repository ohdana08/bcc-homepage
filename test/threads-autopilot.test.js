import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPerformanceLearningContext,
  buildPerformanceComment,
  dateKeyInTimeZone,
  validateHumanVoiceBatch,
  zonedDateTimeToUtc,
} from '../lib/threads-autopilot.js';

const DAILY_TYPES = ['problem', 'tip', 'backstage', 'template', 'sale'];

test('Asia/Seoul 날짜 키를 만든다', () => {
  const date = new Date('2026-07-26T15:30:00.000Z');
  assert.equal(dateKeyInTimeZone(date, 'Asia/Seoul'), '2026-07-27');
});

test('서울 현지 발행 시각을 UTC로 바꾼다', () => {
  assert.equal(
    zonedDateTimeToUtc('2026-07-27', '08:30', 'Asia/Seoul').toISOString(),
    '2026-07-26T23:30:00.000Z',
  );
});

test('24시간 성과에 다음 글을 연결한다', () => {
  const text = buildPerformanceComment(
    { views: 123, likes: 4, replies: 2, reposts: 1, quotes: 0, shares: 3 },
    { text: '기관 담당자는 커리큘럼보다 이것을 먼저 봅니다.\n본문' },
  );
  assert.match(text, /조회 123/);
  assert.match(text, /다음 글: 기관 담당자는/);
});

function validPost(contentType, lines, zeroLines = ['기준을 보자.', '사실만 쓴다.', '근거를 찾자.', '한 줄씩 본다.', '오늘 고친다.']) {
  return {
    content_type: contentType,
    text: `${lines[0]}\n\n${lines.slice(1, -1).join('\n')}\n\n${lines.at(-1)}`,
    self_comment_0: zeroLines.join('\n'),
    self_comment_6h: ['다시 읽었다.', '군더더길 뺐다.', '사실만 남겼다.'].join('\n'),
  };
}

test('통합 배치는 SSA·고객 언어·10자 줄·댓글을 검증한다', () => {
  const posts = [
    validPost('problem', [
      '첫 줄이 틀렸다.',
      'AI 티가 났다.',
      '장면이 없었다.',
      '행동을 넣었다.',
      '넌 어디가 막혀?',
    ]),
    validPost('tip', [
      '순서가 바뀌었다.',
      '뭘 먼저 쓸까.',
      '공고부터 봤다.',
      '근거를 골랐다.',
      '넌 뭘 먼저 봐?',
    ], ['1. 공고 보기', '2. 근거 찾기', '한 줄로 쓴다.', '사실만 남긴다.', '소리 내 읽는다.']),
    validPost('backstage', [
      '완벽주의를 뺐다.',
      '가상 예시였다.',
      '행동을 적었다.',
      '변화를 붙였다.',
      '넌 뭘 지우겠어?',
    ]),
    validPost('template', [
      '회사명이 틀렸다.',
      'AI가 지어냈다.',
      '공식 글을 봤다.',
      '근거만 남겼다.',
      '넌 어디서 확인해?',
    ], ['1. 공고 확인', '2. 회사 확인', '날짜를 적는다.', '출처를 남긴다.', '추측은 뺀다.']),
    validPost('sale', [
      '도구도 못 한다.',
      '경험은 못 만든다.',
      '순서만 줄여준다.',
      '검증은 네 몫이다.',
      '넌 어디서 멈춰?',
    ]),
  ];
  assert.deepEqual(validateHumanVoiceBatch(posts), []);
});

test('범용 카피와 고객 언어가 없는 배치를 거부한다', () => {
  const posts = Array.from({ length: 5 }, (_, index) => ({
    content_type: DAILY_TYPES[index],
    text: `너무 긴 첫 문장입니다 ${index}.\n\n일반적인 설명입니다.\n\n도움이 되셨다면 확인해주세요.`,
    self_comment_0: '짧다.',
    self_comment_6h: 'https://example.com',
  }));
  const problems = validateHumanVoiceBatch(posts);
  assert.ok(problems.some((problem) => problem.includes('범용 카피')));
  assert.ok(problems.some((problem) => problem.includes('고객 언어')));
  assert.ok(problems.some((problem) => problem.includes('10자를 넘는 줄')));
  assert.ok(problems.some((problem) => problem.includes('링크 또는 해시태그')));
});

test('최근 실제 성과는 상위 글의 구조 신호로만 요약한다', () => {
  const context = buildPerformanceLearningContext([
    {
      content_type: 'tip',
      text: '공고부터 봤다.\n\n본문',
      metrics: { views: 900, likes: 20, replies: 3, reposts: 1, quotes: 0, shares: 4 },
    },
    {
      content_type: 'sale',
      text: '도구도 못 한다.\n\n본문',
      metrics: { views: 300, likes: 5, replies: 1, reposts: 0, quotes: 0, shares: 1 },
    },
  ]);
  assert.match(context, /tip/);
  assert.match(context, /조회 900/);
  assert.match(context, /반응 28/);
  assert.ok(context.indexOf('tip') < context.indexOf('sale'));
});
