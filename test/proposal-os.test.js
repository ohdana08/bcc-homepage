import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../lib/proposal-os.js';

test('기관 문의 입력은 허용된 필드만 정리한다', () => {
  const row = __test.compactCaseInput({
    institution_name: '  경남교육청  ',
    inquiry_text: ' 도서관 사서 대상 AI 실습 ',
    duration_hours: '4',
    status: 'not-a-status',
    injected: 'discard me',
  });
  assert.equal(row.institution_name, '경남교육청');
  assert.equal(row.duration_hours, 4);
  assert.equal(row.status, undefined);
  assert.equal(row.injected, undefined);
});

test('기관 문의와 관련된 옵시디언 기록을 먼저 선택한다', () => {
  const rows = [
    { title: '대학 취업교육', content: '대학생 자소서 작성', synced_at: '2026-01-01' },
    { title: '경남교육청 사서교육', content: '도서관 사서 대상 AI 웹페이지 실습', synced_at: '2026-01-02' },
  ];
  const selected = __test.selectKnowledge(rows, {
    institution_name: '경남교육청', institution_type: '공무원/공공', audience: '도서관 사서', inquiry_text: 'AI 실습 교육',
  });
  assert.equal(selected[0].title, '경남교육청 사서교육');
});
