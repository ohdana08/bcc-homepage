import {
  STAGES,
  STAGE_LABELS,
  getStages,
  applyLocalAnswer,
  buildProjectInstructionMarkdown,
  emptyProjectState,
  getQuestion,
  localCoachResponse,
  nextStage,
} from './local-engine.js';

(function () {
  'use strict';

  var STORAGE_KEY = 'bcc-project-instruction-v4-workflows';
  var LEGACY_KEY = 'bcc-project-instruction-classroom-v3-plain';
  var ENGINE = 'local-workflows-v2';
  var busy = false;

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
    previousButton: document.getElementById('previous-button'),
    savedState: document.getElementById('saved-state'),
    legacyNotice: document.getElementById('legacy-notice'),
    legacyDownload: document.getElementById('legacy-download'),
    detailDialog: document.getElementById('detail-dialog'),
    detailClose: document.getElementById('detail-close'),
    detailContinue: document.getElementById('detail-continue'),
    detailSymbol: document.getElementById('detail-symbol'),
    detailTitle: document.getElementById('detail-title'),
    detailDescription: document.getElementById('detail-description'),
    detailBenefits: document.getElementById('detail-benefits'),
    detailOutcomeTitle: document.getElementById('detail-outcome-title'),
    detailOutcomeCopy: document.getElementById('detail-outcome-copy'),
    detailStartLink: document.getElementById('detail-start-link'),
  };

  var detailContent = {
    material: {
      symbol: '＋',
      title: '사진이나 문서를 활용하고 싶으세요?',
      description: '이 화면에서는 파일을 올리거나 읽지 않습니다. 자료를 함께 활용하는 방법은 BCC에 문의할 수 있어요.',
      benefits: [
        '지금은 자료에서 필요한 내용을 직접 답변에 적을 수 있어요.',
        '업무지시서를 받은 뒤 사용하는 AI 도구에 자료를 함께 전달할 수 있어요.',
        '자료 활용에 도움이 필요하면 이용 방법을 문의하세요.',
      ],
      outcomeTitle: '지금까지 적은 답변은 유지됩니다',
      outcomeCopy: '문의 버튼을 눌러도 답변이나 파일이 자동으로 전송되지 않습니다.',
    },
    link: {
      symbol: '↗',
      title: '참고할 링크가 있으세요?',
      description: '답변에 링크와 참고하고 싶은 부분을 함께 적어주세요. 이 화면에서는 링크를 열거나 내용을 자동 분석하지 않습니다.',
      benefits: [
        '어느 부분을 참고할지 내 말로 설명해요.',
        '원하는 구성과 바꾸고 싶은 점을 함께 남겨요.',
        '완성된 업무지시서와 링크를 사용하는 AI 도구에 전달해요.',
      ],
      outcomeTitle: '참고자료 활용이 어렵다면',
      outcomeCopy: 'BCC에 이용 방법을 문의할 수 있어요. 링크나 답변은 자동으로 전송되지 않습니다.',
    },
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
      history: [],
      draft: '',
      draftsByStage: {},
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      elements.savedState.textContent = '이 기기에 저장';
    } catch (error) {
      elements.savedState.textContent = '이번 화면에서만 유지';
    }
  }

  function load() {
    try {
      var value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!value || value.engine !== ENGINE || !['idea', 'unsure'].includes(value.startMode) || !Array.isArray(value.messages) || !Array.isArray(value.history)) return false;
      if (!STAGES.includes(value.stage) && value.stage !== 'complete') return false;
      session = Object.assign(newSession(), value, {
        state: Object.assign(emptyProjectState(), value.state || {}),
      });
      session.ready = session.stage === 'complete';
      session.draft = typeof session.draft === 'string' ? session.draft : '';
      session.draftsByStage = session.draftsByStage && typeof session.draftsByStage === 'object' && !Array.isArray(session.draftsByStage) ? session.draftsByStage : {};
      session.markdown = session.ready ? buildProjectInstructionMarkdown(session.state) : '';
      if (!session.ready && !getStages(session.state).includes(session.stage)) return false;
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

  function renderProgress() {
    var stages = getStages(session.state);
    var current = stages.indexOf(session.stage);
    var count = session.ready ? stages.length : Math.max(0, current) + 1;
    elements.progressValue.textContent = session.ready ? '정리 완료' : String(count) + ' / ' + stages.length;
    elements.progressBar.style.width = String(session.ready ? 100 : (count / stages.length) * 100) + '%';
    elements.progressSteps.replaceChildren();
    stages.forEach(function (stage, index) {
      var item = document.createElement('li');
      var number = document.createElement('span');
      number.textContent = String(index + 1).padStart(2, '0');
      item.append(number, document.createTextNode(STAGE_LABELS[stage] || stage));
      item.classList.toggle('is-current', !session.ready && index === current);
      item.classList.toggle('is-complete', session.ready || index < current);
      if (!session.ready && index === current) item.setAttribute('aria-current', 'step');
      elements.progressSteps.appendChild(item);
    });
    elements.previousButton.disabled = busy || !session.history.length;
    elements.answerInput.disabled = busy || session.ready;
    elements.composer.querySelector('button[type="submit"]').disabled = busy || session.ready;
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
    (items || []).forEach(function (item) {
      var button = document.createElement('button');
      var option = typeof item === 'string' ? { label: item, value: item } : item;
      button.type = 'button';
      button.textContent = option.label;
      button.addEventListener('click', function () {
        if (busy || session.ready) return;
        elements.answerInput.value = option.value;
        session.draft = option.value;
        session.draftsByStage[session.stage] = option.value;
        save();
        elements.answerCount.textContent = String(option.value.length);
        elements.answerInput.focus();
      });
      elements.quickReplies.appendChild(button);
    });
  }

  function openDetailDialog(kind) {
    var selectedKind = kind === 'link' ? 'link' : 'material';
    var content = detailContent[selectedKind];
    elements.detailSymbol.textContent = content.symbol;
    elements.detailTitle.textContent = content.title;
    elements.detailDescription.textContent = content.description;
    elements.detailBenefits.replaceChildren();
    content.benefits.forEach(function (text) {
      var item = document.createElement('li');
      item.textContent = text;
      elements.detailBenefits.appendChild(item);
    });
    elements.detailOutcomeTitle.textContent = content.outcomeTitle;
    elements.detailOutcomeCopy.textContent = content.outcomeCopy;
    elements.detailStartLink.dataset.entryKind = selectedKind;
    track('project_instruction_detail_open', { entry_kind: selectedKind });
    if (typeof elements.detailDialog.showModal === 'function') elements.detailDialog.showModal();
    else elements.detailDialog.setAttribute('open', '');
  }

  function closeDetailDialog() {
    if (typeof elements.detailDialog.close === 'function') elements.detailDialog.close();
    else elements.detailDialog.removeAttribute('open');
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
    elements.startSection.hidden = !!session.startMode;
    elements.workspace.hidden = !session.startMode;
    elements.messages.replaceChildren();
    session.messages.forEach(renderMessage);
    elements.answerInput.value = session.draft;
    elements.answerCount.textContent = String(session.draft.length);
    renderProgress();
    renderBrief();
    renderResult();
    renderQuickReplies(session.ready ? [] : getQuestion(session.stage, session.startMode, session.state).quickReplies);
  }

  async function start(mode) {
    if (busy) return;
    busy = true;
    session = newSession();
    session.startMode = mode;
    elements.answerInput.value = '';
    elements.answerCount.textContent = '0';
    elements.workspace.hidden = false;
    elements.startSection.hidden = true;
    elements.resultSection.hidden = true;
    elements.messages.replaceChildren();
    renderProgress();
    renderBrief();
    track('project_instruction_start', { start_mode: mode });
    showTyping();
    await wait(260);
    hideTyping();
    var firstQuestion = getQuestion('problem', mode, session.state);
    addMessage(firstQuestion.prompt, 'assistant');
    renderQuickReplies(firstQuestion.quickReplies);
    save();
    busy = false;
    renderProgress();
    elements.workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(function () { elements.answerInput.focus(); }, 350);
  }

  async function submitAnswer(answer) {
    if (busy || session.ready) return;
    busy = true;
    var previousState = structuredClone(session.state);
    var previousLength = session.messages.length;
    var completedStage = session.stage;
    // Keep the saved question and draft intact until the answer is processed.
    addMessage(answer, 'user', true);
    renderQuickReplies([]);
    track('project_instruction_answer', { stage: completedStage });
    renderProgress();
    showTyping();
    await wait(280);

    try {
      session.state = applyLocalAnswer(session.state, completedStage, answer);
      session.history.push({ stage: completedStage, state: previousState, answer: answer, messagesLength: previousLength });
      session.draftsByStage[completedStage] = answer;
      session.stage = nextStage(completedStage, session.state);
      session.ready = session.stage === 'complete';
      session.markdown = session.ready ? buildProjectInstructionMarkdown(session.state) : '';
      session.draft = session.ready ? '' : (session.draftsByStage[session.stage] || '');
      elements.answerInput.value = session.draft;
      elements.answerCount.textContent = String(session.draft.length);
      hideTyping();
      addMessage(localCoachResponse(completedStage, session.stage, session.state, session.startMode), 'assistant');
      if (!session.ready) renderQuickReplies(getQuestion(session.stage, session.startMode, session.state).quickReplies);
      renderProgress();
      renderBrief();
      renderResult();
      if (session.ready) track('project_instruction_ready');
      save();
    } catch (error) {
      hideTyping();
      session.state = previousState;
      session.stage = completedStage;
      session.ready = false;
      session.markdown = '';
      session.messages = session.messages.slice(0, previousLength);
      if (session.history.length && session.history[session.history.length - 1].stage === completedStage) session.history.pop();
      session.draft = answer;
      session.draftsByStage[completedStage] = answer;
      renderAll();
      addMessage(error.message || '답변을 확인해 주세요.', 'assistant');
      elements.answerInput.value = answer;
      elements.answerCount.textContent = String(answer.length);
      renderQuickReplies(getQuestion(session.stage, session.startMode, session.state).quickReplies);
    }
    busy = false;
    renderProgress();
    if (!session.ready) elements.answerInput.focus();
  }

  document.querySelectorAll('[data-start-mode]').forEach(function (button) {
    button.addEventListener('click', function () { start(button.dataset.startMode); });
  });

  document.querySelectorAll('[data-detail-entry]').forEach(function (button) {
    button.addEventListener('click', function () { openDetailDialog(button.dataset.detailEntry); });
  });

  elements.detailClose.addEventListener('click', closeDetailDialog);
  elements.detailContinue.addEventListener('click', closeDetailDialog);
  elements.detailDialog.addEventListener('click', function (event) {
    if (event.target === elements.detailDialog) closeDetailDialog();
  });
  elements.detailStartLink.addEventListener('click', function () {
    track('project_instruction_detail_start', { entry_kind: elements.detailStartLink.dataset.entryKind || 'material' });
  });

  elements.answerInput.addEventListener('input', function () {
    elements.answerCount.textContent = String(elements.answerInput.value.length);
    session.draft = elements.answerInput.value;
    session.draftsByStage[session.stage] = session.draft;
    if (session.startMode && !session.ready) save();
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
    if (!answer || session.ready || busy) return;
    elements.answerInput.value = '';
    elements.answerCount.textContent = '0';
    submitAnswer(answer);
  });

  elements.resetButton.addEventListener('click', function () {
    if (busy) return;
    if (!window.confirm('지금까지 입력한 내용을 지우고 처음부터 시작할까요?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* this page still resets */ }
    session = newSession();
    elements.workspace.hidden = true;
    elements.startSection.hidden = false;
    elements.resultSection.hidden = true;
    elements.messages.replaceChildren();
    elements.answerInput.value = '';
    elements.answerCount.textContent = '0';
    renderQuickReplies([]);
    track('project_instruction_reset');
    elements.startSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  elements.previousButton.addEventListener('click', function () {
    if (busy || !session.history.length) return;
    if (!session.ready) session.draftsByStage[session.stage] = session.draft;
    var previous = session.history.pop();
    session.stage = previous.stage;
    session.state = previous.state;
    session.messages = session.messages.slice(0, previous.messagesLength);
    session.ready = false;
    session.markdown = '';
    session.draft = Object.prototype.hasOwnProperty.call(session.draftsByStage, previous.stage) ? session.draftsByStage[previous.stage] : previous.answer;
    session.draftsByStage[previous.stage] = session.draft;
    renderAll();
    save();
    elements.answerInput.focus();
  });

  function downloadText(text, filename) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  elements.downloadButton.addEventListener('click', function () {
    if (!session.ready) return;
    downloadText(buildProjectInstructionMarkdown(session.state), 'AI_업무지시서.md');
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

  try {
    var legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy && Array.isArray(legacy.messages) && legacy.messages.length) {
      elements.legacyNotice.hidden = false;
      elements.legacyDownload.addEventListener('click', function () {
        var text = '# 이전 버전의 작성 기록\n\n' + legacy.messages.map(function (message) {
          return (message.role === 'user' ? '내 답변' : '질문·안내') + '\n' + String(message.text || '').split('\n').map(function (line) { return '> ' + line; }).join('\n');
        }).join('\n\n');
        downloadText(text, '이전_업무지시서_작성기록.md');
      });
    }
  } catch (error) { /* do not overwrite unavailable or older records */ }
  track('project_instruction_page_view', { page_path: '/tools/project-instruction/' });
  if (load()) renderAll();
})();
