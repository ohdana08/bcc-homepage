import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechInput } from '../tools/project-instruction/speech-input.js';

function setup(overrides = {}) {
  let revision = 0;
  let time = 0;
  let timerId = 0;
  const timers = new Map();
  const instances = [];
  const states = [];
  const previews = [];
  const texts = [];
  class Recognition {
    constructor() { this.calls = []; instances.push(this); }
    start() { this.calls.push('start'); }
    stop() { this.calls.push('stop'); }
    abort() { this.calls.push('abort'); }
    emit(type, event = {}) { this[`on${type}`]?.(event); }
  }
  const options = {
    Recognition, getContext: () => revision,
    onText: text => { texts.push(text); revision += 1; return true; },
    onState: state => states.push(state), onPreview: text => previews.push(text),
    setTimer: (fn, delay) => { timers.set(++timerId, { fn, at: time + delay }); return timerId; },
    clearTimer: id => timers.delete(id), ...overrides,
  };
  const api = createSpeechInput(options);
  function tick(ms) {
    const target = time + ms;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= target);
      if (!entry) break;
      const [id, timer] = entry;
      time = timer.at; timers.delete(id); timer.fn();
    }
    time = target;
  }
  return {
    api, instances, states, previews, texts, timers, tick,
    changeContext() { revision += 1; },
    state: () => states.at(-1), preview: () => previews.at(-1),
  };
}
function results(...entries) {
  return { resultIndex: 0, results: entries.map(([text, final = true]) => Object.assign([{ transcript: text }], { isFinal: final })) };
}
function started(fixture) {
  assert.equal(fixture.api.start(), true);
  const recognition = fixture.instances.at(-1);
  recognition.emit('start');
  return recognition;
}

test('명시적 시작 전 마이크를 만들지 않고 한국어·중간결과로 시작한다', () => {
  const f = setup(); assert.equal(f.instances.length, 0); assert.equal(f.states.length, 0);
  const r = started(f);
  assert.equal(r.lang, 'ko-KR'); assert.equal(r.continuous, true); assert.equal(r.interimResults, true);
  assert.equal(r.maxAlternatives, 1); assert.equal(f.state().status, 'listening');
  assert.equal(f.api.start(), false); assert.equal(f.instances.length, 1);
  f.api.cancel(); assert.equal(f.timers.size, 0);
});

test('누적 최종 결과는 정확히 한 번, 같은 말의 다른 결과는 각각 전달한다', () => {
  const f = setup(); const r = started(f);
  r.emit('result', results(['주문', false])); assert.deepEqual(f.texts, []); assert.equal(f.preview(), '주문');
  r.emit('result', results(['주문 정리', false])); assert.equal(f.preview(), '주문 정리');
  r.emit('result', results(['주문 정리'], ['다음', false])); assert.deepEqual(f.texts, ['주문 정리']);
  r.emit('result', results(['주문 정리'], ['주문 정리']));
  r.emit('result', results(['주문 정리'], ['주문 정리']));
  assert.deepEqual(f.texts, ['주문 정리', '주문 정리']); assert.equal(f.preview(), '');
  r.emit('end'); assert.equal(f.state().status, 'idle'); assert.equal(f.api.isActive(), false); assert.equal(f.timers.size, 0);
});

test('중간 결과가 사라져도 이전 최종 결과를 다시 추가하지 않는다', () => {
  const f = setup(); const r = started(f);
  r.emit('result', results(['첫 문장'], ['잠깐', false]));
  r.emit('result', results(['첫 문장']));
  assert.equal(f.preview(), ''); assert.deepEqual(f.texts, ['첫 문장']);
  f.api.cancel();
});

test('말하기 끝내기는 잔여 최종문장을 받고 끝나며 중복 중지는 무시한다', () => {
  const f = setup(); const r = started(f);
  r.emit('result', results(['확인 중', false]));
  assert.equal(f.api.stop(), true); assert.equal(f.api.stop(), false); assert.equal(f.state().status, 'stopping');
  r.emit('result', results(['확인 완료'])); r.emit('end');
  assert.deepEqual(f.texts, ['확인 완료']); assert.deepEqual(r.calls, ['start', 'stop']);
  assert.equal(f.state().status, 'idle'); assert.equal(f.timers.size, 0);
});

test('취소 및 새 시작 후 저장된 옛 callback도 답을 바꾸지 않는다', () => {
  const f = setup(); const old = started(f);
  const late = old.onresult; const lateError = old.onerror; const lateEnd = old.onend;
  old.emit('result', results(['미확정', false]));
  assert.equal(f.api.cancel(), true); assert.equal(f.preview(), ''); assert.deepEqual(old.calls, ['start', 'abort']);
  const next = started(f);
  late(results(['옛 문장'])); lateError({ error: 'network' }); lateEnd();
  assert.deepEqual(f.texts, []); assert.equal(f.state().status, 'listening');
  next.emit('result', results(['새 문장'])); assert.deepEqual(f.texts, ['새 문장']); f.api.cancel();
});

