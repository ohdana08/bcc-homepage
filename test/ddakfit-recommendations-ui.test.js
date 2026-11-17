import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ddakfit/recommendations.js', import.meta.url), 'utf8');
const conditions = { age: '30_39', region: '부산', business: 'under_3', industry: 'manufacturing' };
const card = { title: '<img src=x onerror=alert(1)>', description: '<script>private script</script>', who: '부산 중소기업', amount: '공고 확인', deadline: '2026-12-01', url: 'https://www.bizinfo.go.kr/example?id=1', previewUrl: 'https://evil.example' };

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.attributes = {}; this.handlers = {};
    this.hidden = false; this.disabled = false; this.textContent = ''; this.focused = false;
  }
  set innerHTML(_value) { throw new Error('HTML string injection is forbidden'); }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  async emit(type) {
    const event = { preventDefault() {} };
    await Promise.all((this.handlers[type] || []).map((fn) => fn(event)));
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function response(data = { total: 1, results: [card] }, ok = true) { return { ok, json: async () => data }; }
function setup({ fetchImpl = async () => response(), valid = true, noAnalytics = false } = {}) {
  const ids = ['form', 'submit', 'status', 'results', 'selection', 'list'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.results.hidden = true;
  const inputs = Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key, { value, selectedOptions: [{ textContent: `label-${value}` }] }]));
  inputs.email = { value: 'private@example.test', selectedOptions: [{ textContent: 'private label' }] };
  elements.form.elements = { namedItem: (name) => inputs[name] };
  elements.form.reportValidity = () => valid;
  const calls = [], events = [], timers = new Map();
  let nextTimer = 0;
  const window = noAnalytics ? {} : { BCCDdakfitAnalytics: { recommendation: (...args) => events.push(args) } };
  const context = vm.createContext({
    document: {
      getElementById: (id) => elements[id.replace('recommendation-', '')],
      createElement: (tag) => new Element(tag),
    }, window, URL, AbortController,
    fetch: (...args) => { calls.push(args); return fetchImpl(...args); },
    setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context);
  return { ...elements, button: elements.submit, inputs, calls, events, timers, submit: () => elements.form.emit('submit'), change: () => elements.form.emit('change') };
}
function descend(el) { return [el, ...el.children.flatMap(descend)]; }

test('submits only four conditions without credentials and renders plain text plus fixed diagnosis destination', async () => {
  const app = setup();
  await app.submit();
  assert.equal(app.calls.length, 1);
  const [path, options] = app.calls[0];
  assert.equal(path, '/api/ddakfit-recommendations');
  assert.deepEqual(JSON.parse(options.body), conditions);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.cache, 'no-store');
  assert.equal(app.results.hidden, false);
  assert.equal(app.list.children.length, 1);
  const nodes = descend(app.list);
  assert.ok(nodes.some((el) => el.tagName === 'h3' && el.textContent === card.title));
  assert.ok(nodes.some((el) => el.textContent === card.description));
  assert.ok(!nodes.some((el) => ['img', 'script'].includes(el.tagName)));
  const links = nodes.filter((el) => el.tagName === 'a');
  assert.equal(links[0].href, card.url);
  assert.equal(links[0].rel, 'noopener noreferrer');
  const diagnosis = new URL(links[1].href);
  assert.equal(diagnosis.origin, 'https://ddakfit.bccconsulting.kr');
  assert.equal(diagnosis.pathname, '/embed');
  assert.equal(diagnosis.searchParams.get('noticeUrl'), card.url);
  assert.equal(diagnosis.searchParams.get('start'), 'direct');
  assert.ok(!links[1].href.includes('evil.example'));
  await links[0].emit('click');
  await links[1].emit('click');
  assert.deepEqual(JSON.parse(JSON.stringify(app.events)), [['start', null], ['results', 1], ['notice', null], ['diagnosis', null]]);
  assert.ok(!JSON.stringify(app.events).includes('부산'));
  assert.ok(!JSON.stringify(app.events).includes('private'));
  assert.equal(app.button.disabled, false);
  assert.equal(app.form.attributes['aria-busy'], undefined);
  assert.equal(app.timers.size, 0);
});

