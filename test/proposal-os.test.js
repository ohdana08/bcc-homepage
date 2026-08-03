import test from 'node:test';
import assert from 'node:assert/strict';
import { __test } from '../lib/proposal-os.js';
import { __test as mailTest } from '../lib/proposal-mail-intake.js';

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

test('무료 도구 제약도 지식 검색어에 반영한다', () => {
  const rows = [
    { title: '유료 API 자동화', content: 'API 키와 유료 모델을 사용한다', synced_at: '2026-01-02' },
    { title: '무료 AI 리터러시', content: 'NotebookLM 무료 계정과 Claude 무료 계정 실습', synced_at: '2026-01-01' },
  ];
  const selected = __test.selectKnowledge(rows, {
    institution_name: '교육기관',
    inquiry_text: 'AI 리터러시',
    constraints: 'NotebookLM과 Claude 모두 무료 계정만 사용',
  });
  assert.equal(selected[0].title, '무료 AI 리터러시');
});

test('전사본이 포함된 통합 문의는 충분한 길이까지 보존한다', () => {
  const transcript = '통화 내용 '.repeat(6000);
  const row = __test.compactCaseInput({ institution_name: '기관', inquiry_text: transcript });
  assert.ok(row.inquiry_text.length > 30000);
  assert.ok(row.inquiry_text.length <= 80000);
});

test('전달된 메일에서 원 기관 발신자와 제목을 우선 추출한다', () => {
  const body = `보낸 사람: 동래여성인력개발센터 <center@example.org>\n제목: [동래여성인력개발센터] AI 리터러시 강의 요청\n\n강의계획서를 요청드립니다.`;
  const envelope = mailTest.extractForwardedEnvelope(body, 'BCC <worker@example.com>', 'Fwd: 문의');
  assert.equal(envelope.from.email, 'center@example.org');
  assert.equal(envelope.subject, '[동래여성인력개발센터] AI 리터러시 강의 요청');
  assert.equal(mailTest.inferInstitutionName(envelope.subject, envelope.from.name, envelope.from.email), '동래여성인력개발센터');
});

test('메일 첨부파일 용량과 개수를 제한한다', () => {
  const normalized = mailTest.normalizeAttachments([{ filename: '요청.txt', mime_type: 'text/plain', data_base64: Buffer.from('요청 내용').toString('base64') }]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].filename, '요청.txt');
  assert.throws(() => mailTest.normalizeAttachments([{ filename: 'large.bin', data_base64: Buffer.alloc(2_000_001).toString('base64') }]), /너무 큽니다/);
});

test('작업메일 공유 비밀값은 길이와 내용이 모두 같아야 한다', () => {
  assert.equal(mailTest.safeEqual('abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(mailTest.safeEqual('abcdefghijklmnopqrstuvwxyz', 'abcdefghijklmnopqrstuvwxyZ'), false);
  assert.equal(mailTest.safeEqual('short', 'longer'), false);
});
