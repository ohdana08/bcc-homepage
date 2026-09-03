export const STAGES = ['problem', 'user', 'solution', 'flow', 'features', 'test'];

const QUESTIONS = {
  problem: {
    idea: '좋아요. 먼저 해결하려는 문제를 사실대로 적어주세요. 아래 3줄을 채우면 다음 단계에서 바로 쓸 수 있습니다.',
    unsure: '아이디어가 없어도 괜찮습니다. 최근 반복해서 겪는 현장의 불편을 아래 3줄로 적어보세요.',
    template: '현재 하는 일:\n현재 방법:\n가장 큰 불편:',
  },
  user: {
    prompt: '이 결과물을 가장 먼저 사용할 사람과 사용하는 때를 적어주세요.',
    template: '주요 사용자:\n사용하는 때:',
  },
  solution: {
    prompt: '문제를 어떻게 해결할지 적어주세요. 아직 정하지 못한 항목은 비워도 됩니다.',
    template: '프로젝트명:\n해결 방식:\n가장 중요한 가치:',
  },
  flow: {
    prompt: '사용자가 들어와 결과를 얻기까지의 순서를 화살표(→)로 이어 적어주세요.',
    template: '사용 순서: 입력한다 → 버튼을 누른다 → 결과를 확인한다',
  },
  features: {
    prompt: '수업 시간 안에 만들 화면과 핵심 기능을 각각 3개 이내로 적어주세요.',
    template: '화면: 한 화면\n핵심 기능: 입력 / 처리 / 결과 복사',
  },
  test: {
    prompt: '마지막으로 예시 입력과 화면에서 직접 확인할 완료 기준을 적어주세요.',
    template: '예시 입력:\n화면에 나와야 할 결과:\n완료 기준:',
  },
};

const FIELD_ALIASES = {
  '현재 하는 일': 'currentSituation',
  '현재 상황': 'currentSituation',
  '현재 방법': 'currentMethod',
  '현재 해결 방식': 'currentMethod',
  '가장 큰 불편': 'painPoint',
  '문제': 'problem',
  '주요 사용자': 'primaryUser',
  '사용자': 'primaryUser',
  '사용하는 때': 'useSituation',
  '사용 상황': 'useSituation',
  '프로젝트명': 'projectName',
  '해결 방식': 'solution',
  '가장 중요한 가치': 'coreValue',
  '핵심 가치': 'coreValue',
  '사용 순서': 'userFlow',
  '화면': 'screens',
  '화면 구성': 'screens',
  '핵심 기능': 'mustFeatures',
  '기능': 'mustFeatures',
  '예시 입력': 'sampleInput',
  '화면에 나와야 할 결과': 'outputs',
  '결과': 'outputs',
  '완료 기준': 'successCriteria',
};

function clean(value, max = 1200) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function compact(value, max = 1200) {
  return clean(value, max).replace(/\s+/g, ' ');
}

export function emptyProjectState() {
  return {
    projectName: '', oneLine: '', problem: '', currentSituation: '', currentMethod: '', painPoint: '',
    primaryUser: '', useSituation: '', solution: '', coreValue: '', userFlow: [], screens: [],
    mustFeatures: [], inputs: [], process: [], outputs: [], storedData: [], exceptions: [],
    constraints: ['강의 시간 안에 완성 가능한 범위로 제한', '유료 AI API와 서버 생성 API를 사용하지 않음'],
    excluded: ['로그인·회원가입', '결제', '유료 AI API 및 사용량 기반 외부 서비스', '관리자 시스템'],
    successCriteria: [], sampleInput: '', sampleOutput: '', assumptions: [], unknowns: [],
  };
}

export function getQuestion(stage, startMode = 'idea') {
  const item = QUESTIONS[stage] || QUESTIONS.problem;
  const prompt = stage === 'problem' ? item[startMode === 'unsure' ? 'unsure' : 'idea'] : item.prompt;
  return {
    prompt,
    quickReplies: [{ label: '답변 틀 넣기', value: item.template }],
  };
}

export function parseLabeledFields(answer) {
  const fields = {};
  let activeKey = '';
  clean(answer).split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const match = line.match(/^([^:：]{1,30})\s*[:：]\s*(.*)$/);
    if (match) {
      const key = FIELD_ALIASES[match[1].trim()];
      if (key) {
        activeKey = key;
        fields[key] = compact(match[2]);
        return;
      }
    }
    if (activeKey) fields[activeKey] = compact((fields[activeKey] ? fields[activeKey] + ' ' : '') + line);
  });
  return fields;
}

