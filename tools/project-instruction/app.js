import { BUILD_START_PROMPT, buildProjectInstructionMarkdown } from './local-engine.js';
import {
  BEGINNER_STORAGE_KEY, BEGINNER_ENGINE, LEGACY_KEYS, BEGINNER_QUESTIONS,
  NARROW_QUESTION, MICROPHONE_GUIDANCE, answerLength, newBeginnerSession,
  restoreBeginnerSession, submitBeginnerAnswer, editBeginnerQuestion,
  selectRhythmChip, rhythmChoicesFromText, beginnerConfirmation, migrateLegacyRecord, beginnerProjectState,
} from './beginner-flow.js';
import { initCollection } from './collection.js';
import { createSpeechInput } from './speech-input.js';

(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const collection = initCollection();
  let session = newBeginnerSession();
  const legacyRecords = [];
  let feedback = '';
  $('build-start-prompt').value = BUILD_START_PROMPT;
  $('microphone-guidance').textContent = MICROPHONE_GUIDANCE;
  let speechAccepted = false;
  let speechRevision = 0;
  let speechStatus = 'idle';
  let speechOverflow = '';
  let speechRecovery = '';
  let speech = null;
  function showSpeechPreview(text) {
    if (speechOverflow && text) speechOverflow = text;
    const value = speechOverflow || speechRecovery || text;
    $('speech-preview').value = value;
    $('speech-preview-section').hidden = !value;
    $('speech-preview-label').textContent = speechOverflow || speechRecovery ? '칸에 담지 못한 말이에요. 필요한 부분을 복사해 주세요.' : '말한 내용을 확인하고 있어요';
  }
  function cancelSpeech(clearPreview = true) {
    speechRevision++;
    speech?.cancel();
    $('speech-consent').hidden = true;
    if (clearPreview) { speechOverflow = ''; speechRecovery = ''; showSpeechPreview(''); }
    $('speech-status').textContent = '';
  }
  function canSpeak() {
    return !!session.startMode && ['questions', 'narrow'].includes(session.phase) && !$('generator-area').hidden && !document.hidden;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speech = createSpeechInput({
    Recognition: window.isSecureContext === false ? undefined : Recognition,
    getContext: () => [speechRevision, session.phase, session.index, $('generator-area').hidden, document.hidden].join(':'),
    onText: text => {
      if (!canSpeak()) return false;
      const original = $('answer-input').value;
      const separator = original && !/\s$/.test(original) ? ' ' : '';
      const next = original + separator + text;
      if (next.length > $('answer-input').maxLength) {
        speechOverflow = text; showSpeechPreview(text); return false;
      }
      fillDraft(next, true);
      if (session.index === 5) renderQuickReplies();
      return true;
    },
    onPreview: showSpeechPreview,
    onState: state => {
      if (state.status === 'error' && !speechOverflow && $('speech-preview').value) {
        speechRecovery = $('speech-preview').value;
        showSpeechPreview('');
      }
      speechStatus = state.status;
      const active = ['starting', 'listening', 'stopping'].includes(state.status);
      $('speech-button').setAttribute('aria-pressed', String(active));
      $('speech-button-label').textContent = state.status === 'starting' ? '준비 중 · 취소' : state.status === 'listening' ? '말하기 끝내기' : state.status === 'stopping' ? '마무리 중 · 취소' : '말로 답하기';
      $('speech-status').textContent = state.error === 'limit' ? '답변 칸은 1,200자까지 담을 수 있어요. 기존 답은 그대로 두었어요. 아래 말에서 필요한 부분을 복사해 옮겨주세요.' : state.message || '';
      if (['error', 'unsupported'].includes(state.status) && state.error !== 'limit') $('speech-help').open = true;
    },
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: timer => window.clearTimeout(timer),
  });
  function startSpeech() {
    if (!canSpeak()) return;
    speechOverflow = ''; speechRecovery = ''; showSpeechPreview('');
    $('speech-consent').hidden = true;
    $('speech-help').open = false;
    speech.start();
  }
  $('speech-button').addEventListener('click', () => {
    if (speech.isActive()) {
      if (speechStatus === 'listening') speech.stop(); else cancelSpeech(false);
      return;
    }
    if (!canSpeak()) return;
    if (typeof Recognition !== 'function' || window.isSecureContext === false) { startSpeech(); return; }
    if (speechAccepted) { startSpeech(); return; }
    $('speech-consent').hidden = false;
    $('speech-start').focus();
  });
  $('speech-start').addEventListener('click', () => { speechAccepted = true; startSpeech(); });
  $('speech-dismiss').addEventListener('click', () => { cancelSpeech(false); $('answer-input').focus(); });
  $('speech-use-keyboard').addEventListener('click', () => { cancelSpeech(false); $('answer-input').focus(); });
  $('edit-participation').addEventListener('click', () => cancelSpeech());
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelSpeech(); });
  window.addEventListener('pagehide', () => cancelSpeech());

  function track(name, params) {
    try {
      const detail = Object.assign({ engine: BEGINNER_ENGINE }, params || {});
      if (typeof window.gtag === 'function') window.gtag('event', name, detail);
      if (window.dataLayer) window.dataLayer.push(Object.assign({ event: name }, detail));
    } catch { /* analytics must never block the lesson */ }
  }
  function save() {
    try { localStorage.setItem(BEGINNER_STORAGE_KEY, JSON.stringify(session)); $('saved-state').textContent = '이 기기에 저장'; }
    catch { $('saved-state').textContent = '이번 화면에서만 유지'; }
  }
  function load() {
    try {
      const restored = restoreBeginnerSession(JSON.parse(localStorage.getItem(BEGINNER_STORAGE_KEY)));
      if (restored) session = restored;
    } catch { /* never replace unavailable records while loading */ }
    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        // Copy the exact bytes before offering migration; never rewrite the old key.
        if (localStorage.getItem(key + '-backup-v5') === null) localStorage.setItem(key + '-backup-v5', raw);
        legacyRecords.push({ key, raw });
      } catch {
        try { const raw = localStorage.getItem(key); if (raw !== null) legacyRecords.push({ key, raw }); } catch { /* local storage unavailable */ }
      }
    }
    if (session.legacy?.raw && !legacyRecords.some(record => record.key === session.legacy.key && record.raw === session.legacy.raw)) legacyRecords.push(session.legacy);
  }
  function downloadText(text, filename, type = 'text/markdown;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function legacyMarkdown(record) {
    try {
      const value = JSON.parse(record.raw);
      if (typeof value.markdown === 'string' && value.markdown) return value.markdown;
      if (value.state) return buildProjectInstructionMarkdown(value.state);
      return '# 이전 작성 기록\n\n' + record.raw.split('\n').map(line => '> ' + line).join('\n');
    } catch { return record.raw; }
  }
  function showLegacyRecords() {
    $('legacy-notice').hidden = !legacyRecords.length;
    $('legacy-records').replaceChildren();
    legacyRecords.forEach((record, index) => {
      const row = document.createElement('div'); row.className = 'legacy-record';
      const title = document.createElement('strong'); title.textContent = '이전 작성 기록 ' + (index + 1);
      row.appendChild(title);
      try {
        const prior = JSON.parse(record.raw);
        if (prior.draft) { const draft = document.createElement('p'); draft.textContent = '이전에 쓰던 답: ' + prior.draft; row.appendChild(draft); }
      } catch { /* raw record is still downloadable */ }
      const actions = [
        ['내용 보기', () => { $('legacy-preview').textContent = legacyMarkdown(record); $('legacy-preview').hidden = false; }],
        ['이전 파일 받기', () => downloadText(legacyMarkdown(record), '이전_업무지시서.md')],
        ['원본 기록 받기', () => downloadText(record.raw, '이전_작성기록_' + (index + 1) + '.json', 'application/json;charset=utf-8')],
        ['이전 내용 이어 쓰기', () => {
          cancelSpeech();
          if (session.startMode && !window.confirm('현재 적은 내용은 이 기기에 따로 보관하고, 이전 내용을 이어 쓸까요?')) return;
          const migrated = migrateLegacyRecord(record.raw, record.key);
          if (!migrated) { $('legacy-status').textContent = '이 기록은 화면에서 이어 쓰기 어려워요. 원본 기록을 받아 확인해 주세요.'; return; }
          if (session.startMode) {
            try { localStorage.setItem(BEGINNER_STORAGE_KEY + '-before-restore-' + Date.now(), JSON.stringify(session)); }
            catch { $('legacy-status').textContent = '현재 내용을 보관하지 못했어요. 먼저 파일로 받아주세요.'; return; }
          }
          session = migrated; feedback = ''; save(); renderAll(); focusQuestion();
        }],
      ];
      actions.forEach(([label, action]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', action); row.appendChild(button); });
      $('legacy-records').appendChild(row);
    });
  }
  $('legacy-download').addEventListener('click', () => downloadText(JSON.stringify(legacyRecords, null, 2), '이전_작성기록_전체.json', 'application/json;charset=utf-8'));

  function renderProgress() {
    const count = ['confirm', 'review', 'complete'].includes(session.phase) ? 6 : session.index + 1;
    $('progress-value').textContent = count + ' / 6';
    $('progress-bar').style.width = (count / 6 * 100) + '%';
    $('progress-steps').replaceChildren();
    BEGINNER_QUESTIONS.forEach((question, index) => {
      const item = document.createElement('li');
      item.textContent = (index + 1) + ' ' + question.label;
      item.classList.toggle('is-current', index === session.index && session.phase === 'questions');
      item.classList.toggle('is-complete', !!session.answers[question.id]);
      if (index === session.index && session.phase === 'questions') item.setAttribute('aria-current', 'step');
      $('progress-steps').appendChild(item);
    });
  }
  function renderBrief() {
    const values = { work: session.workChoice || session.answers.work, material: session.answers.material, result: session.answers.result };
    Object.entries(values).forEach(([key, value]) => { const target = document.querySelector('[data-brief="' + key + '"]'); if (target) target.textContent = value || '아직 적지 않았어요'; });
  }
  function fillDraft(value, fromSpeech = false) {
    if (!fromSpeech) cancelSpeech(false);
    session.draft = value;
    if (session.index === 5 && session.phase === 'questions') session.rhythmChoices = rhythmChoicesFromText(value);
    if (session.phase !== 'narrow') session.draftsByStage[BEGINNER_QUESTIONS[session.index].id] = value;
    $('answer-input').value = value; $('answer-count').textContent = answerLength(value); save();
  }
  function chip(label, action, selected = false) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => { action(); $('answer-input').focus(); });
    return button;
  }
  function renderQuickReplies() {
    $('quick-replies').replaceChildren();
    const question = BEGINNER_QUESTIONS[session.index];
    if (session.phase === 'narrow') {
      session.workOptions.forEach(value => $('quick-replies').appendChild(chip(value, () => fillDraft(value))));
    } else if (question.groups) {
      question.groups.forEach(group => {
        const wrapper = document.createElement('div'); wrapper.className = 'chip-group';
        const title = document.createElement('p'); title.textContent = group.label; wrapper.appendChild(title);
        group.chips.forEach(value => wrapper.appendChild(chip(value, () => { session = selectRhythmChip(session, group.id, value); fillDraft(session.draft); renderQuickReplies(); }, session.rhythmChoices[group.id] === value)));
        $('quick-replies').appendChild(wrapper);
      });
    } else {
      question.chips.forEach(value => $('quick-replies').appendChild(chip(value, () => fillDraft(value))));
    }
  }
  function renderQuestion() {
    const asking = ['questions', 'narrow'].includes(session.phase);
    $('question-card').hidden = !asking;
    if (!asking) return;
    const question = BEGINNER_QUESTIONS[session.index];
    // Keep one question on screen. Old answers stay in local history, not bubbles.
    $('messages').replaceChildren();
    const title = document.createElement('h3'); title.id = 'current-question'; title.tabIndex = -1;
    title.textContent = session.phase === 'narrow' ? NARROW_QUESTION : question.prompt;
    const help = document.createElement('p'); help.id = 'question-help';
    help.textContent = session.phase === 'narrow' ? '처음 적은 내용: ' + session.answers.work : '예: ' + question.example;
    $('messages').append(title, help);
    $('answer-input').value = session.draft;
    $('answer-count').textContent = answerLength(session.draft);
    $('answer-feedback').textContent = feedback || (session.shortRetries[question.id] && !session.answers[question.id] && session.phase === 'questions' ? '짧게 적어도 괜찮아요. 한 번 더 보내면 다음으로 넘어가요.' : '');
    $('answer-input').setAttribute('aria-invalid', feedback ? 'true' : 'false');
    $('previous-button').disabled = session.index === 0 && session.phase !== 'narrow';
    $('send-answer').textContent = session.returnToConfirmation ? '고친 내용 확인하기 →' : session.index === 5 ? '정리한 내용 보기 →' : '다음으로 →';
    renderQuickReplies();
  }
  function renderConfirmation() {
    const confirming = ['confirm', 'review'].includes(session.phase);
    $('confirmation-section').hidden = !confirming;
    if (!confirming) return;
    const summary = beginnerConfirmation(session);
    $('confirmation-summary').textContent = summary.text;
    $('confirmation-original').textContent = '끝나면 줄 것에 적은 말: ' + (session.answers.result || '아직 정하지 않음');
    $('confirmation-work').textContent = '오늘 먼저 만들 일: ' + (session.workChoice || session.answers.work);
    $('answer-review').hidden = session.phase !== 'review';
    $('confirmation-actions').hidden = session.phase === 'review';
    $('answer-review-list').replaceChildren();
    if (session.phase === 'review') {
      BEGINNER_QUESTIONS.forEach((question, index) => {
        const row = document.createElement('div'); row.className = 'answer-review-row';
        const title = document.createElement('strong'); title.textContent = (index + 1) + '. ' + question.label;
        const answer = document.createElement('p'); answer.textContent = session.answers[question.id] || '아직 적지 않았어요';
        const button = document.createElement('button'); button.type = 'button'; button.id = 'edit-answer-' + question.id;
        button.textContent = question.label + ' 고치기'; button.className = 'text-button';
        button.addEventListener('click', () => { session = editBeginnerQuestion(session, index, true); feedback = ''; save(); renderAll(); focusQuestion(); });
        row.append(title, answer, button); $('answer-review-list').appendChild(row);
      });
    }
  }
  function renderResult() {
    const ready = session.phase === 'complete';
    // Only explicit “맞아요” creates a document; setDocument preserves a reviewed copy.
    collection.setDocument(ready ? session.markdown : '');
    $('result-section').hidden = !ready;
    if (ready) $('markdown-preview').textContent = session.markdown;
  }
  function renderAll() {
    cancelSpeech();
    document.body.dataset.writing = session.startMode ? 'true' : 'false';
    document.body.dataset.phase = session.phase;
    $('start-section').hidden = !!session.startMode;
    $('workspace').hidden = !session.startMode;
    renderProgress(); renderBrief(); renderQuestion(); renderConfirmation(); renderResult();
  }
  function focusQuestion() {
    $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (['questions', 'narrow'].includes(session.phase)) $('current-question').focus({ preventScroll: true });
    else if (session.phase === 'confirm') $('confirmation-summary').focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-start-mode]').forEach(button => button.addEventListener('click', () => {
    session = newBeginnerSession(); session.startMode = button.dataset.startMode; feedback = ''; save(); renderAll(); focusQuestion();
    track('project_instruction_start', { start_mode: session.startMode });
  }));
  $('answer-input').addEventListener('input', () => { fillDraft($('answer-input').value); if (session.index === 5) renderQuickReplies(); });
  $('answer-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('composer').requestSubmit(); }
  });
  $('composer').addEventListener('submit', event => {
    event.preventDefault();
    if (!['questions', 'narrow'].includes(session.phase)) return;
    const completedQuestion = BEGINNER_QUESTIONS[session.index].id;
    const result = submitBeginnerAnswer(session, $('answer-input').value);
    session = result.session; feedback = result.message || ''; save(); renderAll();
    if (['advance', 'confirm', 'narrow'].includes(result.status)) { track('project_instruction_answer', { stage: completedQuestion }); focusQuestion(); }
    else $('answer-input').focus();
  });
  $('previous-button').addEventListener('click', () => {
    if (session.phase === 'narrow') session = editBeginnerQuestion(session, 0, session.returnToConfirmation);
    else if (session.index > 0) session = editBeginnerQuestion(session, session.index - 1, session.returnToConfirmation);
    feedback = ''; save(); renderAll(); focusQuestion();
  });
  $('confirmation-yes').addEventListener('click', () => {
    if (session.phase !== 'confirm') return;
    session.markdown = buildProjectInstructionMarkdown(beginnerProjectState(session));
    session.phase = 'complete'; save(); renderAll();
    $('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('project_instruction_ready');
  });
  function reviewAnswers() { session.phase = 'review'; feedback = ''; save(); renderAll(); $('confirmation-section').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  $('confirmation-edit').addEventListener('click', reviewAnswers);
  $('review-after-result').addEventListener('click', reviewAnswers);
  $('confirmation-back').addEventListener('click', () => { session.phase = 'confirm'; save(); renderAll(); focusQuestion(); });
  $('reset-button').addEventListener('click', () => {
    cancelSpeech();
    if (!window.confirm('지금까지 적은 내용을 지우고 처음부터 시작할까요? 이전 버전 기록과 이미 제출한 사본은 그대로 남아요.')) return;
    session = newBeginnerSession(); feedback = '';
    try { localStorage.removeItem(BEGINNER_STORAGE_KEY); } catch { /* reset this screen only */ }
    // Do not reset the separate submitted/pending copy or receipt.
    renderAll(); $('start-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('project_instruction_reset');
  });
  $('download-button').addEventListener('click', () => { if (session.phase === 'complete') { downloadText(session.markdown, 'AI_업무지시서.md'); track('project_instruction_download'); } });
  $('copy-button').addEventListener('click', async () => {
    if (session.phase !== 'complete') return;
    try { await navigator.clipboard.writeText(session.markdown); $('copy-button').textContent = '복사했습니다'; window.setTimeout(() => { $('copy-button').textContent = '내용 복사'; }, 1600); }
    catch { $('copy-button').textContent = '복사하지 못했습니다'; }
  });
  $('copy-build-start').addEventListener('click', async () => {
    if (session.phase !== 'complete') return;
    try { await navigator.clipboard.writeText(BUILD_START_PROMPT); $('build-start-status').textContent = '복사했습니다. MD 파일과 함께 AI 대화에 붙여넣고 보내세요.'; }
    catch { $('build-start-prompt').focus(); $('build-start-prompt').select(); $('build-start-status').textContent = '자동 복사가 어려워 문장을 선택했어요. 직접 복사하거나 길게 눌러 복사해 주세요.'; }
  });
  const detailContent = {
    material: { symbol: '＋', title: '사진이나 문서를 활용하고 싶으세요?', description: '이 화면에서는 파일을 올리거나 읽지 않습니다. 자료를 함께 활용하는 방법은 BCC에 문의할 수 있어요.', benefits: ['지금은 자료에서 필요한 내용을 직접 답변에 적을 수 있어요.', '업무지시서를 받은 뒤 사용하는 AI에 자료를 함께 전달할 수 있어요.', '자료 활용에 도움이 필요하면 이용 방법을 문의하세요.'], outcomeTitle: '지금까지 적은 답변은 유지됩니다', outcomeCopy: '문의 버튼을 눌러도 답변이나 파일이 자동으로 전송되지 않습니다.' },
    link: { symbol: '↗', title: '참고할 링크가 있으세요?', description: '답변에 링크와 참고하고 싶은 부분을 함께 적어주세요. 이 화면에서는 링크를 열거나 내용을 자동 분석하지 않습니다.', benefits: ['어느 부분을 참고할지 내 말로 설명해요.', '원하는 구성과 바꾸고 싶은 점을 함께 남겨요.', '완성된 업무지시서와 링크를 사용하는 AI에 전달해요.'], outcomeTitle: '참고자료 활용이 어렵다면', outcomeCopy: 'BCC에 이용 방법을 문의할 수 있어요. 링크나 답변은 자동으로 전송되지 않습니다.' },
  };
  document.querySelectorAll('[data-detail-entry]').forEach(button => button.addEventListener('click', () => {
    cancelSpeech();
    const kind = button.dataset.detailEntry === 'link' ? 'link' : 'material'; const content = detailContent[kind];
    for (const [id, key] of [['detail-symbol', 'symbol'], ['detail-title', 'title'], ['detail-description', 'description'], ['detail-outcome-title', 'outcomeTitle'], ['detail-outcome-copy', 'outcomeCopy']]) $(id).textContent = content[key];
    $('detail-benefits').replaceChildren(); content.benefits.forEach(text => { const item = document.createElement('li'); item.textContent = text; $('detail-benefits').appendChild(item); });
    $('detail-start-link').dataset.entryKind = kind;
    if (typeof $('detail-dialog').showModal === 'function') $('detail-dialog').showModal(); else $('detail-dialog').setAttribute('open', '');
    track('project_instruction_detail_open', { entry_kind: kind });
  }));
  function closeDetail() { if (typeof $('detail-dialog').close === 'function') $('detail-dialog').close(); else $('detail-dialog').removeAttribute('open'); }
  $('detail-close').addEventListener('click', closeDetail); $('detail-continue').addEventListener('click', closeDetail);
  $('detail-dialog').addEventListener('click', event => { if (event.target === $('detail-dialog')) closeDetail(); });
  $('detail-start-link').addEventListener('click', () => track('project_instruction_detail_start', { entry_kind: $('detail-start-link').dataset.entryKind || 'material' }));
  load(); showLegacyRecords(); renderAll();
  track('project_instruction_page_view', { page_path: '/tools/project-instruction/' });
})();
