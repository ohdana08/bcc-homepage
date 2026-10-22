import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual navigation/receipt handlers without network or real data.
const APP = readFileSync(new URL('../lecture-request/app.js', import.meta.url), 'utf8');
const ANALYTICS = readFileSync(new URL('../lecture-request/analytics.js', import.meta.url), 'utf8');
const BASE = 'https://bccconsulting.kr/lecture-request/';
const ITEM = { receipt: '87654321-4321-4321-8321-210987654321', key: 'Q'.repeat(43) };
const SENTINEL = 'PRIVATE_SENTINEL';
function between(start, end) {
  const begin = APP.indexOf(start), finish = APP.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, start);
  return APP.slice(begin, finish);
}
const HELPERS = between('  const qaNavigation =', '  function showSuccess(');
const SUCCESS = between('  function showSuccess(', '  async function loadEdit(');
const DOWNLOAD = between("  $('downloadBtn').addEventListener", "  $('continueEditBtn').addEventListener");
const EDIT = between("  $('continueEditBtn').addEventListener", '  const retryNotice =');
const NEW_REQUEST = between("  const newRequestLink =", '  const hash =');
function navigation(href, hasNewRequestLink = true) {
  const handlers = new Map(), nodes = new Map();
  const newLink = { href: './' }; let blob, navigated, stopCount = 0;
  const location = { href, assign(value) { navigated = value; } };
  class FixtureURL extends URL {
    static createObjectURL(value) { blob = value; return 'blob:synthetic-receipt'; }
    static revokeObjectURL() {}
  }
  const context = vm.createContext({
    URL: FixtureURL, URLSearchParams, Blob, location, receipt: { ...ITEM }, submittedPayload: {}, changedRetryDraft: null, pending: null, dirty: true, attachmentConsentGranted: false,
    groups: [], labels: {}, displayValue() {}, hide() {}, message() {}, status() {}, uploadAttachments() {},
    track(method) { if (method === 'stop') stopCount++; }, setTimeout() {},
    document: { querySelector(selector) { assert.equal(selector, '.new-request'); return hasNewRequestLink ? newLink : null; }, createElement() { return { click() {} }; } },
    $(id) { if (!nodes.has(id)) nodes.set(id, { value: '', checked: true, textContent: '', focus() {}, addEventListener(name, listener) { handlers.set(id + ':' + name, listener); } }); return nodes.get(id); },
  });
  Object.defineProperty(context, 'localStorage', { get() { throw new Error('Navigation must not use localStorage'); } });
  vm.runInContext(HELPERS + SUCCESS + DOWNLOAD + EDIT + NEW_REQUEST, context);
  return { context, location, newLink, handlers, nodes, downloaded: () => blob, navigated: () => navigated, stops: () => stopCount };
}
function assertPrivate(url, qa) {
  const parsed = new URL(url);
  assert.deepEqual([...parsed.searchParams], qa ? [['qa', '1']] : []);
  assert.deepEqual([...new URLSearchParams(parsed.hash.slice(1))], [['receipt', ITEM.receipt], ['key', ITEM.key]]);
  assert.equal(url.includes(SENTINEL), false);
}
function loaderCount(href) {
  const scripts = [];
  const window = { location: { href }, sessionStorage: { getItem() { throw new Error('Excluded visits must not access tracking storage'); } } };
  vm.runInNewContext(ANALYTICS, { window, URL, URLSearchParams, document: { querySelector() { return null; }, createElement() { return {}; }, head: { appendChild(script) { scripts.push(script); } } } });
  return scripts.length;
}

test('QA navigation: query/hash marker presence is normalized to qa=1 without copying its value', () => {
  for (const suffix of ['?qa=1', '?qa', '?qa=0', '?qa=&qa=0', '?%71a=' + SENTINEL, '#qa=0', '#qa=' + SENTINEL, '?utm_source=' + SENTINEL + '#%71a=1']) {
    const app = navigation(BASE + suffix);
    assertPrivate(app.context.privateUrl(ITEM), true);
    assert.equal(app.newLink.href, BASE + '?qa=1');
    assert.equal(loaderCount(app.newLink.href), 0);
  }
});

test('QA navigation: private link display, receipt file and continue-edit target retain only QA context', async () => {
  const app = navigation(BASE + '?qa=0&utm_source=' + SENTINEL + '&bcc_analytics_debug=1&email=' + SENTINEL + '#unused=' + SENTINEL);
  app.context.showSuccess({ receipt: ITEM.receipt, revision: 1 }, ITEM.key, {}, false);
  const displayed = app.nodes.get('privateLink').value;
  assertPrivate(displayed, true);
  app.handlers.get('downloadBtn:click')();
  const text = await app.downloaded().text();
  assert.ok(text.includes('개인 수정 링크: ' + displayed));
  assert.equal(text.includes(SENTINEL), false);
  app.handlers.get('continueEditBtn:click')();
  const target = new URL(app.navigated());
  assert.deepEqual([...target.searchParams], [['qa', '1'], ['mode', 'edit']]);
  assert.equal(target.hash, new URL(displayed).hash);
  assert.equal(app.stops(), 1);
  assert.equal(loaderCount(target.href), 0);
});

test('QA navigation: the initial marker stays captured after same-document URL changes', () => {
  const app = navigation(BASE + '#qa=1');
  app.location.href = BASE + '?utm_content=' + SENTINEL + '#unrelated=' + SENTINEL;
  assertPrivate(app.context.privateUrl(ITEM), true);
  assert.equal(app.context.requestUrl().href, BASE + '?qa=1');
});

test('QA navigation: private edit to new request clears receipt/key and remains excluded', () => {
  const app = navigation(BASE + '?qa=1&mode=edit&gclid=' + SENTINEL + '#receipt=' + ITEM.receipt + '&key=' + ITEM.key + '&other=' + SENTINEL);
  assert.equal(app.newLink.href, BASE + '?qa=1');
  assert.equal(new URL(app.newLink.href).hash, '');
  const another = navigation(app.newLink.href);
  assertPrivate(another.context.privateUrl(ITEM), true);
  assert.equal(loaderCount(another.newLink.href), 0);
});

test('QA navigation: ordinary, UTM and debug-only visits keep ordinary links and drop unrelated parameters', () => {
  for (const suffix of ['', '?utm_source=kakao&utm_medium=messenger', '?bcc_analytics_debug=1', '?email=' + SENTINEL + '#other=' + SENTINEL, '?notqa=1', '#QA=1']) {
    const app = navigation(BASE + suffix);
    assertPrivate(app.context.privateUrl(ITEM), false);
    assert.equal(app.newLink.href, './');
    app.handlers.get('continueEditBtn:click')();
    assert.deepEqual([...new URL(app.navigated()).searchParams], [['mode', 'edit']]);
    assert.equal(loaderCount(app.navigated()), 0);
  }
});

test('QA navigation: local/index-file URL compatibility and absent new-request node are safe', () => {
  const app = navigation('http://127.0.0.1:5198/lecture-request/index.html?qa=1', false);
  assert.equal(app.context.requestUrl().href, 'http://127.0.0.1:5198/lecture-request/?qa=1');
  assertPrivate(app.context.privateUrl(ITEM), true);
});
