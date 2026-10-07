const ERROR_MESSAGES = {
  unsupported: '이 브라우저에서는 말로 답하기를 사용할 수 없어요. Safari나 Chrome에서 열거나 키보드의 마이크를 눌러 주세요.',
  'not-allowed': '마이크 사용이 허용되지 않았어요. 브라우저의 마이크 허용을 확인하거나 키보드의 마이크를 눌러 주세요.',
  'service-not-allowed': '이 브라우저에서 말로 답하기가 허용되지 않았어요. Safari나 Chrome에서 열거나 키보드의 마이크를 눌러 주세요.',
  'audio-capture': '마이크를 사용할 수 없어요. 다른 앱의 마이크 사용을 끝내거나 키보드의 마이크를 눌러 주세요.',
  network: '연결이 원활하지 않아 말하기를 멈췄어요. 적힌 내용을 확인한 뒤 다시 시도해 주세요.',
  'no-speech': '말소리를 듣지 못했어요. 다시 눌러 말하거나 직접 적어 주세요.',
  'language-not-supported': '이 브라우저에서 한국어 받아쓰기를 사용할 수 없어요. 키보드의 마이크를 눌러 주세요.',
  aborted: '말하기가 멈췄어요. 적힌 내용을 확인한 뒤 다시 눌러 주세요.',
  'start-timeout': '말하기가 시작되지 않았어요. 마이크 허용을 확인하거나 Safari나 Chrome에서 다시 열어 주세요.',
  'stop-timeout': '말하기를 멈췄어요. 적힌 내용을 확인하고 빠진 말은 직접 적어 주세요.',
  unconfirmed: '마지막 말을 끝까지 확인하지 못했어요. 아래 남은 말을 확인하고 필요한 부분을 직접 옮겨 주세요.',
  limit: '답이 길어져 말하기를 멈췄어요. 아래 남은 말을 확인하고 필요한 부분을 직접 옮겨 주세요.',
  failed: '말하기를 시작하거나 이어갈 수 없어요. 다시 시도하거나 키보드의 마이크를 눌러 주세요.',
};

/**
 * Explicitly started, one-session speech controller. The caller owns consent,
 * text editing and persistence; only final results reach onText. getContext
 * must return a comparable revision, changed on manual edits/navigation.
 * onText returns true when it accepted the complete segment, false otherwise.
 */
