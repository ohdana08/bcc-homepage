import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPerformanceComment,
  dateKeyInTimeZone,
  zonedDateTimeToUtc,
} from '../lib/threads-autopilot.js';

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

