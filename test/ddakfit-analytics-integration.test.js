import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const common = readFileSync(new URL('assets/bcc-analytics.js', ROOT), 'utf8');
const analytics = readFileSync(new URL('ddakfit/analytics.js', ROOT), 'utf8');
const directory = readFileSync(new URL('ddakfit/directory.js', ROOT), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('ddakfit/links.json', ROOT), 'utf8'));
const html = readFileSync(new URL('ddakfit/index.html', ROOT), 'utf8');
const pageScripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]
  .map((match) => new URL(match[1], 'https://bccconsulting.kr').pathname);
const sources = { '/assets/bcc-analytics.js': common, '/ddakfit/analytics.js': analytics, '/ddakfit/directory.js': directory, '/ddakfit/recommendations.js': readFileSync(new URL('ddakfit/recommendations.js', ROOT), 'utf8') };
const LIVE = 'https://bccconsulting.kr/ddakfit/';
const ID = 'G-5TN5XW0T2J';
const customNames = ['ddakfit_directory_view', 'ddakfit_links_region', 'ddakfit_links_search', 'ddakfit_search_no_results', 'ddakfit_link_out'];

class Element {
  constructor() { this.handlers = {}; this.innerHTML = ''; this.textContent = ''; this.value = ''; }
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, extra = {}) { for (const fn of this.handlers[type] || []) fn({ type, ...extra }); }
}

