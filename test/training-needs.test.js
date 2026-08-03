import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnswers,
  summarizeResponses,
  isSurveyOpen,
  generatePublicCode,
} from '../lib/training-needs.js';

function completeAnswers(overrides = {}) {
  return {
    current_context: 'office_admin',
    ai_experience: 'simple_questions',
    ai_tools: ['chatgpt'],
    work_tasks: ['documents', 'research_summary'],
    pain_points: ['what_to_ask'],
    desired_topics: ['prompt_basics', 'document_writing'],
    desired_outputs: ['work_document'],
    learning_methods: ['step_by_step'],
    practice_environment: ['own_laptop', 'free_account'],
    data_security: 'sample_only',
    open_question: '실제 보고서를 잘 쓰고 싶어요.',
    others: {},
    ...overrides,
  };
}

test('필수 선택값과 기타 내용을 정규화한다', () => {
  const result = normalizeAnswers(completeAnswers({
    current_context: 'other',
    others: { current_context: '  문화 기획\n업무  ' },
  }));
  assert.equal(result.current_context, 'other');
  assert.equal(result.others.current_context, '문화 기획 업무');
  assert.equal(result.open_question, '실제 보고서를 잘 쓰고 싶어요.');
});

test('필수 문항이 비어 있으면 제출을 거절한다', () => {
  assert.throws(() => normalizeAnswers(completeAnswers({ desired_outputs: [] })), /답해주세요/);
});

test('복수선택 최대 개수를 검증한다', () => {
  assert.throws(() => normalizeAnswers(completeAnswers({
    desired_outputs: ['work_document', 'reusable_prompt', 'research_report'],
  })), /2개까지/);
});

test('사용 도구 없음과 다른 도구를 함께 선택할 수 없다', () => {
  assert.throws(() => normalizeAnswers(completeAnswers({ ai_tools: ['none', 'chatgpt'] })), /함께 선택/);
});

test('응답을 빈도와 백분율로 집계한다', () => {
  const rows = [
    { answers: normalizeAnswers(completeAnswers()) },
    { answers: normalizeAnswers(completeAnswers({ ai_experience: 'never', desired_topics: ['prompt_basics'] })) },
    { answers: normalizeAnswers(completeAnswers({ ai_experience: 'never', desired_topics: ['prompt_basics', 'research'] })) },
  ];
  const summary = summarizeResponses(rows);
  assert.equal(summary.sample_size, 3);
  assert.deepEqual(summary.distributions.ai_experience[0], {
    value: 'never', label: '처음이거나 거의 안 써봤다', count: 2, percentage: 66.7,
  });
  assert.equal(summary.distributions.desired_topics[0].value, 'prompt_basics');
  assert.equal(summary.distributions.desired_topics[0].count, 3);
  assert.equal(summary.open_questions.length, 3);
});

test('설문 상태와 마감일로 제출 가능 여부를 판정한다', () => {
  assert.equal(isSurveyOpen({ status: 'open', response_deadline: '2026-08-05' }, '2026-08-04'), true);
  assert.equal(isSurveyOpen({ status: 'open', response_deadline: '2026-08-03' }, '2026-08-04'), false);
  assert.equal(isSurveyOpen({ status: 'closed', response_deadline: '2026-08-05' }, '2026-08-04'), false);
});

test('공유용 참여코드를 짧은 대문자로 생성한다', () => {
  const code = generatePublicCode();
  assert.match(code, /^[A-F0-9]{8}$/);
});

test('자유응답에 적힌 이메일과 휴대폰 번호를 저장하지 않는다', () => {
  const result = normalizeAnswers(completeAnswers({
    open_question: '연락처는 010-1234-5678, test@example.com입니다.',
  }));
  assert.equal(result.open_question, '연락처는 [전화번호 삭제], [이메일 삭제]입니다.');
});
