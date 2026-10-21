import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { handleLectureRequest } from '../lib/lecture-request.js';
import { createLectureFixture } from '../scripts/lecture-request-local-server.mjs';

// Independent SRE tests: execute the actual tracker and the actual submission
// listener with bounded DOM/HTTP seams. No Google script is executed or sent.
const TRACKER = readFileSync(new URL('../lecture-request/analytics.js', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../lecture-request/app.js', import.meta.url), 'utf8');
const BASE = 'https://bccconsulting.kr/lecture-request/';
const MID = 'G-5TN5XW0T2J';
const RECEIPT = '87654321-4321-4321-8321-210987654321';
const SENTINEL = 'PRIVATE_SENTINEL_person@example.invalid_01098765432';
const CAMPAIGN = '?utm_source=kakao&utm_medium=messenger&utm_campaign=lecture_request&utm_content=channel_reply';

function environment({ href = BASE, storage = new Map(), blockedRead = false, blockedWrite = false, silentWrite = false, existingScript = false, prior = {}, history = 'normal' } = {}) {
  const loader = [], mutations = [], listeners = new Map();
  const location = { href };
  const win = {
    location, ...prior,
    history: { replaceState(_state, _title, target) {
      if (history === 'throw') throw new Error('Synthetic history failure');
      mutations.push(target);
      if (history !== 'noop') location.href = new URL(target, location.href).href;
    } },
    addEventListener(name, listener) { listeners.set(name, listener); },
    sessionStorage: {
      getItem(key) { if (blockedRead) throw new Error('Synthetic read denied'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedWrite) throw new Error('Synthetic write denied'); if (!silentWrite) storage.set(key, value); },
    },
  };
  const doc = {
    title: SENTINEL, referrer: `https://example.invalid/${SENTINEL}?receipt=${RECEIPT}`,
    querySelector() { return existingScript ? { src: 'existing-google-tag' } : null; },
    createElement(tag) { assert.equal(tag, 'script'); return {}; },
    head: { appendChild(script) { loader.push({ script, hrefAtLoad: location.href }); } },
  };
  vm.runInNewContext(TRACKER, { window: win, document: doc, URL, URLSearchParams });
  const commands = () => JSON.parse(JSON.stringify((win.dataLayer || []).map(item => Array.from(item))));
  const events = () => commands().filter(row => row[0] === 'event');
  return { win, doc, loader, storage, mutations, listeners, commands, events, api: win.BCCLectureAnalytics };
}

test('SRE analytics: only exact public production origins and new-request URLs can start a loader', async t => {
  const excluded = [
    'http://bccconsulting.kr/lecture-request/', 'https://bccconsulting.kr:8443/lecture-request/',
    'https://name:password@bccconsulting.kr/lecture-request/',
    'https://bccconsulting.kr.example.invalid/lecture-request/',
    'https://preview.vercel.app/lecture-request/?bcc_analytics_debug=1',
    'http://localhost:5198/lecture-request/?bcc_analytics_debug=1',
    BASE + '#KEY=' + SENTINEL, BASE + '?%52ECEIPT=' + RECEIPT,
    BASE + '?mode=edit', BASE + '?qa', BASE + '#qa=0',
    BASE + '?qa=1&bcc_analytics_debug=1', BASE + '?bcc_analytics_debug=1&bcc_analytics_debug=0',
    'https://bccconsulting.kr/admin-lecture-requests.html',
  ];
  for (const href of excluded) await t.test(href, () => {
    const env = environment({ href }); env.api.start(); env.api.step(5); env.api.complete(RECEIPT);
    assert.equal(env.loader.length, 0); assert.deepEqual(env.events(), []);
  });
  for (const href of [BASE, 'https://www.bccconsulting.kr/lecture-request/index.html']) {
    const env = environment({ href }); assert.equal(env.loader.length, 1);
    assert.equal(env.commands().filter(row => row[0] === 'config').length, 1);
  }
});

test('SRE analytics: arbitrary URL, form-style values, referrer and receipt never reach commands or loader URL', () => {
  const env = environment({ href: BASE + CAMPAIGN + '&email=' + encodeURIComponent(SENTINEL) + '&gclid=' + SENTINEL + '#' + SENTINEL });
  assert.equal(env.loader[0].hrefAtLoad, BASE);
  env.api.start({ contact_name: SENTINEL }); env.api.step({ step: 2, purpose: SENTINEL });
  env.api.step(2); env.api.complete(RECEIPT, { email: SENTINEL });
  const transmitted = JSON.stringify({ commands: env.commands(), sources: env.loader.map(item => item.script.src) });
  assert.equal(transmitted.includes(SENTINEL), false); assert.equal(transmitted.includes(RECEIPT), false);
  assert.ok(env.events().every(row => row[2].page_location === BASE && row[2].page_referrer === '' && row[2].send_to === MID));
  assert.equal(env.loader[0].script.referrerPolicy, 'no-referrer');
  const context = env.commands().find(row => row[0] === 'config')[2];
  assert.equal(context.entry_channel, 'kakao_channel');
  assert.equal(context.allow_google_signals, false); assert.equal(context.allow_ad_personalization_signals, false);
  assert.equal(context.send_page_view, false);
});

test('SRE analytics: entry channel requires the complete exact four-part campaign', () => {
  const variants = [
    '', '?utm_source=kakao', CAMPAIGN + '&utm_source=kakao',
    CAMPAIGN.replace('channel_reply', 'channel_reply%20'),
    CAMPAIGN.replace('messenger', encodeURIComponent(SENTINEL)),
    CAMPAIGN.replace('kakao', 'KAKAO'),
  ];
  for (const suffix of variants) {
    const env = environment({ href: BASE + suffix });
    assert.equal(env.commands().find(row => row[0] === 'config')[2].entry_channel, 'other', suffix);
    assert.equal(JSON.stringify(env.commands()).includes(SENTINEL), false);
  }
});

test('SRE analytics: retained receipt dedup is case-insensitive, bounded and segregated between QA and live', () => {
  const storage = new Map(); const live = environment({ storage });
  live.api.complete(RECEIPT); live.api.complete(RECEIPT.toUpperCase());
  assert.equal(live.events().filter(row => row[1] === 'lecture_request_complete').length, 1);
  const reload = environment({ storage }); reload.api.complete(RECEIPT);
  assert.equal(reload.events().filter(row => row[1] === 'lecture_request_complete').length, 0);
  const debug = environment({ storage, href: BASE + '?bcc_analytics_debug=1' }); debug.api.complete(RECEIPT);
  assert.equal(debug.events().filter(row => row[1] === 'qa_lecture_request_complete').length, 1);
  assert.ok(debug.events().every(row => row[1].startsWith('qa_') && row[2].entry_channel === 'qa' && row[2].debug_mode === true));
  assert.equal(debug.events().some(row => row[1] === 'page_view'), false);
  const resumed = environment({ storage }); resumed.api.start();
  assert.ok(resumed.events().every(row => row[1].startsWith('qa_')));
});

test('SRE analytics: debug marker storage failure cannot turn a QA reload into live traffic', async t => {
  for (const options of [{ blockedRead: true }, { blockedWrite: true }, { silentWrite: true }]) await t.test(JSON.stringify(options), () => {
    const env = environment({ href: BASE + '?bcc_analytics_debug=1', ...options });
    assert.equal(env.loader.length, 0);
    assert.equal(new URL(env.win.location.href).searchParams.get('bcc_analytics_debug'), '1');
    assert.equal(env.events().length, 0);
  });
});

test('SRE analytics: regular storage failure, corrupt dedup and blocked GA do not throw or leak', () => {
  const env = environment({ blockedRead: true, blockedWrite: true });
  assert.doesNotThrow(() => { env.api.start(); env.api.start(); env.api.complete(RECEIPT); env.api.complete(RECEIPT); });
  assert.equal(env.events().filter(row => row[1] === 'lecture_request_complete').length, 1);
  const corrupt = environment({ storage: new Map([['bcc-lecture-request-ga4-completed-v1', '{' + SENTINEL]]) });
  corrupt.api.complete(RECEIPT); assert.equal(JSON.stringify(corrupt.commands()).includes(SENTINEL), false);
  corrupt.loader[0].script.onerror(); const count = corrupt.events().length;
  corrupt.api.start(); corrupt.api.step(4); corrupt.api.complete(randomUUID());
  assert.equal(corrupt.events().length, count); assert.equal(corrupt.win['ga-disable-' + MID], true);
});

test('SRE analytics: duplicate external tag, broken history and throwing queue stop collection', () => {
  for (const options of [{ existingScript: true }, { prior: { google_tag_manager: {} } }, { prior: { gtag() {} } }, { prior: { dataLayer: [SENTINEL] } }, { history: 'throw' }, { history: 'noop', href: BASE + '?unsafe=' + SENTINEL }]) {
    const env = environment(options); assert.equal(env.loader.length, 0);
  }
  const env = environment();
  env.win.dataLayer.push = () => { throw new Error(SENTINEL); };
  assert.doesNotThrow(() => { env.api.start(); env.api.step(2); env.api.complete(RECEIPT); });
  assert.equal(env.win['ga-disable-' + MID], true);
});

test('SRE analytics: hash or query becoming private immediately blocks subsequent events', () => {
  for (const suffix of ['#receipt=' + RECEIPT + '&key=' + SENTINEL, '?mode=edit', '?KEY=' + SENTINEL]) {
    const env = environment(); const before = env.events().length;
    env.win.location.href = BASE + suffix;
    env.api.complete(RECEIPT); env.api.step(5);
    assert.equal(env.events().length, before); assert.equal(env.win['ga-disable-' + MID], true);
  }
});

function sliceBetween(source, start, end) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `Source boundary missing: ${start}`);
  return source.slice(begin, finish);
}
const TRACK_WRAPPER = sliceBetween(APP, '  function track(method, value)', '  const steps =');
const SUBMIT_LISTENER = sliceBetween(APP, "  form.addEventListener('submit', async (event)", "  $('copyLinkBtn').addEventListener");
const INPUT_LISTENERS = sliceBetween(APP, '  const trackFirstInput =', "  $('nextBtn').addEventListener");
const EDIT_LISTENER = sliceBetween(APP, "  $('continueEditBtn').addEventListener", '  const retryNotice =');

