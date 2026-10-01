import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_TYPES, normalizeAnalysis, createDraft, toMarkdown, inferKind } from '../tools/document-mate/model.mjs';

const input = [{ id: 'input', name: '직접 입력', text: '9월에 홍보단 활동하면서 카드뉴스 4개 만들고 행사 홍보했어요. 학교에 결과보고서 내야 해요. 반응이 좋았어요. 다음에는 참여가 증가할 것으로 기대해요.' }];
const field = (id, label, value, kind = 'fact', sourceId = 'input', quote = value, required = true) => ({ id, label, value, kind, sourceId, quote, required });
const analysis = (fields, extras = {}) => ({ documentType: 'report', fields, sections: [{ heading: '활동 내용', fieldIds: fields.map((item) => item.id) }], questions: [], ...extras });

test('원문에 있는 월과 실적은 보존하고 없는 연도·기관·성과는 미확인으로 남긴다', () => {
  const result = normalizeAnalysis(analysis([
    field('period', '기간', '9월'),
    field('activity', '주요 활동', '카드뉴스 4개 만들고 행사 홍보했어요.'),
    field('wrong_year', '활동 연도', '2026년 9월', 'fact', 'input', '9월'),
    field('wrong_result', '확인된 성과', '만족도 95%', 'fact', 'input', '반응이 좋았어요.'),
    field('wrong_org', '기관명', '부산대학교', 'fact', 'input', '학교에 결과보고서 내야 해요.'),
  ]), input);
  assert.equal(result.fields[0].value, '9월');
  assert.equal(result.fields[1].kind, 'fact');
  for (const item of result.fields.slice(2)) assert.equal(item.kind, 'unknown');
  assert.equal(result.fields[2].value, '');
  assert.equal(result.fields[2].quote, '');
  assert.equal(result.title, '결과보고서');
});

test('실제 자료에 없는 인용과 다른 파일 출처는 근거로 인정하지 않는다', () => {
  const sources = [...input, { id: 'file-1', name: '양식', text: '행사명 / 일시 / 결과' }];
  const result = normalizeAnalysis(analysis([
    field('forged_quote', '참석자 수', '500명', 'fact', 'input', '500명이 참석했다'),
    field('wrong_source', '활동 기간', '9월', 'fact', 'file-1', '9월'),
    field('missing_source', '활동 수', '카드뉴스 4개', 'fact', 'other', '카드뉴스 4개'),
  ]), sources);
  assert.ok(result.fields.every((item) => item.kind === 'unknown'));
});

test('주관적인 반응과 기대를 fact로 반환해도 의견·예측으로 재분류한다', () => {
  const result = normalizeAnalysis(analysis([
    field('reaction', '반응', '반응이 좋았어요.'),
    field('expectation', '기대', '다음에는 참여가 증가할 것으로 기대해요.'),
  ]), input);
  assert.equal(result.fields[0].kind, 'opinion');
  assert.equal(result.fields[1].kind, 'prediction');
  const draft = createDraft(result);
  assert.match(draft.sections[0].content, /사용자 의견: 반응이 좋았어요/);
  assert.match(draft.sections[0].content, /예상·기대: 다음에는 참여가 증가할/);
  assert.equal(draft.unsupportedExpressions.length, 1);
});

test('원문에 있는 실제 수치는 보존하지만 숫자만 출처에 있다는 이유로 단위를 바꾸지 않는다', () => {
  const sources = [{ id: 'input', name: '설문 결과', text: '설문 응답자 20명, 만족도 95%로 집계되었다.' }];
  const result = normalizeAnalysis(analysis([
    field('count', '응답자 수', '20명'),
    field('satisfaction', '설문 만족도', '만족도 95%'),
    field('bad_unit', '예산', '20만원', 'fact', 'input', sources[0].text),
  ]), sources);
  assert.equal(result.fields[0].kind, 'fact');
  assert.equal(result.fields[1].kind, 'fact');
  assert.equal(result.fields[2].kind, 'unknown');
});