export function createSpeechInput({
  Recognition,
  getContext = () => null,
  onText = () => true,
  onState = () => {},
  onPreview = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  startTimeoutMs = 8000,
  stopTimeoutMs = 3000,
  maxDurationMs = 60000,
} = {}) {
  let current = null;

  function clearTimers(session) {
    for (const name of ['startTimer', 'stopTimer', 'durationTimer']) {
      if (session[name] != null) clearTimer(session[name]);
      session[name] = null;
    }
  }

  function finish(session, state, { abort = false, keepPreview = false } = {}) {
    if (current !== session) return;
    // Invalidate before abort: browser implementations may fire events inline.
    current = null;
    clearTimers(session);
    const recognition = session.recognition;
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
    if (abort) {
      try { recognition.abort(); } catch { /* Already ended or never started. */ }
    }
    if (!keepPreview) onPreview('');
    onState(state);
  }

  function fail(session, code, { abort = true } = {}) {
    const error = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'failed';
    finish(session, { status: 'error', error, message: ERROR_MESSAGES[error] }, {
      abort, keepPreview: Boolean(session.preview),
    });
  }

  function valid(session) {
    if (current !== session) return false;
    if (!Object.is(getContext(), session.context)) {
      finish(session, { status: 'idle', message: '답이 바뀌어 말하기를 멈췄어요.' }, { abort: true });
      return false;
    }
    return true;
  }

  function preview(session, text) {
    session.preview = text;
    onPreview(text);
  }

  function stop() {
    const session = current;
    if (!session || !valid(session) || session.stopping) return false;
    session.stopping = true;
    clearTimers(session);
    session.stopTimer = setTimer(() => {
      if (valid(session)) fail(session, 'stop-timeout');
    }, stopTimeoutMs);
    onState({ status: 'stopping', message: '마지막 말을 정리하고 있어요.' });
    try { session.recognition.stop(); }
    catch { fail(session, 'failed'); }
    return true;
  }

  function start() {
    if (current) return false;
    onPreview('');
    if (typeof Recognition !== 'function') {
      onState({ status: 'unsupported', error: 'unsupported', message: ERROR_MESSAGES.unsupported });
      return false;
    }
    let recognition;
    try { recognition = new Recognition(); }
    catch {
      onState({ status: 'error', error: 'failed', message: ERROR_MESSAGES.failed });
      return false;
    }
    const session = {
      recognition, context: getContext(), committed: new Set(), preview: '',
      hadText: false, stopping: false, started: false,
      startTimer: null, stopTimer: null, durationTimer: null,
    };
    current = session;
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (!valid(session) || session.started || session.stopping) return;
      session.started = true;
      if (session.startTimer != null) clearTimer(session.startTimer);
      session.startTimer = null;
      session.durationTimer = setTimer(() => {
        if (valid(session)) stop();
      }, maxDurationMs);
      onState({ status: 'listening', message: '듣고 있어요. 다 말하면 말하기 끝내기를 눌러 주세요.' });
    };
    recognition.onresult = event => {
      if (!valid(session)) return;
      const results = event.results;
      if (!results) return;
      // The list is cumulative. Final entries never change; interim entries can
      // change/disappear. Index-based bookkeeping allows repeated spoken words.
      const pending = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const text = result?.[0]?.transcript?.trim() || '';
        if (session.committed.has(index)) continue;
        if (!result?.isFinal) {
          if (text) pending.push(text);
          continue;
        }
        if (text) {
          let accepted = false;
          try { accepted = onText(text) === true; } catch { /* Preserve the segment below. */ }
          if (current !== session) return;
          if (!accepted) {
            // Preserve this segment and all subsequent unaccepted words, even
            // when the browser batches several final results in one event.
            const remaining = pending.slice();
            for (let next = index; next < results.length; next += 1) {
              if (session.committed.has(next)) continue;
              const rest = results[next]?.[0]?.transcript?.trim();
              if (rest) remaining.push(rest);
            }
            preview(session, remaining.join(' '));
            fail(session, 'limit');
            return;
          }
          // The caller may update its draft revision while accepting our text.
          session.context = getContext();
          session.hadText = true;
        }
        session.committed.add(index);
      }
      if (valid(session)) preview(session, pending.join(' '));
    };
    recognition.onerror = event => {
      if (valid(session)) fail(session, event.error || 'failed');
    };
    recognition.onend = () => {
      if (!valid(session)) return;
      if (session.preview) fail(session, 'unconfirmed', { abort: false });
      else if (!session.hadText) fail(session, 'no-speech', { abort: false });
      else finish(session, { status: 'idle', message: '말한 내용을 확인하고 고쳐 주세요.' });
    };
    session.startTimer = setTimer(() => {
      if (valid(session)) fail(session, 'start-timeout');
    }, startTimeoutMs);
    onState({ status: 'starting', message: '마이크를 준비하고 있어요. 허용 안내가 나오면 확인해 주세요.' });
    try { recognition.start(); }
    catch (error) {
      const denied = ['NotAllowedError', 'SecurityError'].includes(error?.name);
      fail(session, denied ? 'not-allowed' : 'failed');
      return false;
    }
    return true;
  }

  function cancel() {
    const session = current;
    if (session) finish(session, { status: 'idle', message: '말하기를 멈췄어요.' }, { abort: true });
    else {
      onPreview('');
      onState({ status: 'idle', message: '' });
    }
    return Boolean(session);
  }

  return { start, stop, cancel, isActive: () => current !== null };
}
