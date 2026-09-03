import {
  STAGES,
  applyLocalAnswer,
  buildProjectInstructionMarkdown,
  emptyProjectState,
  getQuestion,
  localCoachResponse,
  nextStage,
} from './local-engine.js';

(function () {
  'use strict';

  var STORAGE_KEY = 'bcc-project-instruction-classroom-v3-plain';
  var ENGINE = 'local-rules-v1';

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
    resetButton: document.getElementById('reset-button'),
  };

  function newSession() {
    return {
      engine: ENGINE,
      startMode: '',
      stage: 'problem',
      state: emptyProjectState(),
      messages: [],
      ready: false,
      markdown: '',
    };
  }

  var session = newSession();

  function wait(milliseconds) {
    return new Promise(function (resolve) { window.setTimeout(resolve, milliseconds); });
  }

  function track(name, params) {
    try {
      var detail = Object.assign({ engine: ENGINE }, params || {});
      if (typeof window.gtag === 'function') window.gtag('event', name, detail);
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event: name }, detail));
    } catch (error) { /* analytics must never block the classroom */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch (error) { /* local storage may be disabled */ }
  }

  function load() {
    try {
      var value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!value || value.engine !== ENGINE || !value.startMode || !Array.isArray(value.messages)) return false;
      session = Object.assign(newSession(), value, {
        state: Object.assign(emptyProjectState(), value.state || {}),
      });
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
      primaryUser: briefValue(session.state.primaryUser, '아직 정하지 않음'),
      solution: briefValue(session.state.solution, '아직 정하지 않음'),
      mustFeatures: briefValue(session.state.mustFeatures, '아직 정하지 않음'),
    };
    Object.keys(values).forEach(function (key) {
      var target = document.querySelector('[data-brief="' + key + '"]');
      if (target) target.textContent = values[key];
    });
  }

  function renderQuickReplies(items) {
    elements.quickReplies.replaceChildren();
    (items || []).slice(0, 3).forEach(function (item) {
      var button = document.createElement('button');
      var option = typeof item === 'string' ? { label: item, value: item } : item;
      button.type = 'button';
      button.textContent = option.label;
      button.addEventListener('click', function () {
        elements.answerInput.value = option.value;
        elements.answerCount.textContent = String(option.value.length);
        elements.answerInput.focus();
      });
      elements.quickReplies.appendChild(button);
    });
  }

  function renderResult() {
    if (!session.ready) {
      elements.resultSection.hidden = true;
      return;
    }
    if (!session.markdown) session.markdown = buildProjectInstructionMarkdown(session.state);
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
    renderQuickReplies(session.ready ? [] : getQuestion(session.stage, session.startMode).quickReplies);
  }

  async function start(mode) {
    session = newSession();
    session.startMode = mode;
    elements.workspace.hidden = false;
    elements.resultSection.hidden = true;
    elements.messages.replaceChildren();
    renderProgress();
    renderBrief();
    track('project_instruction_start', { start_mode: mode });
    showTyping();
    await wait(260);
    hideTyping();
    var firstQuestion = getQuestion('problem', mode);
    addMessage(firstQuestion.prompt, 'assistant');
    renderQuickReplies(firstQuestion.quickReplies);
    save();
    elements.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(function () { elements.answerInput.focus(); }, 350);
  }

  async function submitAnswer(answer) {
    var completedStage = session.stage;
    addMessage(answer, 'user');
    renderQuickReplies([]);
    track('project_instruction_answer', { stage: completedStage });
    elements.composer.querySelector('button[type="submit"]').disabled = true;
    showTyping();
    await wait(280);

    try {
      session.state = applyLocalAnswer(session.state, completedStage, answer);
      session.stage = nextStage(completedStage);
      session.ready = session.stage === 'complete';
      session.markdown = session.ready ? buildProjectInstructionMarkdown(session.state) : '';
      hideTyping();
      addMessage(localCoachResponse(completedStage, session.stage), 'assistant');
      if (!session.ready) renderQuickReplies(getQuestion(session.stage, session.startMode).quickReplies);
      renderProgress();
      renderBrief();
      renderResult();
      if (session.ready) track('project_instruction_ready');
      save();
    } catch (error) {
      hideTyping();
      addMessage(error.message || '답변을 확인해 주세요.', 'assistant');
    }
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
    session = newSession();
    elements.workspace.hidden = true;
    elements.resultSection.hidden = true;
    elements.messages.replaceChildren();
    elements.answerInput.value = '';
    elements.answerCount.textContent = '0';
    renderQuickReplies([]);
    track('project_instruction_reset');
    elements.startSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  elements.downloadButton.addEventListener('click', function () {
    var blob = new Blob([session.markdown || buildProjectInstructionMarkdown(session.state)], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '홈페이지_만들기_설명서.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    track('project_instruction_download');
  });

  elements.copyButton.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(session.markdown || buildProjectInstructionMarkdown(session.state));
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
