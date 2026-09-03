import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STAGES,
  applyLocalAnswer,
  buildProjectInstructionMarkdown,
  emptyProjectState,
  getQuestion,
  nextStage,
  parseLabeledFields,
  splitItems,
} from '../tools/project-instruction/local-engine.js';

const PAGE_URL = new URL('../tools/project-instruction/index.html', import.meta.url);

test('문제 답변 틀을 현재 상황·방법·불편으로 정확히 나눈다', () => {
  const answer = [
    '현재 하는 일: 온라인 민원을 처음 검토한다',
    '현재 방법: 원문을 읽고 메모장에 옮긴다',
    '가장 큰 불편: 핵심 요구와 기한을 찾는 데 오래 걸린다',
  ].join('\n');
  const fields = parseLabeledFields(answer);
  assert.equal(fields.currentSituation, '온라인 민원을 처음 검토한다');
  assert.equal(fields.currentMethod, '원문을 읽고 메모장에 옮긴다');
  assert.equal(fields.painPoint, '핵심 요구와 기한을 찾는 데 오래 걸린다');

  const state = applyLocalAnswer(emptyProjectState(), 'problem', answer);
  assert.equal(state.problem, '핵심 요구와 기한을 찾는 데 오래 걸린다');
  assert.equal(state.currentMethod, '원문을 읽고 메모장에 옮긴다');
});

test('사용 순서는 6개, 화면과 핵심 기능은 각각 3개로 제한한다', () => {
  const flow = splitItems('입력 → 확인 → 처리 → 검토 → 복사 → 저장 → 공유', 6);
  assert.deepEqual(flow, ['입력', '확인', '처리', '검토', '복사', '저장']);

  const state = applyLocalAnswer(emptyProjectState(), 'features', [
    '화면: 입력 / 결과 / 도움말 / 관리자',
    '핵심 기능: 붙여넣기 / 요약 / 복사 / 로그인',
  ].join('\n'));
  assert.deepEqual(state.screens, ['입력', '결과', '도움말']);
  assert.deepEqual(state.mustFeatures, ['붙여넣기', '요약', '복사']);
});

test('정해진 6단계만으로 완성 상태와 MD를 만든다', () => {
  const answers = {
    problem: '현재 하는 일: 민원 검토\n현재 방법: 직접 읽기\n가장 큰 불편: 시간이 오래 걸림',
    user: '주요 사용자: 민원 담당자\n사용하는 때: 긴 민원을 처음 검토할 때',
    solution: '프로젝트명: 민원 요약 도우미\n해결 방식: 핵심 요구를 정리해 보여준다\n가장 중요한 가치: 누락 방지',
    flow: '사용 순서: 민원 입력 → 요약 누르기 → 결과 확인 → 복사',
    features: '화면: 입력과 결과가 있는 한 화면\n핵심 기능: 민원 입력 / 결과 표시 / 결과 복사',
    test: '예시 입력: 개인정보를 뺀 민원\n화면에 나와야 할 결과: 핵심 요구 / 처리 기한\n완료 기준: 결과가 보인다 / 복사가 된다',
  };
  let state = emptyProjectState();
  let stage = STAGES[0];
  for (const expectedStage of STAGES) {
    assert.equal(stage, expectedStage);
    state = applyLocalAnswer(state, stage, answers[stage]);
    stage = nextStage(stage);
  }
  assert.equal(stage, 'complete');
  assert.equal(state.projectName, '민원 요약 도우미');
  assert.deepEqual(state.mustFeatures, ['민원 입력', '결과 표시', '결과 복사']);

  const markdown = buildProjectInstructionMarkdown(state);
  assert.match(markdown, /^# PROJECT_INSTRUCTION\.md/);
  assert.match(markdown, /민원 요약 도우미/);
  assert.match(markdown, /유료 AI API와 서버 생성 API를 사용하지 않는다/);
  assert.match(markdown, /- \[ \] 결과가 보인다/);
  assert.match(markdown, /Antigravity 실행 지시/);
});

test('자유 문장도 버리지 않고 해당 단계의 원문으로 보존한다', () => {
  const problem = '반복 보고서를 직접 정리하는 데 시간이 오래 걸린다.';
  const state = applyLocalAnswer(emptyProjectState(), 'problem', problem);
  assert.equal(state.problem, problem);
  assert.equal(state.painPoint, problem);
});

test('두 시작 유형 모두 비용 없는 문제 질문과 답변 틀을 제공한다', () => {
  const idea = getQuestion('problem', 'idea');
  const unsure = getQuestion('problem', 'unsure');
  assert.match(idea.prompt, /해결하려는 문제/);
  assert.match(unsure.prompt, /아이디어가 없어도/);
  assert.equal(idea.quickReplies[0].label, '답변 틀 넣기');
  assert.match(idea.quickReplies[0].value, /현재 하는 일:/);
});

test('운영 화면은 유료 AI API 0회와 브라우저 처리를 명시한다', async () => {
  const [html, app, localEngine] = await Promise.all([
    readFile(PAGE_URL, 'utf8'),
    readFile(new URL('../tools/project-instruction/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../tools/project-instruction/local-engine.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /유료 AI API 호출 0회/);
  assert.match(html, /브라우저 안에서만 처리/);
  assert.match(html, /data-local-only="true"/);
  assert.match(html, /type="module"/);
  assert.doesNotMatch(app, /fetch\s*\(/);
  assert.doesNotMatch(app, /API_URL|sessionToken|ANTHROPIC/);
  assert.match(localEngine, /유료 AI API와 서버 생성 API를 사용하지 않음/);
});

test('서버 AI 호출 입구와 Vercel rewrite가 제거됐다', async () => {
  const [vercel, api] = await Promise.all([
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../api/cardnews-generate.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(vercel, /\/api\/project-instruction/);
  assert.doesNotMatch(api, /project_instruction_classroom|handleProjectInstructionClassroom/);
});

test('잇툴즈와 홈페이지의 생성기 진입 카드는 유지한다', async () => {
  const [toolsHub, home] = await Promise.all([
    readFile(new URL('../tools/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(toolsHub, /data-tool-id="project-instruction"/);
  assert.match(home, /data-tool="project-instruction"/);
});
