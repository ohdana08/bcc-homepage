import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lecture-request/analytics.js', import.meta.url), 'utf8');
const LIVE = 'https://bccconsulting.kr/lecture-request/';
const RECEIPT = '12345678-1234-4234-8234-123456789012';
const MEASUREMENT = 'G-5TN5XW0T2J';

test('GA: intake exclusion selector has one body root containing every form field', () => {
  const html = readFileSync(new URL('../lecture-request/index.html', import.meta.url), 'utf8');
  const body = html.match(/<body class="bcc-lecture-request">([\s\S]*)<\/body>/);
  assert.ok(body, 'The Google tag exclusion class must identify the entire intake body.');
  assert.equal((html.match(/class="bcc-lecture-request"/g) || []).length, 1);
  assert.match(body[1], /<form\b[^>]*id="requestForm"/);
  assert.equal((body[1].match(/<(?:input|select|textarea)\b/g) || []).length, (html.match(/<(?:input|select|textarea)\b/g) || []).length);
});

function run({ url = LIVE, storage = new Map(), blockedStorage = false, existing = {}, historyError = false } = {}) {
  const scripts = [];
  const listeners = new Map();
  const location = { href: url };
  const window = {
    location, ...existing,
    history: { replaceState(_state, _title, target) {
      if (historyError) throw new Error('History unavailable');
      location.href = new URL(target, location.href).href;
    } },
    addEventListener(name, fn) { listeners.set(name, fn); },
  };
  Object.defineProperty(window, 'sessionStorage', { get() {
    if (blockedStorage) throw new Error('Storage unavailable');
    return { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  } });
  const document = {
    querySelector: () => null,
    createElement: () => ({}),
    head: { appendChild(script) { scripts.push(script); } },
  };
  vm.runInNewContext(source, { window, document, URL, URLSearchParams });
  const commands = () => JSON.parse(JSON.stringify((window.dataLayer || []).map((value) => [...value])));
  const events = () => commands().filter((value) => value[0] === 'event');
  return { window, scripts, storage, commands, events, tracker: window.BCCLectureAnalytics, listeners };
}

test('GA: canonical context and fixed campaigns exclude raw URL, referrer and identifiers', () => {
  const app = run({ url: LIVE + '?utm_source=kakao&utm_medium=messenger&utm_campaign=lecture_request&utm_content=channel_reply&utm_term=PRIVATE_SENTINEL&gclid=PRIVATE_SENTINEL&contact_email=PRIVATE_SENTINEL#PRIVATE_SENTINEL' });
  assert.equal(app.scripts.length, 1);
  assert.equal(app.window.location.href, LIVE);
  assert.equal(app.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT);
  const config = app.commands().find((row) => row[0] === 'config')[2];
  assert.equal(config.send_page_view, false);
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.page_location, LIVE);
  assert.equal(config.page_referrer, '');
  assert.equal(config.campaign_source, 'kakao');
  assert.equal(config.campaign_medium, 'messenger');
  assert.equal(config.campaign_name, 'lecture_request');
  assert.equal(config.campaign_content, 'channel_reply');
  assert.equal(config.entry_channel, 'kakao_channel');
  assert.equal(JSON.stringify(app.commands()).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(app.events().map((event) => event[1]), ['page_view', 'lecture_request_view']);
});

test('GA: unapproved and duplicate UTM values are not sent', () => {
  const app = run({ url: LIVE + '?utm_source=kakao&utm_source=PRIVATE_SENTINEL&utm_medium=PRIVATE_SENTINEL&utm_campaign=lecture_request&utm_content=channel_reply%0A' });
  const config = app.commands().find((row) => row[0] === 'config')[2];
  assert.equal(config.campaign_source, undefined);
  assert.equal(config.campaign_medium, undefined);
  assert.equal(config.campaign_name, 'lecture_request');
  assert.equal(config.campaign_content, undefined);
  assert.equal(config.entry_channel, 'other');
  assert.equal(JSON.stringify(app.commands()).includes('PRIVATE_SENTINEL'), false);
});

test('GA: private, localhost, preview and QA pages do not load Google', () => {
  const excluded = [
    LIVE + '#receipt=' + RECEIPT + '&key=SECRET',
    LIVE + '#%72eceipt=' + RECEIPT,
    LIVE + '?receipt=' + RECEIPT,
    LIVE + '?mode=edit#receipt=' + RECEIPT,
    LIVE + '?qa=1',
    LIVE + '?qa=0&bcc_analytics_debug=1',
    LIVE + '?bcc_analytics_debug=invalid',
    LIVE + '?bcc_analytics_debug=1&bcc_analytics_debug=1',
    'http://127.0.0.1:5198/lecture-request/?bcc_analytics_debug=1',
    'https://bcc-homepage-preview.vercel.app/lecture-request/?bcc_analytics_debug=1',
    'https://bccconsulting.kr:8443/lecture-request/',
    'https://private:secret@bccconsulting.kr/lecture-request/',
    'https://bccconsulting.kr/admin-lecture-requests.html',
  ];
  for (const url of excluded) {
    const app = run({ url });
    app.tracker.start(); app.tracker.step(5); app.tracker.complete(RECEIPT);
    assert.equal(app.scripts.length, 0, url);
    assert.equal(app.events().length, 0, url);
  }
});

test('GA: start/step/complete are deduplicated and arbitrary parameters never enter events', () => {
  const app = run();
  app.tracker.start(); app.tracker.start();
  for (const number of [2, 3, 4, 5, 4, 2, 5, 1, 0, 6, 'PRIVATE_SENTINEL', { page_location: 'PRIVATE_SENTINEL' }]) app.tracker.step(number);
  app.tracker.complete('PRIVATE_SENTINEL');
  app.tracker.complete(RECEIPT); app.tracker.complete(RECEIPT);
  assert.deepEqual(app.events().map((event) => event[1]), ['page_view', 'lecture_request_view', 'lecture_request_start', 'lecture_request_step_2', 'lecture_request_step_3', 'lecture_request_step_4', 'lecture_request_step_5', 'lecture_request_complete']);
  const serialized = JSON.stringify(app.commands());
  assert.equal(serialized.includes(RECEIPT), false);
  assert.equal(serialized.includes('PRIVATE_SENTINEL'), false);
  const recovered = run({ storage: app.storage });
  recovered.tracker.complete(RECEIPT);
  assert.equal(recovered.events().filter((event) => event[1] === 'lecture_request_complete').length, 0);
});

test('GA: valid first-step progress recovers an autofilled start before step two exactly once', () => {
  const app = run();
  app.tracker.step(1); app.tracker.step(0);
  assert.deepEqual(app.events().map((event) => event[1]), ['page_view', 'lecture_request_view']);
  app.tracker.step(2); app.tracker.step(2); app.tracker.start();
  assert.deepEqual(app.events().map((event) => event[1]), ['page_view', 'lecture_request_view', 'lecture_request_start', 'lecture_request_step_2']);
  const editing = run({ url: LIVE + '?mode=edit#receipt=' + RECEIPT + '&key=SECRET' });
  editing.tracker.step(2);
  assert.equal(editing.events().length, 0);
});

test('GA: failures and inaccessible storage never throw into the form', () => {
  const app = run({ blockedStorage: true });
  assert.doesNotThrow(() => {
    app.tracker.start(); app.tracker.step(2); app.tracker.complete(RECEIPT); app.tracker.complete(RECEIPT);
  });
  assert.equal(app.events().filter((event) => event[1] === 'lecture_request_complete').length, 1);
  const failed = run();
  failed.scripts[0].onerror();
  assert.doesNotThrow(() => { failed.tracker.start(); failed.tracker.complete(RECEIPT); });
  assert.equal(failed.events().filter((event) => event[1] === 'lecture_request_complete').length, 0);
  assert.equal(run({ historyError: true }).scripts.length, 0);
});

test('GA: stopping for in-memory edit prevents custom events and sets the GA opt-out flag', () => {
  const app = run();
  app.tracker.start();
  const before = app.events().length;
  app.tracker.stop(); app.tracker.step(3); app.tracker.complete(RECEIPT);
  assert.equal(app.window['ga-disable-' + MEASUREMENT], true);
  assert.equal(app.events().length, before);
  const changed = run();
  changed.window.location.href = LIVE + '#receipt=' + RECEIPT + '&key=SECRET';
  changed.listeners.get('hashchange')();
  changed.tracker.complete(RECEIPT);
  assert.equal(changed.window['ga-disable-' + MEASUREMENT], true);
  assert.equal(changed.events().filter((event) => event[1] === 'lecture_request_complete').length, 0);
});

test('GA: existing tags fail closed without another Google loader', () => {
  for (const existing of [{ gtag() {} }, { google_tag_manager: {} }, { dataLayer: [{ event: 'existing' }] }]) {
    const app = run({ existing });
    assert.equal(app.scripts.length, 0);
  }
});

test('GA: explicit production debug stays separate from real funnel and recovers after reload', () => {
  const app = run({ url: LIVE + '?bcc_analytics_debug=1&utm_source=kakao' });
  app.tracker.start(); app.tracker.step(2); app.tracker.complete(RECEIPT);
  const names = app.events().map((event) => event[1]);
  assert.deepEqual(names, ['qa_lecture_request_view', 'qa_lecture_request_start', 'qa_lecture_request_step_2', 'qa_lecture_request_complete']);
  assert.ok(app.events().every((event) => event[2].debug_mode === true));
  assert.ok(app.events().every((event) => event[2].entry_channel === 'qa'));
  assert.ok(app.events().every((event) => event[2].campaign_source === 'codex' && event[2].campaign_medium === 'test' && event[2].campaign_name === 'lecture_request_qa' && event[2].campaign_content === 'validation'));
  const resumed = run({ storage: app.storage });
  resumed.tracker.start(); resumed.tracker.complete(RECEIPT);
  assert.deepEqual(resumed.events().map((event) => event[1]), ['qa_lecture_request_view', 'qa_lecture_request_start']);
  assert.equal(JSON.stringify(app.commands()).includes(RECEIPT), false);
});

test('GA: blocked debug storage keeps the QA marker and never becomes a live reload', () => {
  const app = run({ url: LIVE + '?bcc_analytics_debug=1', blockedStorage: true });
  app.tracker.start(); app.tracker.step(2); app.tracker.complete(RECEIPT);
  assert.equal(app.scripts.length, 0);
  assert.equal(app.events().length, 0);
  assert.equal(app.window.location.href, LIVE + '?bcc_analytics_debug=1');
  const reload = run({ url: app.window.location.href, blockedStorage: true });
  assert.equal(reload.scripts.length, 0);
  assert.equal(reload.events().length, 0);
});