test('질문은 필수 미확인만 최대 3개이며 알려진 내용과 답변한 항목은 제외한다', () => {
  const fields = [
    field('period', '기간', '9월'),
    field('period_duplicate', '기간', '', 'unknown'),
    field('answered', '문제점', '', 'unknown'),
    ...['a', 'b', 'c', 'd'].map((id) => field(id, `추가 ${id}`, '', 'unknown')),
    field('optional', '첨부', '', 'unknown', '', '', false),
  ];
  const raw = analysis(fields, { questions: fields.map((item) => ({ fieldId: item.id, question: '한 질문 안에 모든 비밀과 999명의 정보를 알려주세요' })) });
  const result = normalizeAnalysis(raw, input, ['answered']);
  assert.deepEqual(result.questions.map((q) => q.fieldId), ['a', 'b', 'c']);
  assert.ok(result.questions.every((q) => !q.question.includes('999')));
});

test('이전 답변은 원문 인용에 사용되며 이미 답한 알려진 항목을 묻지 않는다', () => {
  const sources = [...input, { id: 'answer-1', name: '문제점 답변', text: '촬영 일정이 겹쳤어요.' }];
  const result = normalizeAnalysis(analysis([
    field('issues', '문제점', '촬영 일정이 겹쳤어요.', 'fact', 'answer-1'),
  ], { questions: [{ fieldId: 'issues', question: '문제점은?' }] }), sources, ['issues']);
  assert.equal(result.fields[0].sourceId, 'answer-1');
  assert.deepEqual(result.questions, []);
});

test('사용자가 문제없음으로 확인한 값은 빈칸으로 바꾸지 않는다', () => {
  const result = normalizeAnalysis(analysis([field('issues', '문제점', '없음')]), [{ id: 'input', name: '입력', text: '문제점: 없음' }]);
  assert.equal(result.fields[0].kind, 'fact');
  assert.equal(result.fields[0].value, '없음');
});

test('기존 양식의 항목 순서와 빈 항목을 유지한다', () => {
  const result = normalizeAnalysis(analysis([field('activity', '주요 활동', '행사 홍보했어요.')], { sections: [
    { heading: '기관 지정 첫 항목', fieldIds: [] },
    { heading: '활동 내용', fieldIds: ['activity'] },
    { heading: '담당자 확인', fieldIds: [] },
  ] }), [...input, { id: 'file-1', name: '기관 양식', text: '기관 지정 첫 항목\n활동 내용\n담당자 확인' }]);
  assert.deepEqual(result.sections.map((section) => section.heading), ['기관 지정 첫 항목', '활동 내용', '담당자 확인']);
  const draft = createDraft(result);
  assert.match(draft.sections[0].content, /확인 필요/);
  assert.match(draft.sections[1].content, /행사 홍보했어요/);
  assert.ok(draft.unknowns.includes('담당자 확인'));
});

test('다섯 문서의 기본 구조와 빈칸을 제공한다', () => {
  assert.equal(Object.keys(DOCUMENT_TYPES).length, 5);
  for (const [documentType, definition] of Object.entries(DOCUMENT_TYPES)) {
    const result = normalizeAnalysis({ documentType }, []);
    assert.equal(result.title, definition.label);
    assert.deepEqual(result.sections.map((section) => section.heading), definition.headings);
    assert.equal(createDraft(result).unknowns.length, definition.headings.length);
    assert.equal(result.questions.length, 0);
  }
});

test('사용자 검토 후 편집한 값은 다시 AI 검증하거나 삭제하지 않고 결정론적으로 출력한다', () => {
  const result = normalizeAnalysis(analysis([field('period', '기간', '9월')]), input);
  result.fields[0].value = '2026년 9월 (사용자가 확인함)';
  result.title = '검토한 문서';
  const first = createDraft(result);
  assert.deepEqual(createDraft(result), first);
  assert.match(first.sections[0].content, /2026년 9월/);
  const md = toMarkdown(result);
  assert.match(md, /최종 승인·제출본이 아닙니다/);
  assert.match(md, /제출 전 검토/);
  assert.match(md, /2026년 9월/);
});