function response() { return { statusCode: 200, setHeader() {}, status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; return this; } }; }
async function backend(db, body) {
  const res = response();
  await handleLectureRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, body }, res, { db, rateSecret: 'synthetic-sre-only' });
  if (res.statusCode >= 400) throw Object.assign(new Error(res.body.error), { status: res.statusCode });
  return res.body;
}
const syntheticPayload = { institution_name: 'SRE 합성 기관', contact_name: 'SRE 합성 담당자', contact_email: 'sre@example.invalid', audience: '아직 미정', purpose: '추천받고 싶어요' };
function appListener({ tracker = environment(), db = createLectureFixture(), edit = null, apiOverride, valid = true, missingTracker = false } = {}) {
  const handlers = {}, nodes = new Map(), requests = [], successes = [], messages = [];
  const identifiers = { key: randomBytes(32).toString('base64url'), idempotency_key: randomUUID() };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', checked: true, value: '', disabled: false, addEventListener(name, callback) { handlers[id + ':' + name] = callback; }, append() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    window: missingTracker ? {} : tracker.win, URL, URLSearchParams,
    form: { elements: { website: { value: '' } }, querySelectorAll: () => [node('submitBtn')], addEventListener(name, callback) { handlers[name] = callback; } },
    $: node, busy: false, step: 4, steps: [0, 1, 2, 3, 4], validate: () => valid,
    payload: () => ({ ...syntheticPayload }), identity: () => identifiers, edit,
    labels: Object.fromEntries(Object.keys(syntheticPayload).map(key => [key, key])), changedRetryDraft: null,
    api: async body => { requests.push(body); return apiOverride ? apiOverride(body, db) : backend(db, body); },
    track() {}, showStep() {}, message: value => messages.push(value), showSuccess: (...args) => successes.push(args),
    document: { createElement: () => ({ addEventListener() {} }) }, loadEdit() {},
  });
  vm.runInContext(TRACK_WRAPPER + SUBMIT_LISTENER + INPUT_LISTENERS, context);
  return { tracker, db, context, handlers, requests, successes, messages, identifiers, submit: () => handlers.submit({ preventDefault() {} }) };
}

