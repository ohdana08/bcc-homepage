export const STAGES = ['problem', 'user', 'solution', 'flow', 'features', 'test'];

const QUESTIONS = {
  problem: {
    idea: '좋아요. 요즘 일하면서 반복해서 불편하거나 시간이 아깝다고 느끼는 일을 적어주세요.',
    unsure: '아직 만들고 싶은 것이 없어도 괜찮습니다. 요즘 일하면서 반복해서 불편하거나 시간이 아깝다고 느끼는 일을 적어주세요.',
    template: '어떤 일을 하나요:\n지금은 어떻게 하나요:\n무엇이 가장 불편한가요:',
  },
  user: {
    prompt: '누가 이 홈페이지를 쓰면 좋을까요? 언제 쓰는지도 함께 적어주세요.',
    template: '누가 쓰나요:\n언제 쓰나요:',
  },
  solution: {
    prompt: '이 홈페이지가 무엇을 해주면 좋을까요? 아직 정하지 못한 것은 비워도 됩니다.',
    template: '만들 것의 이름:\n이렇게 도와주면 좋아요:\n가장 좋아져야 하는 점:',
  },
  flow: {
    prompt: '처음 들어온 사람이 결과를 보기까지 무엇을 하는지 순서대로 적어주세요.',
    template: '쓰는 순서: 내용을 적는다 → 버튼을 누른다 → 결과를 본다',
  },
  features: {
    prompt: '한 화면에 무엇이 보이고, 꼭 어떤 동작이 되어야 하나요? 세 가지 안으로 적어주세요.',
    template: '보일 화면: 한 화면\n꼭 필요한 동작: 내용 적기 / 결과 보기 / 결과 복사',
  },
  test: {
    prompt: '마지막으로 무엇을 넣어보고, 무엇이 보이면 잘 만들어졌다고 할 수 있을까요?',
    template: '넣어볼 내용:\n나와야 할 결과:\n잘 만들어졌다고 보는 기준:',
  },
};

const FIELD_ALIASES = {
  '어떤 일을 하나요': 'currentSituation',
  '현재 하는 일': 'currentSituation',
  '현재 상황': 'currentSituation',
  '지금은 어떻게 하나요': 'currentMethod',
  '현재 방법': 'currentMethod',
  '현재 해결 방식': 'currentMethod',
  '무엇이 가장 불편한가요': 'painPoint',
  '가장 큰 불편': 'painPoint',
  '문제': 'problem',
  '누가 쓰나요': 'primaryUser',
  '주요 사용자': 'primaryUser',
  '사용자': 'primaryUser',
  '언제 쓰나요': 'useSituation',
  '사용하는 때': 'useSituation',
  '사용 상황': 'useSituation',
  '만들 것의 이름': 'projectName',
  '프로젝트명': 'projectName',
  '이렇게 도와주면 좋아요': 'solution',
  '해결 방식': 'solution',
  '가장 좋아져야 하는 점': 'coreValue',
  '가장 중요한 가치': 'coreValue',
  '핵심 가치': 'coreValue',
  '쓰는 순서': 'userFlow',
  '사용 순서': 'userFlow',
  '보일 화면': 'screens',
  '화면': 'screens',
  '화면 구성': 'screens',
  '꼭 필요한 동작': 'mustFeatures',
  '핵심 기능': 'mustFeatures',
  '기능': 'mustFeatures',
  '넣어볼 내용': 'sampleInput',
  '예시 입력': 'sampleInput',
  '나와야 할 결과': 'outputs',
  '화면에 나와야 할 결과': 'outputs',
  '결과': 'outputs',
  '잘 만들어졌다고 보는 기준': 'successCriteria',
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
    constraints: ['강의 시간 안에 만들 수 있는 크기로 제한'],
    excluded: ['로그인과 회원가입', '결제', '복잡한 외부 서비스 연결', '관리자용 화면'],
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
    if (!next.screens.length) next.screens = ['꼭 필요한 동작을 쓰는 한 화면'];
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
    problem: '불편한 점과 지금 하는 방법', user: '누가 언제 쓰는지', solution: '어떻게 도와줄지',
    flow: '쓰는 순서', features: '화면과 꼭 필요한 동작', test: '잘 만들어졌는지 보는 기준',
  };
  if (next === 'complete') return '적어주신 내용을 모두 정리했습니다. 아래에서 설명서를 확인하고 파일로 받으세요.';
  return '좋아요. ' + labels[completedStage] + ' 내용을 반영했습니다.\n\n' + getQuestion(next).prompt;
}

function list(values, emptyText = '아직 정하지 않음') {
  return Array.isArray(values) && values.length
    ? values.map((item) => '- ' + compact(item, 500)).join('\n')
    : '- ' + emptyText;
}

function numbered(values) {
  return Array.isArray(values) && values.length
    ? values.map((item, index) => String(index + 1) + '. ' + compact(item, 500)).join('\n')
    : '1. 아직 정하지 않음';
}