export function splitItems(value, maxItems = 3) {
  const text = clean(value).replace(/^[^:：\n]{1,30}\s*[:：]\s*/, '');
  if (!text) return [];
  const arrowItems = text.split(/\s*(?:→|⇒|➜|\n|;)\s*/).map((item) => compact(item)).filter(Boolean);
  const items = arrowItems.length > 1
    ? arrowItems
    : text.split(/\s*(?:\/|·|,)\s*|(?:^|\s)\d+[.)]\s*/).map((item) => compact(item)).filter(Boolean);
  return items.slice(0, maxItems);
}

function cloneState(state) {
  const base = emptyProjectState();
  const next = Object.assign(base, state || {});
  Object.keys(next).forEach((key) => {
    if (Array.isArray(next[key])) next[key] = next[key].slice();
  });
  return next;
}

export function applyLocalAnswer(state, stage, rawAnswer) {
  const answer = clean(rawAnswer);
  if (answer.length < 2) throw new Error('답변을 두 글자 이상 입력해 주세요.');
  const fields = parseLabeledFields(answer);
  const next = cloneState(state);

  if (stage === 'problem') {
    next.currentSituation = fields.currentSituation || next.currentSituation;
    next.currentMethod = fields.currentMethod || next.currentMethod;
    next.painPoint = fields.painPoint || next.painPoint || compact(answer);
    next.problem = fields.problem || fields.painPoint || next.problem || compact(answer);
  } else if (stage === 'user') {
    next.primaryUser = fields.primaryUser || next.primaryUser || compact(answer);
    next.useSituation = fields.useSituation || next.useSituation || compact(answer);
  } else if (stage === 'solution') {
    next.projectName = fields.projectName || next.projectName;
    next.solution = fields.solution || next.solution || compact(answer);
    next.oneLine = next.solution;
    next.coreValue = fields.coreValue || next.coreValue;
  } else if (stage === 'flow') {
    next.userFlow = splitItems(fields.userFlow || answer, 6);
    next.process = next.userFlow.slice();
  } else if (stage === 'features') {
    next.screens = splitItems(fields.screens || '', 3);
    if (!next.screens.length) next.screens = ['핵심 기능을 사용하는 단일 화면'];
    next.mustFeatures = splitItems(fields.mustFeatures || answer, 3);
  } else if (stage === 'test') {
    next.sampleInput = fields.sampleInput || next.sampleInput;
    next.outputs = splitItems(fields.outputs || '', 5);
    next.sampleOutput = fields.outputs || next.sampleOutput;
    next.successCriteria = splitItems(fields.successCriteria || answer, 5);
  }

  return next;
}

export function nextStage(stage) {
  const index = STAGES.indexOf(stage);
  return index < 0 || index >= STAGES.length - 1 ? 'complete' : STAGES[index + 1];
}

export function localCoachResponse(completedStage, next) {
  const labels = {
    problem: '문제와 현재 상황', user: '사용자와 사용 시점', solution: '해결 방식',
    flow: '사용 순서', features: '화면과 핵심 기능', test: '완료 기준',
  };
  if (next === 'complete') return '핵심 내용을 모두 반영했습니다. 업무지시서를 확인하고 내려받으세요.';
  return '좋아요. ' + labels[completedStage] + '을(를) 그대로 반영했습니다.\n\n' + getQuestion(next).prompt;
}

function list(values, emptyText = '확인되지 않음') {
  return Array.isArray(values) && values.length
    ? values.map((item) => '- ' + compact(item, 500)).join('\n')
    : '- ' + emptyText;
}

function numbered(values) {
  return Array.isArray(values) && values.length
    ? values.map((item, index) => String(index + 1) + '. ' + compact(item, 500)).join('\n')
    : '1. 확인되지 않음';
}

function value(text) {
  return compact(text, 2000) || '확인되지 않음';
}

