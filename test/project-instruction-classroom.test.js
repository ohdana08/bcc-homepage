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

test('쉬운 말로 받은 불편·현재 방법을 정확히 나눈다', () => {
  const answer = [
    '어떤 일을 하나요: 온라인 민원을 처음 검토한다',
    '지금은 어떻게 하나요: 원문을 읽고 메모장에 옮긴다',
    '무엇이 가장 불편한가요: 핵심 요구와 기한을 찾는 데 오래 걸린다',
  ].join('\n');
  const fields = parseLabeledFields(answer);
  assert.equal(fields.currentSituation, '온라인 민원을 처음 검토한다');
  assert.equal(fields.currentMethod, '원문을 읽고 메모장에 옮긴다');
  assert.equal(fields.painPoint, '핵심 요구와 기한을 찾는 데 오래 걸린다');

  const state = applyLocalAnswer(emptyProjectState(), 'problem', answer);
  assert.equal(state.problem, '핵심 요구와 기한을 찾는 데 오래 걸린다');
  assert.equal(state.currentMethod, '원문을 읽고 메모장에 옮긴다');
});

test('쓰는 순서는 6개, 화면과 꼭 필요한 동작은 각각 3개로 제한한다', () => {
  const flow = splitItems('입력 → 확인 → 처리 → 검토 → 복사 → 저장 → 공유', 6);
  assert.deepEqual(flow, ['입력', '확인', '처리', '검토', '복사', '저장']);

  const state = applyLocalAnswer(emptyProjectState(), 'features', [
    '보일 화면: 입력 / 결과 / 도움말 / 관리자',
    '꼭 필요한 동작: 붙여넣기 / 요약 / 복사 / 로그인',
  ].join('\n'));
  assert.deepEqual(state.screens, ['입력', '결과', '도움말']);
  assert.deepEqual(state.mustFeatures, ['붙여넣기', '요약', '복사']);
});

test('쉬운 질문 6단계만으로 홈페이지 만들기 설명서를 만든다', () => {
  const answers = {
    problem: '어떤 일을 하나요: 민원 검토\n지금은 어떻게 하나요: 직접 읽기\n무엇이 가장 불편한가요: 시간이 오래 걸림',
    user: '누가 쓰나요: 민원 담당자\n언제 쓰나요: 긴 민원을 처음 검토할 때',
    solution: '만들 것의 이름: 민원 요약 도우미\n이렇게 도와주면 좋아요: 핵심 요구를 정리해 보여준다\n가장 좋아져야 하는 점: 누락 방지',
    flow: '쓰는 순서: 민원 입력 → 요약 누르기 → 결과 확인 → 복사',
    features: '보일 화면: 입력과 결과가 있는 한 화면\n꼭 필요한 동작: 민원 입력 / 결과 표시 / 결과 복사',
    test: '넣어볼 내용: 개인정보를 뺀 민원\n나와야 할 결과: 핵심 요구 / 처리 기한\n잘 만들어졌다고 보는 기준: 결과가 보인다 / 복사가 된다',
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
  assert.match(markdown, /^# 홈페이지 만들기 설명서/);
  assert.match(markdown, /민원 요약 도우미/);
  assert.match(markdown, /- \[ \] 결과가 보인다/);
  assert.match(markdown, /Antigravity에게 부탁할 말/);
  assert.doesNotMatch(markdown, /업무지시서|MVP|MUST|API|0원|무료|MD 파일/);
});

test('자유 문장도 버리지 않고 해당 단계의 원문으로 보존한다', () => {
  const problem = '반복 보고서를 직접 정리하는 데 시간이 오래 걸린다.';
  const state = applyLocalAnswer(emptyProjectState(), 'problem', problem);
  assert.equal(state.problem, problem);
  assert.equal(state.painPoint, problem);
});

test('두 시작 유형 모두 쉬운 문제 질문과 답변 틀을 제공한다', () => {
  const idea = getQuestion('problem', 'idea');
  const unsure = getQuestion('problem', 'unsure');
  assert.match(idea.prompt, /불편하거나 시간이 아깝다/);
  assert.match(unsure.prompt, /없어도 괜찮습니다/);
  assert.equal(idea.quickReplies[0].label, '답변 틀 넣기');
  assert.match(idea.quickReplies[0].value, /어떤 일을 하나요:/);
});

test('운영 화면은 초보자용 쉬운 말만 보여주고 외부 호출은 하지 않는다', async () => {
  const [html, app, localEngine] = await Promise.all([
    readFile(PAGE_URL, 'utf8'),
    readFile(new URL('../tools/project-instruction/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../tools/project-instruction/local-engine.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /홈페이지 만들기 설명서/);
  assert.match(html, /설명서 파일 받기/);
  assert.match(html, /한 번에 하나씩 쉽게 물어봅니다/);
  assert.doesNotMatch(html, /업무지시서|MD파일|MD 파일|MVP|API|0원|무료/);
  assert.match(html, /data-local-only="true"/);
  assert.match(html, /type="module"/);
  assert.doesNotMatch(app, /fetch\s*\(/);
  assert.doesNotMatch(app, /API_URL|sessionToken|ANTHROPIC/);
  assert.doesNotMatch(localEngine, /유료 AI API|비용 0원|무료 버전/);
});

test('입력창에서 자료와 링크를 나누고 자세히 만들기 안내로 연결한다', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(PAGE_URL, 'utf8'),
    readFile(new URL('../tools/project-instruction/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../tools/project-instruction/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /data-detail-entry="material"[^>]*><span[^>]*>＋<\/span> 자료 추가/);
  assert.match(html, /data-detail-entry="link"[^>]*><span[^>]*>↗<\/span> 링크 추가/);
  assert.match(html, /id="detail-dialog"/);
  assert.match(html, /자료와 함께 자세히 만들기/);
  assert.match(html, /utm_medium=detail_gate/);
  assert.doesNotMatch(html, /유료\s*결제하세요/);
  assert.match(app, /project_instruction_detail_open/);
  assert.match(app, /사진의 글씨와 문서 내용/);
  assert.match(app, /참고할 홈페이지에서 눈에 띄는 구성/);
  assert.match(styles, /\.detail-dialog::backdrop/);
  assert.match(styles, /\.source-button:focus-visible/);
});

test('서버 AI 호출 입구와 Vercel rewrite가 제거됐다', async () => {
  const [vercel, api] = await Promise.all([
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../api/cardnews-generate.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(vercel, /\/api\/project-instruction/);
  assert.doesNotMatch(api, /project_instruction_classroom|handleProjectInstructionClassroom/);
});

test('잇툴즈와 홈페이지의 쉬운 이름 진입 카드는 유지한다', async () => {
  const [toolsHub, home] = await Promise.all([
    readFile(new URL('../tools/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(toolsHub, /data-tool-id="project-instruction"/);
  assert.match(home, /data-tool="project-instruction"/);
  assert.match(toolsHub, /홈페이지 만들기 설명서/);
  assert.match(home, /홈페이지 만들기 설명서/);
});