function value(text) {
  return compact(text, 2000) || '아직 정하지 않음';
}

export function buildProjectInstructionMarkdown(stateValue) {
  const state = cloneState(stateValue);
  const checks = state.successCriteria.length
    ? state.successCriteria.map((item) => '- [ ] ' + compact(item, 500)).join('\n')
    : '- [ ] 처음부터 끝까지 눌러보며 원하는 결과를 확인할 수 있다.';
  return '# 홈페이지 만들기 설명서\n\n' +
    '> 이 파일은 Antigravity에게 홈페이지를 만들어 달라고 할 때 함께 넣는 설명서입니다.\n' +
    '> 적어주신 내용만 정리했으며, 아직 정하지 않은 것은 마음대로 채우지 않았습니다.\n\n' +
    '## 0. 먼저 지킬 것\n\n' +
    '- 만들 것의 이름: ' + value(state.projectName || '나의 첫 홈페이지') + '\n' +
    '- 목표: 불편 한 가지를 줄이는 간단한 홈페이지\n' +
    '- 크기: 화면 3개 안, 꼭 필요한 동작 3개 안\n' +
    '- 순서: 꾸미기보다 먼저 실제로 눌러보고 작동하게 만들기\n' +
    '- 개인정보나 기관 내부 비밀을 입력받지 않기\n\n' +
    '## 1. 무엇을 만들까요?\n\n' +
    '- 한 줄 설명: ' + value(state.oneLine || state.solution) + '\n' +
    '- 바꾸고 싶은 불편: ' + value(state.problem) + '\n' +
    '- 가장 좋아져야 하는 점: ' + value(state.coreValue) + '\n\n' +
    '## 2. 지금은 어떻게 하고 있나요?\n\n' +
    '- 어떤 일을 하나요: ' + value(state.currentSituation) + '\n' +
    '- 지금 하는 방법: ' + value(state.currentMethod) + '\n' +
    '- 무엇이 가장 불편한가요: ' + value(state.painPoint) + '\n\n' +
    '## 3. 누가 언제 쓰나요?\n\n' +
    '- 누가 쓰나요: ' + value(state.primaryUser) + '\n' +
    '- 언제 쓰나요: ' + value(state.useSituation) + '\n\n' +
    '## 4. 어떻게 도와주나요?\n\n' + value(state.solution) + '\n\n' +
    '## 5. 사용하는 순서\n\n' + numbered(state.userFlow) + '\n\n' +
    '## 6. 필요한 화면 — 3개 안\n\n' + numbered(state.screens) + '\n\n' +
    '## 7. 꼭 필요한 동작 — 3개 안\n\n' + list(state.mustFeatures) + '\n\n' +
    '## 8. 무엇을 넣고 무엇이 나오나요?\n\n### 사람이 넣는 내용\n' + value(state.sampleInput) + '\n\n### 홈페이지가 하는 일\n' + numbered(state.process) + '\n\n### 보여줄 결과\n' + list(state.outputs) + '\n\n' +
    '### 넣어볼 내용\n' + value(state.sampleInput) + '\n\n### 나와야 할 결과\n' + value(state.sampleOutput) + '\n\n' +
    '## 9. 저장할 내용과 잘못 입력했을 때\n\n### 저장할 내용\n' + list(state.storedData, '따로 저장하지 않음') + '\n\n### 잘못 입력했을 때 보여줄 안내\n' + list(state.exceptions) + '\n\n' +
    '## 10. 이번에는 넣지 않을 것\n\n' + list(state.excluded) + '\n\n' +
    '## 11. 다 만들었는지 확인하기\n\n아래 항목을 직접 눌러보며 확인합니다.\n\n' + checks + '\n' +
    '- [ ] 아무것도 적지 않거나 잘못 적었을 때 이해하기 쉬운 안내가 보인다.\n' +
    '- [ ] 휴대폰에서도 글과 버튼이 화면 밖으로 잘리지 않는다.\n' +
    '- [ ] 화면이 멈추거나 깨지지 않는다.\n\n' +
    '## 12. 아직 정하지 못한 것\n\n' + list(state.unknowns) + '\n\n' +
    '## 13. 만드는 순서\n\n1. 처음부터 끝까지 쓰는 순서가 보이도록 가장 단순한 화면을 만든다.\n2. 꼭 필요한 동작을 하나씩 연결한다.\n3. 넣어볼 내용으로 원하는 결과가 나오는지 확인한다.\n4. 잘못 입력했을 때와 휴대폰 화면을 확인한다.\n5. 11번 항목을 모두 점검한다.\n\n' +
    '## 14. Antigravity에게 부탁할 말\n\n이 설명서를 모두 읽고, 무엇을 어떤 순서로 만들지 먼저 쉽게 설명해주세요. 그다음 가장 단순한 모양으로 홈페이지를 만들어주세요. 정하지 않은 내용은 마음대로 만들지 말고 그대로 남겨두거나 질문해주세요. 만든 뒤 11번 항목을 직접 확인해주세요.\n';
}