export function buildProjectInstructionMarkdown(stateValue) {
  const state = cloneState(stateValue);
  const checks = state.successCriteria.length
    ? state.successCriteria.map((item) => '- [ ] ' + compact(item, 500)).join('\n')
    : '- [ ] 핵심 사용자 흐름을 처음부터 끝까지 실행할 수 있다.';
  return '# PROJECT_INSTRUCTION.md\n\n' +
    '> 이 문서는 강의 시간 안에 작동하는 첫 MVP를 만들기 위한 업무지시서입니다.\n' +
    '> 사용자가 입력한 내용만 구조화했으며, 확인되지 않은 내용은 임의로 확정하지 않습니다.\n\n' +
    '## 0. 작업 원칙\n\n' +
    '- 프로젝트명: ' + value(state.projectName || '나의 첫 MVP') + '\n' +
    '- 목표: 핵심 문제 1개를 해결하는 작동 가능한 웹 MVP\n' +
    '- 범위: 화면 최대 3개, MUST 기능 최대 3개\n' +
    '- 구현 우선순위: 예쁜 장식보다 핵심 흐름의 작동\n' +
    '- 비용 원칙: 유료 AI API와 서버 생성 API를 사용하지 않는다.\n' +
    '- 데이터 원칙: 개인정보·기관 내부 비밀을 받지 않으며 브라우저 안에서 처리한다.\n\n' +
    '## 1. 프로젝트 개요\n\n' +
    '- 한 줄 설명: ' + value(state.oneLine || state.solution) + '\n' +
    '- 해결할 문제: ' + value(state.problem) + '\n' +
    '- 핵심 가치: ' + value(state.coreValue) + '\n\n' +
    '## 2. 문제와 사용 상황\n\n' +
    '- 현재 상황: ' + value(state.currentSituation) + '\n' +
    '- 현재 해결 방식: ' + value(state.currentMethod) + '\n' +
    '- 가장 큰 불편: ' + value(state.painPoint) + '\n\n' +
    '## 3. 주요 사용자\n\n' +
    '- 주요 사용자: ' + value(state.primaryUser) + '\n' +
    '- 사용하는 상황: ' + value(state.useSituation) + '\n\n' +
    '## 4. 해결 방식\n\n' + value(state.solution) + '\n\n' +
    '## 5. 핵심 사용자 흐름\n\n' + numbered(state.userFlow) + '\n\n' +
    '## 6. 화면 구성 — 최대 3개\n\n' + numbered(state.screens) + '\n\n' +
    '## 7. MUST 기능 — 최대 3개\n\n' + list(state.mustFeatures) + '\n\n' +
    '## 8. 입력 → 처리 → 결과\n\n### 입력\n' + list(state.inputs) + '\n\n### 처리\n' + numbered(state.process) + '\n\n### 결과\n' + list(state.outputs) + '\n\n' +
    '### 예시 입력\n' + value(state.sampleInput) + '\n\n### 예시 결과\n' + value(state.sampleOutput) + '\n\n' +
    '## 9. 데이터와 예외 처리\n\n### 저장할 데이터\n' + list(state.storedData, '별도 저장 없음') + '\n\n### 예외 상황\n' + list(state.exceptions) + '\n\n' +
    '## 10. 제약조건과 이번에 하지 않을 것\n\n### 제약조건\n' + list(state.constraints) + '\n\n### 이번 MVP에서 제외\n' + list(state.excluded) + '\n\n' +
    '## 11. 완료 조건\n\n아래 항목을 직접 실행해 모두 확인해야 완료입니다.\n\n' + checks + '\n' +
    '- [ ] 빈 입력이나 잘못된 입력에서 사용자가 이해할 수 있는 안내가 보인다.\n' +
    '- [ ] 모바일 화면에서도 가로 스크롤 없이 핵심 기능을 사용할 수 있다.\n' +
    '- [ ] 브라우저 콘솔에 치명적인 오류가 없다.\n\n' +
    '## 12. 확인이 필요한 내용\n\n### 가정\n' + list(state.assumptions) + '\n\n### 아직 확인되지 않은 것\n' + list(state.unknowns) + '\n\n' +
    '## 13. 구현 순서\n\n1. 핵심 사용자 흐름이 보이는 최소 화면을 만든다.\n2. MUST 기능을 하나씩 연결한다.\n3. 예시 입력으로 예시 결과가 나오는지 확인한다.\n4. 예외 상황과 모바일 화면을 확인한다.\n5. 완료 조건을 모두 점검한다.\n\n' +
    '## 14. Antigravity 실행 지시\n\n이 문서를 프로젝트의 기준 문서로 사용하세요. 먼저 전체 요구사항을 읽고, 구현 전에 만들 파일과 순서를 짧게 제시하세요. 유료 API나 사용량 기반 외부 서비스를 추가하지 말고 브라우저 기능·고정 예시 데이터·단순 규칙으로 대체하세요. 확인되지 않은 내용을 사업 사실처럼 만들지 말고 질문 또는 TODO로 남기세요. 구현 후 완료 조건을 직접 점검하고 실패한 항목이 있으면 원인과 수정 결과를 함께 보고하세요.\n';
}