test('genuine zero results and network failure have distinct status and analytics, retry succeeds', async () => {
  const zero = setup({ fetchImpl: async () => response({ total: 0, results: [] }) });
  await zero.submit();
  assert.equal(zero.results.hidden, false);
  assert.equal(zero.list.children.length, 0);
  assert.match(zero.status.textContent, /수집한 공고.*후보를 찾지 못했어요/);
  assert.deepEqual(JSON.parse(JSON.stringify(zero.events)), [['start', null], ['results', 0]]);
  let failed = true;
  const retry = setup({ fetchImpl: async () => { if (failed) throw new Error('private network error'); return response(); } });
  await retry.submit();
  assert.equal(retry.results.hidden, true);
  assert.match(retry.status.textContent, /불러오지 못했어요/);
  assert.doesNotMatch(retry.status.textContent, /private network error/);
  assert.deepEqual(JSON.parse(JSON.stringify(retry.events)), [['start', null], ['error', null]]);
  failed = false;
  await retry.submit();
  assert.equal(retry.results.hidden, false);
  assert.equal(retry.list.children.length, 1);
});

test('changing conditions clears displayed results without another request', async () => {
  const app = setup();
  await app.submit();
  app.inputs.region.value = '서울';
  await app.change();
  assert.equal(app.results.hidden, true);
  assert.equal(app.list.children.length, 0);
  assert.match(app.status.textContent, /찾기 버튼/);
  assert.equal(app.calls.length, 1);
  assert.equal(app.form.attributes['aria-busy'], undefined);
});

test('late old success cannot reveal stale results or clear the newer loading state', async () => {
  const first = deferred(), second = deferred();
  let request = 0;
  const app = setup({ fetchImpl: () => ++request === 1 ? first.promise : second.promise });
  const oldSubmit = app.submit();
  assert.equal(app.form.attributes['aria-busy'], 'true');
  assert.equal(app.button.disabled, true);
  const oldSignal = app.calls[0][1].signal;
  app.inputs.region.value = '서울';
  await app.change();
  assert.equal(oldSignal.aborted, true);
  assert.equal(app.button.disabled, false);
  const newSubmit = app.submit();
  first.resolve(response());
  await oldSubmit;
  assert.equal(app.form.attributes['aria-busy'], 'true');
  assert.equal(app.button.disabled, true);
  assert.equal(app.results.hidden, true);
  assert.match(app.status.textContent, /찾고 있어요/);
  second.resolve(response({ total: 0, results: [] }));
  await newSubmit;
  assert.equal(app.form.attributes['aria-busy'], undefined);
  assert.equal(app.button.disabled, false);
  assert.match(app.selection.textContent, /선택한 조건/);
  assert.equal(app.events.filter(([state]) => state === 'results').length, 1);
  assert.equal(app.events.at(-1)[1], 0);
  assert.equal(app.timers.size, 0);
});

test('late old rejection cannot overwrite a new successful response', async () => {
  const old = deferred();
  let request = 0;
  const app = setup({ fetchImpl: () => ++request === 1 ? old.promise : Promise.resolve(response()) });
  const oldSubmit = app.submit();
  await app.change();
  await app.submit();
  const successfulText = app.status.textContent;
  old.reject(new Error('aborted old request'));
  await oldSubmit;
  assert.equal(app.status.textContent, successfulText);
  assert.equal(app.results.hidden, false);
  assert.equal(app.events.filter(([state]) => state === 'error').length, 0);
});

test('invalid forms do not fetch; HTTP, schema, unsafe URL and timeout failures remain retryable', async () => {
  const invalid = setup({ valid: false });
  await invalid.submit();
  assert.equal(invalid.calls.length, 0);
  for (const fetchImpl of [
    async () => response({}, false),
    async () => response({ total: 3, results: [] }),
    async () => response({ total: 0, results: [card] }),
    async () => response({ total: 1, results: [{ ...card, url: 'javascript:alert(1)' }] }),
  ]) {
    const app = setup({ fetchImpl });
    await app.submit();
    assert.equal(app.results.hidden, true);
    assert.equal(app.form.attributes['aria-busy'], undefined);
    assert.equal(app.button.disabled, false);
    assert.equal(app.events.at(-1)[0], 'error');
  }
  const timeout = setup({ fetchImpl: (_url, options) => new Promise((_yes, no) => options.signal.addEventListener('abort', () => no(new Error('Timeout')))) });
  const pending = timeout.submit();
  for (const fn of timeout.timers.values()) fn();
  await pending;
  assert.equal(timeout.form.attributes['aria-busy'], undefined);
  assert.equal(timeout.button.disabled, false);
  assert.equal(timeout.events.at(-1)[0], 'error');
  const noAnalytics = setup({ noAnalytics: true });
  await noAnalytics.submit();
  assert.equal(noAnalytics.results.hidden, false);
});