test('SRE actual app: first trusted form interaction starts tracking, synthetic events and honeypot do not', () => {
  const app = appListener();
  for (const event of [{ isTrusted: false, target: { tagName: 'INPUT', name: 'contact_name' } }, { isTrusted: true, target: { tagName: 'INPUT', name: 'website' } }, { isTrusted: true, target: { tagName: 'BUTTON', name: 'submit' } }]) app.handlers.input(event);
  assert.equal(app.tracker.events().filter(row => row[1] === 'lecture_request_start').length, 0);
  app.handlers.change({ isTrusted: true, target: { tagName: 'INPUT', name: 'choice_audience' } });
  app.handlers.input({ isTrusted: true, target: { tagName: 'TEXTAREA', name: 'special_notes', value: SENTINEL } });
  assert.equal(app.tracker.events().filter(row => row[1] === 'lecture_request_start').length, 1);
  assert.equal(JSON.stringify(app.tracker.commands()).includes(SENTINEL), false);
});

test('SRE actual app + backend: conversion requires successful storage; no validation, failure or malformed response conversion', async () => {
  const app = appListener(); await app.submit();
  assert.equal(app.db.tables.lecture_requests.length, 1); assert.equal(app.successes.length, 1);
  assert.equal(app.tracker.events().filter(row => row[1] === 'lecture_request_complete').length, 1);
  assert.equal(JSON.stringify(app.tracker.commands()).includes('sre@example.invalid'), false);
  for (const options of [
    { valid: false },
    { apiOverride: async () => { throw new Error('Synthetic offline'); } },
    { apiOverride: async () => ({ ok: true }) },
    { apiOverride: async () => ({ ok: false, receipt: RECEIPT }) },
  ]) {
    const failed = appListener(options); await failed.submit();
    assert.equal(failed.tracker.events().filter(row => row[1] === 'lecture_request_complete').length, 0);
  }
});

