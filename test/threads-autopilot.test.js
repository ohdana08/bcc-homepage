import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPerformanceLearningContext,
  buildPerformanceComment,
  dateKeyInTimeZone,
  formatBodyLines,
  ensureNumberedItems,
  normalizeShortLines,
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

test('구조화된 짧은 줄을 3문단 본문으로 바꾼다', () => {
  assert.equal(
    formatBodyLines(['후크다.', '상황이다.', '차이가 났다.', '행동을 바꿨다.', '넌 어디가 막혀?']),
    '후크다.\n\n상황이다.\n차이가 났다.\n\n행동을 바꿨다.\n넌 어디가 막혀?',
  );
});

test('긴 생성 문장을 단어 경계에서 10자 이하로 정리하고 마지막 질문만 남긴다', () => {
  const lines = normalizeShortLines([
    '내 얘기 같지 않았다.',
    '회사 정보, 어디서?',
    '공식 자료를 봤다.',
    '판단을 바꿨다.',
    '넌 어디서 찾니?',
  ], { finalQuestion: true });
  assert.ok(lines.length >= 5 && lines.length <= 10);
  assert.ok(lines.every((line) => line.length <= 10));
  assert.equal(lines.join('').match(/[?？]/g)?.length, 1);
  assert.match(lines.at(-1), /[?？]$/);
});

test('저장형 댓글에 짧은 번호 항목을 최소 2개 만든다', () => {
  const lines = ensureNumberedItems(['공식 자료 확인', '회사 기준 확인', '내 경험 연결']);
  assert.equal(lines.filter((line) => /^\d+[.)]\s*/.test(line)).length, 2);
  assert.ok(lines.every((line) => line.length <= 10));
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

test('캠페인별 고객 언어 패턴을 주입해 검증한다', () => {
  const jiwonfitPatterns = [/몰라서/, /복붙/, /막히|막혔/];
  const posts = [
    validPost('problem', ['공고를 놓쳤다.', '언제 나오는지', '몰라서였다.', '알림을 걸었다.', '넌 어디서 봐?']),
    validPost('tip', ['복붙이 문제다.', '기준이 달랐다.', '목차를 바꿨다.', '근거를 옮겼다.', '넌 뭘 바꾸겠어?'],
      ['1. 목차 확인', '2. 근거 배치', '한 줄씩 본다.', '사실만 남긴다.', '다시 읽는다.']),
    validPost('backstage', ['새벽에 고쳤다.', '가상 예시였다.', '순서를 바꿨다.', '판단이 변했다.', '넌 뭘 고치겠어?']),
    validPost('template', ['목차가 먼저다.', '항목을 나눴다.', '근거를 붙였다.', '출처를 남겼다.', '넌 뭐부터 써?'],
      ['1. 항목 정리', '2. 근거 연결', '날짜를 적는다.', '출처를 남긴다.', '추측은 뺀다.']),
    validPost('sale', ['계획서가 막혔다.', '도구는 못 한다.', '순서만 줄인다.', '검증은 네 몫.', '넌 어디서 멈춰?']),
  ];
  assert.deepEqual(validateHumanVoiceBatch(posts, jiwonfitPatterns), []);
  const problems = validateHumanVoiceBatch(posts);
  assert.ok(problems.some((problem) => problem.includes('고객 언어')));
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