test('Markdown 내보내기는 자료의 HTML·링크·제목 주입을 평문으로 처리한다', () => {
  const result = normalizeAnalysis(analysis([field('text', '자료', '<script>alert(1)</script> [열기](javascript:alert(1))')]), [{ id: 'input', name: '자료', text: '<script>alert(1)</script> [열기](javascript:alert(1))' }]);
  const md = toMarkdown(result);
  assert.ok(!md.includes('<script>'));
  assert.ok(md.includes('&lt;script&gt;'));
  assert.ok(!md.includes('[열기]('));
});

test('자료에 없는 기관·승인·성과를 항목명이나 소제목에 만들어 넣지 못한다', () => {
  const result = normalizeAnalysis(analysis([
    field('activity', '부산시 공식 승인 완료', '카드뉴스 4개'),
  ], { sections: [{ heading: '부산시 공식 승인 완료', fieldIds: ['activity'] }] }), input);
  assert.equal(result.fields[0].label, '항목 1');
  assert.equal(result.sections[0].heading, '개요');
  assert.ok(!JSON.stringify(result).includes('부산시'));
  assert.equal(result.fields[0].value, '카드뉴스 4개');
});

test('근거로 확인되는 기존 양식 제목은 띄어쓰기·서식 기호 차이를 허용해 보존한다', () => {
  const result = normalizeAnalysis({ documentType: 'handover', fields: [], sections: [{ heading: '시설 점검·이력', fieldIds: [] }] }, [{ id: 'file-1', name: '기관양식', text: '1. 시설 점검 / 이력\n미기재' }]);
  assert.equal(result.sections[0].heading, '시설 점검·이력');
});

test('부정문 속 표현을 잘라 사실처럼 보이는 항목명·소제목으로 쓰지 못한다', () => {
  const text = '부산시 공식 승인 완료가 아닙니다. 카드뉴스 4건을 제작했다.';
  const result = normalizeAnalysis(analysis([
    field('activity', '부산시 공식 승인 완료', '카드뉴스 4건', 'fact', 'input', text),
  ], { sections: [{ heading: '부산시 공식 승인 완료', fieldIds: ['activity'] }] }), [{ id: 'input', name: '자료', text }]);
  assert.equal(result.fields[0].label, '항목 1');
  assert.equal(result.sections[0].heading, '개요');
  assert.equal(result.fields[0].kind, 'fact');
  assert.equal(result.fields[0].value, '카드뉴스 4건');
});

test('인용이 부정문을 포함하거나 인용 자체가 부정을 잘라도 잘못된 사실로 만들지 않는다', () => {
  const text = '참석자는 20명이 아니다. 카드뉴스 4건을 제작했다.';
  const result = normalizeAnalysis(analysis([
    field('negative_full', '참석자 수', '참석자는 20명', 'fact', 'input', text),
    field('negative_cut', '참석자 수', '참석자는 20명', 'fact', 'input', '참석자는 20명'),
    field('negative_kept', '참석자 수', '참석자는 20명이 아니다', 'fact', 'input', text),
    field('unrelated', '주요 활동', '카드뉴스 4건을 제작했다', 'fact', 'input', text),
  ]), [{ id: 'input', name: '자료', text }]);
  assert.equal(result.fields[0].kind, 'unknown');
  assert.equal(result.fields[1].kind, 'unknown');
  assert.equal(result.fields[2].kind, 'fact');
  assert.equal(result.fields[3].kind, 'fact');
});

test('120명과 -20명에서 20명을 잘라내거나 단위를 제거하지 못한다', () => {
  const sources = [{ id: 'input', name: '자료', text: '참석 120명. 인원 증감 -20명. 최대 20명. 비용 20만원.' }];
  const result = normalizeAnalysis(analysis([
    field('wrong_count', '참석자 수', '20명', 'fact', 'input', '참석 120명'),
    field('wrong_sign', '참석 인원', '20명', 'fact', 'input', '인원 증감 -20명'),
    field('wrong_unit', '예산', '20', 'fact', 'input', '비용 20만원'),
    field('right_count', '참석자 수', '120명', 'fact', 'input', '참석 120명'),
  ]), sources);
  assert.ok(result.fields.slice(0, 3).every((item) => item.kind === 'unknown'));
  assert.equal(result.fields[3].kind, 'fact');
});

