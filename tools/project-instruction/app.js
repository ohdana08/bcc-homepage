(function () {
  'use strict';

  var STORAGE_KEY = 'bcc-project-instruction-classroom-v1';
  var API_URL = '/api/project-instruction';
  var STAGES = ['problem', 'user', 'solution', 'flow', 'features', 'test'];
  var FALLBACK_QUESTIONS = {
    problem: '누가, 어떤 상황에서 겪는 문제를 해결하고 싶나요?',
    user: '이 결과물을 가장 먼저 사용할 사람은 누구인가요? 언제 사용하나요?',
    solution: '그 문제를 이 도구가 어떤 방식으로 해결하면 좋을까요?',
    flow: '사용자가 처음 들어와 결과를 얻기까지 순서대로 말해주세요.',
    features: '그 흐름에 꼭 필요한 화면과 기능을 3개 이내로 골라주세요.',
    test: '완성됐다고 판단하려면 화면에서 무엇이 작동해야 하나요?'
  };

  var elements = {
    startSection: document.getElementById('start-section'),
    workspace: document.getElementById('workspace'),
    resultSection: document.getElementById('result-section'),
    messages: document.getElementById('messages'),
    quickReplies: document.getElementById('quick-replies'),
    composer: document.getElementById('composer'),
    answerInput: document.getElementById('answer-input'),
    answerCount: document.getElementById('answer-count'),
    progressValue: document.getElementById('progress-value'),
    progressBar: document.getElementById('progress-bar'),
    progressSteps: document.getElementById('progress-steps'),
    markdownPreview: document.getElementById('markdown-preview'),
    downloadButton: document.getElementById('download-button'),
    copyButton: document.getElementById('copy-button'),
    resetButton: document.getElementById('reset-button')
  };

  function emptyState() {
    return {
      projectName: '', oneLine: '', problem: '', currentSituation: '', currentMethod: '', painPoint: '',
      primaryUser: '', useSituation: '', solution: '', coreValue: '', userFlow: [], screens: [],
      mustFeatures: [], inputs: [], process: [], outputs: [], storedData: [], exceptions: [],
      constraints: [], excluded: [], successCriteria: [], sampleInput: '', sampleOutput: '',
      assumptions: [], unknowns: []
    };
  }

  var session = {
    startMode: '', stage: 'problem', sessionToken: '', state: emptyState(),
    messages: [], ready: false, markdown: '', fallback: false
  };

  function track(name, params) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, params || {});
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event: name }, params || {}));
    } catch (error) { /* analytics must never block the classroom */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (error) { /* local storage may be disabled */ }
  }

  function load() {
    try {
      var value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!value || !value.startMode || !Array.isArray(value.messages)) return false;
      session = Object.assign(session, value, { state: Object.assign(emptyState(), value.state || {}) });
      return true;
    } catch (error) { return false; }
  }

  function addMessage(text, role, skipSave) {
    var safeText = String(text || '').trim();
    if (!safeText) return;
    session.messages.push({ text: safeText, role: role });
    renderMessage({ text: safeText, role: role });
    if (!skipSave) save();
  }

  function renderMessage(message) {
    var bubble = document.createElement('div');
    bubble.className = 'message' + (message.role === 'user' ? ' is-user' : '');
    bubble.textContent = message.text;
    elements.messages.appendChild(bubble);
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function showTyping() {
    var bubble = document.createElement('div');
    bubble.className = 'message';
    bubble.id = 'typing-message';
    bubble.innerHTML = '<span class="typing" aria-label="답변 정리 중"><i></i><i></i><i></i></span>';
    elements.messages.appendChild(bubble);
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }

  function hideTyping() {
    var typing = document.getElementById('typing-message');
    if (typing) typing.remove();
  }

  function stageIndex() {
    var index = STAGES.indexOf(session.stage);
    return index < 0 ? STAGES.length - 1 : index;
  }

  function renderProgress() {
    var current = stageIndex();
    elements.progressValue.textContent = session.ready ? '6 / 6' : String(current + 1) + ' / 6';
    elements.progressBar.style.width = String(session.ready ? 100 : ((current + 1) / 6) * 100) + '%';
    Array.prototype.forEach.call(elements.progressSteps.children, function (item, index) {
      item.classList.toggle('is-current', !session.ready && index === current);
      item.classList.toggle('is-complete', session.ready || index < current);
    });
  }

  function briefValue(value, emptyText) {
    if (Array.isArray(value)) return value.length ? value.join(' · ') : emptyText;
    return value || emptyText;
  }

  function renderBrief() {
    var values = {
      problem: briefValue(session.state.problem, '대화를 시작하면 여기에 정리됩니다.'),
      primaryUser: briefValue(session.state.primaryUser, '아직 확인되지 않음'),
      solution: briefValue(session.state.solution, '아직 확인되지 않음'),
      mustFeatures: briefValue(session.state.mustFeatures, '아직 확인되지 않음')
    };
    Object.keys(values).forEach(function (key) {
      var target = document.querySelector('[data-brief="' + key + '"]');
      if (target) target.textContent = values[key];
    });
  }

  function renderQuickReplies(items) {
    elements.quickReplies.replaceChildren();
    (items || []).slice(0, 3).forEach(function (text) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', function () {
        elements.answerInput.value = text;
        elements.answerCount.textContent = String(text.length);
        elements.answerInput.focus();
      });
      elements.quickReplies.appendChild(button);
    });
  }

  function splitItems(answer) {
    return String(answer || '')
      .split(/\n|,|→|\/|\d+[.)]\s*/)
      .map(function (item) { return item.replace(/^[-•]\s*/, '').trim(); })
      .filter(Boolean)
      .slice(0, 3);
  }

  function applyFallbackAnswer(answer) {
    var current = session.stage;
    if (current === 'problem') {
      session.state.problem = answer;
    } else if (current === 'user') {
      session.state.primaryUser = answer;
    } else if (current === 'solution') {
      session.state.solution = answer;
      session.state.oneLine = answer;
    } else if (current === 'flow') {
      session.state.userFlow = splitItems(answer);
      session.state.process = session.state.userFlow.slice();
    } else if (current === 'features') {
      session.state.mustFeatures = splitItems(answer);
      session.state.screens = splitItems(answer).map(function (item) { return item + ' 화면'; });
    } else if (current === 'test') {
      session.state.successCriteria = splitItems(answer);
    }

    var nextIndex = STAGES.indexOf(current) + 1;
    if (nextIndex >= STAGES.length) {
      session.stage = 'complete';
      session.ready = true;
      session.markdown = buildMarkdown(session.state);
      return '핵심 내용을 모두 받았습니다. 업무지시서를 확인하고 내려받으세요.';
    }
    session.stage = STAGES[nextIndex];
    return '좋아요. 지금 답을 지시서에 반영했습니다.\n\n' + FALLBACK_QUESTIONS[session.stage];
  }

  function list(values, emptyText) {
    return Array.isArray(values) && values.length
      ? values.map(function (item) { return '- ' + item; }).join('\n')
      : '- ' + (emptyText || '확인되지 않음');
  }

  function numbered(values) {
    return Array.isArray(values) && values.length
      ? values.map(function (item, index) { return String(index + 1) + '. ' + item; }).join('\n')
      : '1. 확인되지 않음';
  }

  function value(text) { return String(text || '').trim() || '확인되지 않음'; }

  function buildMarkdown(state) {
    var excluded = state.excluded && state.excluded.length
      ? state.excluded
      : ['로그인·회원가입', '결제', '복잡한 외부 API 연동', '관리자 시스템'];
    var checks = state.successCriteria && state.successCriteria.length
      ? state.successCriteria.map(function (item) { return '- [ ] ' + item; }).join('\n')
      : '- [ ] 핵심 사용자 흐름을 처음부터 끝까지 실행할 수 있다.';
    return '# PROJECT_INSTRUCTION.md\n\n' +
      '> 이 문서는 강의 시간 안에 작동하는 첫 MVP를 만들기 위한 업무지시서입니다.\n' +
      '> 확인되지 않은 내용은 임의로 확정하지 말고, 가장 단순한 방식으로 구현한 뒤 질문하세요.\n\n' +
      '## 0. 작업 원칙\n\n' +
      '- 프로젝트명: ' + value(state.projectName || '나의 첫 MVP') + '\n' +
      '- 목표: 핵심 문제 1개를 해결하는 작동 가능한 웹 MVP\n' +
      '- 범위: 화면 최대 3개, MUST 기능 최대 3개\n' +
      '- 구현 우선순위: 예쁜 장식보다 핵심 흐름의 작동\n' +
      '- 데이터 원칙: 개인정보·기관 내부 비밀을 받지 않으며, 저장이 필요하면 브라우저 로컬 저장을 우선\n\n' +
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
      '## 10. 제약조건과 이번에 하지 않을 것\n\n### 제약조건\n' + list(state.constraints, '강의 시간 안에 완성 가능한 범위로 제한') + '\n\n### 이번 MVP에서 제외\n' + list(excluded) + '\n\n' +
      '## 11. 완료 조건\n\n아래 항목을 직접 실행해 모두 확인해야 완료입니다.\n\n' + checks + '\n' +
      '- [ ] 빈 입력이나 잘못된 입력에서 사용자가 이해할 수 있는 안내가 보인다.\n' +
      '- [ ] 모바일 화면에서도 가로 스크롤 없이 핵심 기능을 사용할 수 있다.\n' +
      '- [ ] 브라우저 콘솔에 치명적인 오류가 없다.\n\n' +
      '## 12. 확인이 필요한 내용\n\n### 가정\n' + list(state.assumptions) + '\n\n### 아직 확인되지 않은 것\n' + list(state.unknowns) + '\n\n' +
      '## 13. 구현 순서\n\n1. 핵심 사용자 흐름이 보이는 최소 화면을 만든다.\n2. MUST 기능을 하나씩 연결한다.\n3. 예시 입력으로 예시 결과가 나오는지 확인한다.\n4. 예외 상황과 모바일 화면을 확인한다.\n5. 완료 조건을 모두 점검한다.\n\n' +
      '## 14. Antigravity 실행 지시\n\n이 문서를 프로젝트의 기준 문서로 사용하세요. 먼저 전체 요구사항을 읽고, 구현 전에 만들 파일과 순서를 짧게 제시하세요. 그다음 가장 단순한 구조로 MVP를 구현하세요. 확인되지 않은 내용을 사업 사실처럼 만들지 말고 질문 또는 TODO로 남기세요. 구현 후 완료 조건을 직접 점검하고, 실패한 항목이 있으면 원인과 수정 결과를 함께 보고하세요.\n';
  }

  async function api(payload) {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ engine: 'project_instruction_classroom' }, payload))
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || '잠시 연결이 원활하지 않습니다.');
    return data;
  }

  function renderResult() {
    if (!session.ready) {
      elements.resultSection.hidden = true;
      return;
    }
    if (!session.markdown) session.markdown = buildMarkdown(session.state);
    elements.markdownPreview.textContent = session.markdown;
    elements.resultSection.hidden = false;
    window.setTimeout(function () {
      elements.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }

  function renderAll() {
    elements.workspace.hidden = !session.startMode;
    elements.messages.replaceChildren();
    session.messages.forEach(renderMessage);
    renderProgress();
    renderBrief();
    renderResult();
  }

  async function start(mode) {
    session = {
      startMode: mode, stage: 'problem', sessionToken: '', state: emptyState(),
      messages: [], ready: false, markdown: '', fallback: false
    };
    elements.workspace.hidden = false;
    elements.resultSection.hidden = true;
    elements.messages.replaceChildren();
    renderProgress();
    renderBrief();
    track('project_instruction_start', { start_mode: mode });
    showTyping();
    try {
      var data = await api({ action: 'start', startMode: mode });
      hideTyping();
      session.state = data.state || emptyState();
      session.stage = data.stage || 'problem';
      session.sessionToken = data.sessionToken || '';
      addMessage(data.assistantMessage, 'assistant');
      renderQuickReplies(data.quickReplies);
    } catch (error) {
      hideTyping();
      session.fallback = true;
      addMessage((mode === 'unsure'
        ? '괜찮습니다. 아이디어보다 현장의 불편에서 시작해볼게요. 최근 반복해서 불편하거나 시간이 아까웠던 일은 무엇인가요?'
        : FALLBACK_QUESTIONS.problem) + '\n\n지금은 교실 안전 모드로 진행합니다. 답변은 이 기기에만 저장됩니다.', 'assistant');
    }
    save();
    elements.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(function () { elements.answerInput.focus(); }, 350);
  }

  async function submitAnswer(answer) {
    addMessage(answer, 'user');
    renderQuickReplies([]);
    track('project_instruction_answer', { stage: session.stage, fallback: session.fallback });
    elements.composer.querySelector('button[type="submit"]').disabled = true;
    showTyping();
    var responseText;
    try {
      if (session.fallback || !session.sessionToken) throw new Error('fallback');
      var data = await api({
        action: 'answer', startMode: session.startMode, stage: session.stage,
        sessionToken: session.sessionToken, state: session.state, answer: answer
      });
      session.state = Object.assign(emptyState(), data.state || {});
      session.stage = data.stage || session.stage;
      session.sessionToken = data.sessionToken || session.sessionToken;
      session.ready = Boolean(data.ready);
      session.markdown = data.markdown || '';
      responseText = data.assistantMessage;
      renderQuickReplies(data.quickReplies);
    } catch (error) {
      session.fallback = true;
      responseText = applyFallbackAnswer(answer);
      if (error.message && error.message !== 'fallback') {
        responseText = 'AI 연결이 잠시 원활하지 않아 교실 안전 모드로 이어갑니다. 지금까지 입력한 내용은 사라지지 않습니다.\n\n' + responseText;
      }
    }
    hideTyping();
    addMessage(responseText, 'assistant');
    renderProgress();
    renderBrief();
    renderResult();
    if (session.ready) track('project_instruction_ready', { fallback: session.fallback });
    save();
    elements.composer.querySelector('button[type="submit"]').disabled = false;
  }

  document.querySelectorAll('[data-start-mode]').forEach(function (button) {
    button.addEventListener('click', function () { start(button.dataset.startMode); });
  });

  elements.answerInput.addEventListener('input', function () {
    elements.answerCount.textContent = String(elements.answerInput.value.length);
  });

  elements.answerInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.composer.requestSubmit();
    }
  });

  elements.composer.addEventListener('submit', function (event) {
    event.preventDefault();
    var answer = elements.answerInput.value.trim();
    if (!answer || session.ready) return;
    elements.answerInput.value = '';
    elements.answerCount.textContent = '0';
    submitAnswer(answer);
  });

  elements.resetButton.addEventListener('click', function () {
    if (!window.confirm('지금까지 입력한 내용을 지우고 처음부터 시작할까요?')) return;
    localStorage.removeItem(STORAGE_KEY);
    session = { startMode: '', stage: 'problem', sessionToken: '', state: emptyState(), messages: [], ready: false, markdown: '', fallback: false };
    elements.workspace.hidden = true;
    elements.resultSection.hidden = true;
    elements.messages.replaceChildren();
    track('project_instruction_reset');
    elements.startSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  elements.downloadButton.addEventListener('click', function () {
    var blob = new Blob([session.markdown || buildMarkdown(session.state)], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'PROJECT_INSTRUCTION.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    track('project_instruction_download', { fallback: session.fallback });
  });

  elements.copyButton.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(session.markdown || buildMarkdown(session.state));
      elements.copyButton.textContent = '복사했습니다';
      window.setTimeout(function () { elements.copyButton.textContent = '내용 복사'; }, 1600);
      track('project_instruction_copy');
    } catch (error) {
      elements.copyButton.textContent = '복사하지 못했습니다';
    }
  });

  track('project_instruction_page_view', { page_path: '/tools/project-instruction/' });
  if (load()) renderAll();
})();