// External scripts are inert objects, PostHog is a loaded-library spy, and the
// only fetch is the local catalog fixture. No network, cookies or real telemetry.
async function run({ href = LIVE, commonOnly = false, storage = new Map(), blockStorage = false } = {}) {
  const scripts = [], posthogCalls = [], requests = [], timers = new Map();
  const elements = Object.fromEntries(['links-groups', 'links-tabs', 'links-q', 'links-count'].map(id => [id, new Element()]));
  const location = { href, get pathname() { return new URL(this.href).pathname; }, get origin() { return new URL(this.href).origin; }, get hash() { return new URL(this.href).hash; } };
  const window = {
    location,
    posthog: { __SV: 1, init(_publicProjectKey, options) { posthogCalls.push(options); } },
    sessionStorage: {
      getItem(key) { if (blockStorage) throw Error('Blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (blockStorage) throw Error('Blocked'); storage.set(key, value); },
    },
    history: { replaceState(_state, _title, path) { location.href = new URL(path, location.href).href; } },
  };
  const document = {
    getElementById(id) { return elements[id]; },
    querySelector(selector) {
      if (selector.includes('googletagmanager.com') || selector.includes('gtag/js?id=')) return scripts.find(s => s.src?.includes('googletagmanager.com')) || null;
      return null;
    },
    createElement() { return {}; },
    head: { appendChild(script) { scripts.push(script); } },
  };
  const context = vm.createContext({
    window, document, location, URL, URLSearchParams,
    fetch: async url => {
      requests.push(url);
      assert.equal(url, '/ddakfit/links.json?v=20261117');
      return { ok: true, json: async () => catalog };
    },
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  for (const script of commonOnly ? ['/assets/bcc-analytics.js'] : pageScripts) {
    assert.ok(sources[script], 'Unexpected page script requires an explicit integration fixture');
    await vm.runInContext(sources[script], context);
  }
  const commands = () => Array.from(window.dataLayer || [], entry => Array.from(entry));
  const events = () => commands().filter(entry => entry[0] === 'event').map(entry => ({ name: entry[1], params: entry[2] }));
  return {
    window, context, scripts, elements, storage, posthogCalls, requests, commands, events,
    exercise() {
      elements['links-tabs'].emit('click', { target: { closest: () => ({ getAttribute: () => 'busan' }) } });
      elements['links-q'].value = 'fixture-no-match';
      elements['links-q'].emit('input');
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
      elements['links-q'].value = '';
      elements['links-q'].emit('input');
      const index = catalog.sites.findIndex(site => site.region === 'busan');
      elements['links-groups'].emit('click', { target: { closest: () => ({ getAttribute: () => String(index) }) } });
    },
  };
}
function gaScripts(app) { return app.scripts.filter(script => script.src?.includes('googletagmanager.com')); }
function assertPostHogUnchanged(app) {
  assert.equal(app.posthogCalls.length, 1);
  const config = app.posthogCalls[0];
  assert.equal(config.capture_pageview, true);
  assert.equal(config.capture_pageleave, true);
  assert.equal(config.respect_dnt, true);
  assert.equal(config.session_recording.maskAllInputs, true);
  assert.equal(config.autocapture.capture_copied_text, false);
  assert.equal(config.person_profiles, 'identified_only');
  const sanitized = config.sanitize_properties({ $current_url: 'https://bccconsulting.kr/?email=synthetic-secret', $referrer: 'https://bccconsulting.kr/?token=synthetic-secret' });
  assert.ok(!JSON.stringify(sanitized).includes('synthetic-secret'));
}

for (const path of ['/ddakfit/', '/ddakfit/index.html', '/ddakfit']) {
  test('actual directory HTML order: ordinary events and canonical URL at ' + path, async () => {
    assert.deepEqual(pageScripts, Object.keys(sources));
    const app = await run({ href: 'https://bccconsulting.kr' + path });
    app.exercise();
    assert.equal(app.window.location.href, LIVE);
    assert.equal(gaScripts(app).length, 1);
    assert.deepEqual(app.events().map(e => e.name).sort(), ['page_view', ...customNames].sort());
    assert.equal(app.events().find(e => e.name === 'ddakfit_directory_view').params.site_count, 74);
    assert.equal(app.commands().filter(row => row[0] === 'config').length, 1);
    assert.equal(app.commands().find(row => row[0] === 'config')[2].send_page_view, false);
    app.window.BCCDdakfitAnalytics.view(74);
    vm.runInContext(analytics, app.context);
    assert.equal(app.events().filter(e => e.name === 'ddakfit_directory_view').length, 1);
    assert.equal(gaScripts(app).length, 1);
    assertPostHogUnchanged(app);
  });
}

for (const path of ['/ddakfit/', '/ddakfit/index.html', '/ddakfit']) {
  test('actual directory HTML order: QA stays separate at ' + path + ' and across reloads', async () => {
    const first = await run({ href: 'https://bccconsulting.kr' + path + '?bcc_analytics_debug=1#links' });
    assert.equal(first.window.location.href, LIVE + '#links');
    for (const app of [first, await run({ storage: first.storage })]) {
      app.exercise();
      assert.equal(new URL(app.window.location.href).pathname, '/ddakfit/');
      assert.equal(new URL(app.window.location.href).search, '');
      assert.equal(gaScripts(app).length, 1);
      assert.deepEqual(app.events().map(e => e.name).sort(), customNames.map(name => 'qa_' + name).sort());
      assert.ok(app.events().every(e => e.params.debug_mode === true && e.params.traffic_type === 'qa'));
      assert.equal(app.commands().filter(row => row[0] === 'config').length, 1);
      assert.equal(app.commands().find(row => row[0] === 'config')[2].send_page_view, false);
      assertPostHogUnchanged(app);
    }
  });
}

test('directory privacy and explicit QA exclusion remain effective with the common loader present', async () => {
  const app = await run({ href: LIVE + '?q=synthetic-private&utm_campaign=synthetic-private#synthetic-private' });
  app.exercise();
  assert.equal(app.window.location.href, LIVE);
  assert.ok(!JSON.stringify(app.commands()).includes('synthetic-private'));
  assert.ok(app.events().every(e => e.params.page_location === LIVE && e.params.page_referrer === ''));
  for (const options of [
    { href: LIVE + '?qa=1' }, { href: LIVE + '?bcc_analytics_debug=invalid' },
    { href: LIVE + '?bcc_analytics_debug=1', blockStorage: true },
    { href: 'http://localhost:8000/ddakfit/' }, { href: 'https://preview.vercel.app/ddakfit/' },
  ]) {
    const excluded = await run(options);
    excluded.exercise();
    assert.equal(gaScripts(excluded).length, 0);
    assert.equal(excluded.events().length, 0);
    assert.match(excluded.elements['links-count'].textContent, /전체 74곳/);
  }
});

test('other pages keep common GA and PostHog behavior; internal exclusions stay excluded', async () => {
  for (const path of ['/', '/tools/', '/ddakfit-other/']) {
    const app = await run({ href: 'https://bccconsulting.kr' + path, commonOnly: true });
    assert.equal(gaScripts(app).length, 1);
    assert.equal(app.commands().filter(row => row[0] === 'config' && row[1] === ID).length, 1);
    assert.equal(app.commands().find(row => row[0] === 'config')[2], undefined);
    assertPostHogUnchanged(app);
    vm.runInContext(common, app.context);
    assert.equal(gaScripts(app).length, 1);
  }
  for (const path of ['/admin', '/gyeol/free/']) {
    const app = await run({ href: 'https://bccconsulting.kr' + path, commonOnly: true });
    assert.equal(gaScripts(app).length, 0);
    assert.equal(app.posthogCalls.length, 0);
  }
});

test('slashless directory canonicalizes in-page and preserves a safe region selection', async () => {
  const app = await run({ href: 'https://bccconsulting.kr/ddakfit#' + 'region=busan' });
  assert.equal(app.window.location.href, LIVE + '#region=busan');
  assert.match(app.elements['links-count'].textContent, /전체 74곳.*19곳/);
  assert.equal(gaScripts(app).length, 1);
  assert.equal(app.events().filter(e => e.name === 'ddakfit_directory_view').length, 1);
  assertPostHogUnchanged(app);
});

// Recommendation events must not carry the selected profile, source URLs, or text.
test('recommendation tracking accepts only fixed states and counts; QA is preserved', async () => {
  const app = await run({ href: LIVE + '?bcc_analytics_debug=1#recommend' });
  const tracker = app.window.BCCDdakfitAnalytics;
  tracker.recommendation('start');
  tracker.recommendation('results', 31);
  tracker.recommendation('results', 'private-value');
  tracker.recommendation('private-value', 99);
  tracker.recommendation('error');
  tracker.recommendation('notice');
  tracker.recommendation('diagnosis');
  const actual = app.events().filter(e => e.name.includes('recommendation'));
  assert.equal(actual.length, 5);
  assert.ok(actual.every(e => e.name.startsWith('qa_')));
  assert.equal(actual[1].params.result_count, 31);
  assert.ok(!JSON.stringify(actual).includes('private-value'));
  assert.equal(app.window.location.href, LIVE + '#recommend');
});

test('AIMAX campaign survives cleanup, reload and recommendation events without arbitrary data', async () => {
  const query = '?utm_source=aimax&utm_medium=partner&utm_campaign=launch';
  for (const href of [LIVE + query + '&email=private-value&utm_content=private-value#recommend', LIVE + query]) {
    const app = await run({ href });
    app.window.BCCDdakfitAnalytics.recommendation('results', 3);
    assert.equal(new URL(app.window.location.href).search, query);
    assert.ok(app.events().every(e => e.params.campaign_source === 'aimax' && e.params.campaign_medium === 'partner' && e.params.campaign_name === 'launch'));
    assert.ok(!JSON.stringify(app.commands()).includes('private-value'));
    assert.equal(app.events().find(e => e.name === 'ddakfit_recommendation_results').params.result_count, 3);
    const reload = await run({ href: app.window.location.href });
    assert.equal(reload.events()[0].params.campaign_source, 'aimax');
  }
  for (const query of ['?utm_source=aimax', '?utm_source=aimax&utm_source=other&utm_medium=partner&utm_campaign=launch', '?utm_source=aimax&utm_medium=partner&utm_campaign=private-value']) {
    const app = await run({ href: LIVE + query });
    assert.equal(app.window.location.href, LIVE);
    assert.ok(app.events().every(e => !e.params.campaign_source));
  }
  const qa = await run({ href: LIVE + query + '&qa=1' });
  assert.equal(qa.events().length, 0);
  const debug = await run({ href: LIVE + query + '&bcc_analytics_debug=1' });
  assert.ok(debug.events().every(e => e.params.campaign_source === 'codex' && e.params.traffic_type === 'qa'));
});