test('SRE actual app: confirmed duplicate counts once even if its follow-up read fails, and retry never double-counts', async () => {
  const app = appListener({ apiOverride: async (body, db) => {
    if (body.action === 'get') throw new Error('Synthetic follow-up read failed');
    const saved = await backend(db, body); return { ...saved, duplicate: true };
  } });
  await app.submit(); await app.submit();
  assert.equal(app.db.tables.lecture_requests.length, 1); assert.equal(app.successes.length, 0);
  assert.equal(app.tracker.events().filter(row => row[1] === 'lecture_request_complete').length, 1);
  assert.equal(app.requests.filter(row => row.action === 'get').length, 2);
});

test('SRE actual app: an update and a broken analytics object do not create a conversion or block saving', async () => {
  const db = createLectureFixture(); const initial = appListener({ db }); await initial.submit();
  const row = db.tables.lecture_requests[0];
  const updated = appListener({ db, edit: { receipt: row.receipt, key: initial.identifiers.key, revision: 1 } });
  await updated.submit();
  assert.equal(updated.requests[0].action, 'update'); assert.equal(updated.successes.length, 1);
  assert.equal(updated.tracker.events().filter(event => event[1] === 'lecture_request_complete').length, 0);
  const absent = appListener({ missingTracker: true }); await absent.submit(); assert.equal(absent.successes.length, 1);
  const throwing = appListener(); throwing.tracker.win.BCCLectureAnalytics = { complete() { throw new Error(SENTINEL); } };
  await throwing.submit(); assert.equal(throwing.successes.length, 1);
});

test('SRE actual app: continuing into private edit disables GA before full navigation', () => {
  const tracker = environment(); let click, target;
  const context = vm.createContext({ window: tracker.win, URL, receipt: { receipt: RECEIPT }, dirty: true,
    $: () => ({ addEventListener(_name, listener) { click = listener; } }),
    privateUrl: () => BASE + '#receipt=' + RECEIPT + '&key=' + SENTINEL,
    location: { assign(url) { assert.equal(tracker.win['ga-disable-' + MID], true); target = url; } },
  });
  vm.runInContext(TRACK_WRAPPER + EDIT_LISTENER, context); click();
  const navigated = new URL(target);
  assert.equal(navigated.searchParams.get('mode'), 'edit'); assert.match(navigated.hash, /key=/);
  assert.equal(environment({ href: target }).loader.length, 0);
});

test('SRE deployment scope: tracker loads before app and CSP preserves intake security while enabling configured GA endpoints', () => {
  const html = readFileSync(new URL('../lecture-request/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/src="\.\/analytics\.js"/g) || []).length, 1);
  assert.ok(html.indexOf('src="./analytics.js"') < html.indexOf('src="./app.js"'));
  assert.equal(html.includes('gtm.js'), false);
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = config.headers.find(item => item.source === '/lecture-request/(.*)').headers;
  const csp = headers.find(item => item.key === 'Content-Security-Policy').value;
  for (const required of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", 'https://www.googletagmanager.com', 'https://www.google-analytics.com', 'https://region1.google-analytics.com']) assert.ok(csp.includes(required), required);
  assert.equal(csp.includes('unsafe-inline'), false); assert.equal(csp.includes('unsafe-eval'), false);
  assert.equal(headers.find(item => item.key === 'Referrer-Policy').value, 'no-referrer');
  assert.ok(headers.find(item => item.key === 'Cache-Control').value.includes('no-store'));
});