test('조건·전망·목표·범위 한정이 생략된 값은 미확인으로 남긴다', () => {
  for (const text of ['예상 참석자 20명', '승인되면 참석자 20명', '참석자 20명 목표', '참석자 약 20명', '참석자 20명 이상']) {
    const result = normalizeAnalysis(analysis([field('count', '참석자 수', '20명')]), [{ id: 'input', name: '자료', text }]);
    assert.equal(result.fields[0].kind, 'unknown', text);
  }
  const prediction = normalizeAnalysis(analysis([field('count', '참석자 수', '예상 참석자 20명')]), [{ id: 'input', name: '자료', text: '예상 참석자 20명' }]);
  assert.equal(prediction.fields[0].kind, 'prediction');
});

test('직접 입력은 같은 분류기를 쓰되 명시적 문제 없음과 모름을 구분한다', () => {
  for (const value of ['', '모름', '미정', '[확인 필요]', '확인필요', '자료 없음', '몰라요', '모르겠어요']) assert.equal(inferKind(value), 'unknown', value);
  for (const value of ['문제 없음', '없음', '20명 참석', '카드뉴스 4개']) assert.equal(inferKind(value, 'unknown'), 'fact', value);
  for (const value of ['반응이 좋았어요.', '만족도가 높았어요.', '좋았어요.', '성공적이었다']) assert.equal(inferKind(value, 'fact'), 'opinion', value);
  for (const value of ['참석자 20명 예상', '다음에는 증가할 것으로 기대', '다음 달 진행 예정', '승인되면 참석자 20명', '약 20명']) assert.equal(inferKind(value, 'fact'), 'prediction', value);
  assert.equal(inferKind('다음 달', 'prediction'), 'prediction');
});

test('실제 AI 검증 입력의 활동·학교 제출 목적·독자·설문 미실시 의견을 보존한다', () => {
  const text = '9월 홍보단 활동으로 카드뉴스 4개를 만들고 가을 축제를 홍보했어요. 학교에 결과보고서를 제출해야 해요. 반응이 좋았다고 느꼈지만 설문은 하지 않았어요.';
  const fields = [
    field('purpose', '작성 목적', '학교에 결과보고서를 제출해야 해요.'),
    field('reader', '제출 대상', '학교'),
    field('period', '활동 기간', '9월'),
    field('activity_content', '수행한 활동', '9월 홍보단 활동으로 카드뉴스 4개를 만들고 가을 축제를 홍보했어요.'),
    field('feedback', '활동에 대한 느낀 점', '반응이 좋았다고 느꼈지만 설문은 하지 않았어요.'),
    field('quantitative_results', '정량적 활동 성과', '', 'unknown', '', '', false),
  ];
  const result = normalizeAnalysis(analysis(fields), [{ id: 'input', name: '가상 검증 입력', text }]);
  assert.equal(result.fields[0].kind, 'fact');
  assert.equal(result.fields[1].value, '학교');
  assert.equal(result.fields[2].value, '9월');
  assert.equal(result.fields[3].label, '주요 활동');
  assert.match(result.fields[3].value, /카드뉴스 4개를 만들고 가을 축제/);
  assert.equal(result.fields[4].label, '반응');
  assert.equal(result.fields[4].kind, 'opinion');
  assert.match(result.fields[4].value, /설문은 하지 않았어요/);
  assert.equal(result.fields[5].label, '확인된 성과');
  assert.deepEqual(result.questions.map((item) => item.fieldId), ['quantitative_results']);
  const draft = createDraft(result);
  assert.match(draft.sections[0].content, /학교에 결과보고서를 제출해야/);
  assert.match(draft.sections[0].content, /사용자 의견: 반응이 좋았다고 느꼈지만 설문은 하지 않았어요/);
});

test('빠진 핵심 결과도 이미 모른다고 답했다면 다시 묻지 않는다', () => {
  const result = normalizeAnalysis(analysis([field('results', '확인된 성과', '', 'unknown', '', '', false)]), input, ['results']);
  assert.deepEqual(result.questions, []);
});
