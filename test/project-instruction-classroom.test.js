import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildProjectInstructionMarkdown,
  createSessionToken,
  emptyProjectState,
  handleProjectInstructionClassroom,
  nextProjectStage,
  normalizeProjectState,
  verifySessionToken,
} from '../lib/project-instruction-classroom.js';

const PAGE_URL = new URL('../tools/project-instruction/index.html', import.meta.url);

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
  };
}

function completeState() {
  return {
    ...emptyProjectState(),
    projectName: '민원 요약 도우미',
    oneLine: '긴 민원을 핵심 세 줄로 정리한다.',
    problem: '담당자가 긴 민원에서 핵심 요구를 찾는 데 시간이 걸린다.',
    primaryUser: '민원 담당자',
    useSituation: '온라인 민원 시스템에 들어온 긴 글을 처음 검토할 때',
    solution: '민원 내용을 입력하면 핵심 요구와 확인할 항목을 보여준다.',
    userFlow: ['민원 내용을 붙여넣는다', '요약 버튼을 누른다', '결과를 확인한다'],
    screens: ['민원 입력 화면', '요약 결과 화면'],
    mustFeatures: ['텍스트 입력', '핵심 요약', '결과 복사'],
    inputs: ['민원 텍스트'],
    process: ['입력값 확인', '핵심 요구 정리'],
    outputs: ['핵심 요구 세 줄'],
    successCriteria: ['민원 텍스트를 입력하면 핵심 요구 세 줄이 보인다'],
  };
}

test('강의용 상태는 화면과 MUST 기능을 각각 3개로 제한한다', () => {
  const state = normalizeProjectState({
    screens: ['1', '2', '3', '4'],
    mustFeatures: ['1', '2', '3', '4'],
    userFlow: ['1', '2', '3', '4', '5', '6', '7'],
  });
  assert.deepEqual(state.screens, ['1', '2', '3']);
  assert.deepEqual(state.mustFeatures, ['1', '2', '3']);
  assert.equal(state.userFlow.length, 6);
});

test('필수 정보가 채워진 순서대로 다음 질문 단계를 고른다', () => {
  const state = emptyProjectState();
  assert.equal(nextProjectStage(state), 'problem');
  state.problem = '문제';
  assert.equal(nextProjectStage(state), 'user');
  state.primaryUser = '사용자';
  assert.equal(nextProjectStage(state), 'user');
  state.useSituation = '업무를 시작할 때';
  state.solution = '해결';
  state.userFlow = ['입력', '결과'];
  state.screens = ['입력 화면'];
  state.mustFeatures = ['입력'];
  assert.equal(nextProjectStage(state), 'test');
  state.successCriteria = ['결과가 보인다'];
  assert.equal(nextProjectStage(state), 'complete');
});

test('MD 파일에 구현 범위·완료 조건·Antigravity 실행 지시가 포함된다', () => {
  const markdown = buildProjectInstructionMarkdown(completeState());
  assert.match(markdown, /^# PROJECT_INSTRUCTION\.md/);
  assert.match(markdown, /민원 요약 도우미/);
  assert.match(markdown, /화면 최대 3개, MUST 기능 최대 3개/);
  assert.match(markdown, /- \[ \] 민원 텍스트를 입력하면 핵심 요구 세 줄이 보인다/);
  assert.match(markdown, /로그인·회원가입/);
  assert.match(markdown, /Antigravity 실행 지시/);
});

test('서명 세션은 턴과 만료시간을 검증하고 변조를 거절한다', () => {
  const token = createSessionToken('test-secret', 2, 1000);
  assert.equal(verifySessionToken(token, 'test-secret', 2000).turn, 2);
  assert.throws(() => verifySessionToken(token + 'x', 'test-secret', 2000), /세션/);
  assert.throws(() => verifySessionToken(token, 'test-secret', 1000 + (3 * 60 * 60 * 1000)), /만료/);
});

test('시작 요청은 AI를 호출하지 않고 첫 질문과 세션을 반환한다', async () => {
  const res = responseRecorder();
  await handleProjectInstructionClassroom({
    body: { action: 'start', startMode: 'unsure' }, headers: {}, socket: {},
  }, res, { secret: 'test-secret' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.stage, 'problem');
  assert.match(res.payload.assistantMessage, /불편/);
  assert.ok(res.payload.sessionToken);
});

test('AI 답변은 정규화한 뒤 완성된 MD와 다음 세션을 돌려준다', async () => {
  const state = completeState();
  const client = {
    messages: {
      async create() {
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({
            assistantMessage: '완성됐습니다.', state, quickReplies: [],
          }) }],
        };
      },
    },
  };
  const res = responseRecorder();
  await handleProjectInstructionClassroom({
    body: {
      action: 'answer', startMode: 'idea', stage: 'test',
      sessionToken: createSessionToken('answer-secret'), state, answer: '결과 세 줄이 화면에 보이면 됩니다.',
    },
    headers: { 'x-forwarded-for': '198.51.100.10' }, socket: {},
  }, res, { secret: 'answer-secret', client });
  assert.equal(res.payload.ready, true);
  assert.equal(res.payload.stage, 'complete');
  assert.match(res.payload.markdown, /민원 요약 도우미/);
  assert.ok(res.payload.sessionToken);
});

test('생성기 화면은 두 시작 경로·진행 단계·MD 다운로드를 제공한다', async () => {
  const [html, app, toolsHub, home, vercel, api] = await Promise.all([
    readFile(PAGE_URL, 'utf8'),
    readFile(new URL('../tools/project-instruction/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../tools/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../api/cardnews-generate.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /업무지시서 MD파일 생성기/);
  assert.match(html, /data-start-mode="idea"/);
  assert.match(html, /data-start-mode="unsure"/);
  assert.match(html, /문제[\s\S]*사용자[\s\S]*해결[\s\S]*흐름[\s\S]*기능[\s\S]*테스트/);
  assert.match(html, /id="download-button"/);
  assert.match(html, /민감한 정보는 입력하지 마세요/);
  assert.match(app, /project_instruction_download/);
  assert.match(app, /교실 안전 모드/);
  assert.match(toolsHub, /data-tool-id="project-instruction"/);
  assert.match(home, /data-tool="project-instruction"/);
  assert.match(vercel, /\/api\/project-instruction/);
  assert.match(api, /engine\) === 'project_instruction_classroom'/);
});
