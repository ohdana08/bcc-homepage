import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('사람냄새 배치는 고객 언어와 짧은 문단을 검증한다', () => {
  const posts = [
    '문장은 나왔는데 이상했다.\n\n“AI가 쓴 티가 나요”라는 말이 먼저 나왔다.\n\n그래서 형용사 대신 실제 행동 한 장면부터 적기로 했다.',
    '지원동기 첫 줄에서 멈췄다.\n\n“뭘 먼저 넣어야 할지 모르겠어요”가 진짜 문제였다.\n\n회사 소개보다 채용공고의 우대 조건 하나부터 확인했다.',
    '단점이 전부 완벽주의였다.\n\n그럴듯하지만 누구 이야기인지 보이지 않았다.\n\n가상 예시라고 밝히고 실제 행동과 개선 결과를 나눠 썼다.',
    '회사 이름은 맞는데 서비스가 없었다.\n\nAI가 사실처럼 만든 문장이었다.\n\n공식 홈페이지에서 확인되지 않으면 빼기로 했다.',
    '워크북도 경험을 대신 만들 수는 없다.\n\n질문 순서와 검증 과정까지만 줄여준다.\n\n오늘 가장 오래 멈춘 항목이 어디인지부터 기록해보자.',
  ].map((text, index) => ({ content_type: DAILY_TYPES[index], text }));
  assert.deepEqual(validateHumanVoiceBatch(posts), []);
});

test('범용 카피와 고객 언어가 없는 배치를 거부한다', () => {
  const posts = Array.from({ length: 5 }, (_, index) => ({
    content_type: DAILY_TYPES[index],
    text: `많은 분들이 고민합니다 ${index}.\n\n일반적인 설명입니다.\n\n도움이 되셨다면 확인해주세요.`,
  }));
  const problems = validateHumanVoiceBatch(posts);
  assert.ok(problems.some((problem) => problem.includes('범용 카피')));
  assert.ok(problems.some((problem) => problem.includes('고객 언어')));
});