test('직접 고치기·질문 이동의 revision 변화는 다음 이벤트에서 즉시 취소한다', () => {
  for (const event of ['result', 'start', 'end', 'error']) {
    const f = setup(); f.api.start(); const r = f.instances[0]; f.changeContext();
    r.emit(event, event === 'result' ? results(['오래된 말']) : { error: 'network' });
    assert.deepEqual(f.texts, []); assert.equal(f.api.isActive(), false); assert.equal(f.state().status, 'idle');
    assert.equal(r.calls.at(-1), 'abort'); assert.equal(f.timers.size, 0);
  }
});

test('API 미지원 및 constructor 실패는 시작 없이 안내한다', () => {
  const missing = setup({ Recognition: undefined }); assert.equal(missing.api.start(), false);
  assert.equal(missing.state().status, 'unsupported'); assert.equal(missing.timers.size, 0);
  const broken = setup({ Recognition: class { constructor() { throw new Error('unavailable'); } } });
  assert.equal(broken.api.start(), false); assert.equal(broken.state().error, 'failed'); assert.equal(broken.api.isActive(), false);
});

test('권한 거절·마이크·연결·무음 오류는 종료하고 재시작하지 않는다', () => {
  for (const error of ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'no-speech', 'language-not-supported', 'aborted', 'unknown']) {
    const f = setup(); const r = started(f); const lateEnd = r.onend;
    r.emit('error', { error }); lateEnd();
    assert.equal(f.state().status, 'error'); assert.equal(f.api.isActive(), false); assert.equal(f.timers.size, 0);
    assert.equal(f.instances.length, 1); assert.doesNotMatch(f.state().message, /도구|자동화|기능|입력|출력|데이터|프롬프트/);
  }
});

test('start 동기 예외도 타이머를 정리하고 권한 오류를 구분한다', () => {
  const f = setup(); f.api.start(); f.api.cancel();
  const Constructor = f.instances[0].constructor;
  Constructor.prototype.start = () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  assert.equal(f.api.start(), false); assert.equal(f.state().error, 'not-allowed'); assert.equal(f.timers.size, 0);
});

test('이벤트가 전혀 없으면 시작 제한시간 뒤 종료한다', () => {
  const f = setup(); f.api.start(); const r = f.instances[0]; const lateStart = r.onstart;
  f.tick(7999); assert.equal(f.api.isActive(), true);
  f.tick(1); assert.equal(f.api.isActive(), false); assert.equal(f.state().error, 'start-timeout');
  lateStart(); assert.equal(f.state().error, 'start-timeout'); assert.equal(f.timers.size, 0);
  assert.deepEqual(r.calls, ['start', 'abort']);
});

test('최대 60초 뒤 stop하며 end가 없어도 3초 뒤 abort한다', () => {
  const f = setup(); const r = started(f);
  f.tick(60000); assert.equal(f.state().status, 'stopping'); assert.equal(r.calls.at(-1), 'stop');
  f.tick(3000); assert.equal(f.state().error, 'stop-timeout'); assert.equal(r.calls.at(-1), 'abort');
  assert.equal(f.api.isActive(), false); assert.equal(f.timers.size, 0);
});

test('남은 말이 최종 확정 없이 끝나면 직접 옮길 수 있도록 남긴다', () => {
  const f = setup(); const r = started(f);
  r.emit('result', results(['이미 완성'], ['남은 말', false])); r.emit('end');
  assert.deepEqual(f.texts, ['이미 완성']); assert.equal(f.state().error, 'unconfirmed'); assert.equal(f.preview(), '남은 말');
  f.api.cancel(); assert.equal(f.preview(), '');
});

test('길이 제한으로 거절한 문장과 같은 event의 나머지 말은 잘리지 않고 남는다', () => {
  const accepted = [];
  const f = setup({ onText: text => { if (accepted.length) return false; accepted.push(text); return true; } });
  const r = started(f); const late = r.onresult;
  r.emit('result', results(['받은 말'], ['넘친 문장'], ['아직 끝나지 않은 말', false]));
  assert.deepEqual(accepted, ['받은 말']); assert.equal(f.state().error, 'limit');
  assert.equal(f.preview(), '넘친 문장 아직 끝나지 않은 말'); assert.equal(f.api.isActive(), false);
  late(results(['받은 말'], ['넘친 문장'], ['늦은 말'])); assert.equal(f.preview(), '넘친 문장 아직 끝나지 않은 말');
  assert.equal(f.timers.size, 0);
});

test('권한 오류나 중지 timeout도 아직 옮기지 않은 말을 지우지 않는다', () => {
  for (const ending of ['error', 'timeout']) {
    const f = setup(); const r = started(f); r.emit('result', results(['유지할 말', false]));
    if (ending === 'error') r.emit('error', { error: 'network' });
    else { f.api.stop(); f.tick(3000); }
    assert.equal(f.preview(), '유지할 말'); assert.deepEqual(f.texts, []);
  }
});

test('아무 말 없이 자연 종료되어도 무한 듣기나 자동 재시작을 하지 않는다', () => {
  const f = setup(); const r = started(f); r.emit('end');
  assert.equal(f.state().error, 'no-speech'); assert.equal(f.api.isActive(), false); assert.equal(f.instances.length, 1);
  assert.equal(f.timers.size, 0); assert.deepEqual(f.texts, []);
});
