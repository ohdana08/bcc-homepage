import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const analytics = readFileSync(new URL('ddakfit/analytics.js', ROOT), 'utf8');
const directory = readFileSync(new URL('ddakfit/directory.js', ROOT), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('ddakfit/links.json', ROOT), 'utf8'));
const html = readFileSync(new URL('ddakfit/index.html', ROOT), 'utf8');
const LIVE = 'https://bccconsulting.kr/ddakfit/';
const ID = 'G-5TN5XW0T2J';

class Element {
  constructor() { this.handlers = {}; this.innerHTML = ''; this.textContent = ''; this.value = ''; }
  addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); }
  emit(type, details = {}) { for (const callback of this.handlers[type] || []) callback({ type, ...details }); }
}

async function run(options = {}) {
  const elements = Object.fromEntries(['links-groups', 'links-tabs', 'links-q', 'links-count'].map((id) => [id, new Element()]));
  const scripts = [];
  const requests = [];
  const timers = new Map();
  const storage = options.storage || new Map();
  let timerId = 0;
  const location = { href: options.url || LIVE, get hash() { return new URL(this.href).hash; } };
  const window = {
    location,
    sessionStorage: {
      getItem(key) { if (options.blockedStorage) throw Error('Blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (options.blockedStorage) throw Error('Blocked'); storage.set(key, value); },
    },
    history: { replaceState(_state, _title, path) {
      if (options.historyError) throw Error('Blocked');
      location.href = new URL(path, location.href).href;
    } },
    ...(options.existing || {}),
  };
  const document = {
    getElementById(id) { return elements[id]; },
    querySelector() { return options.existingScript || null; },
    createElement() { return {}; },
    head: { appendChild(script) { scripts.push(script); if (options.loaderFailure) script.onerror(); } },
  };
  const sandbox = {
    window, document, location, URL, URLSearchParams,
    fetch: async (url) => {
      requests.push(url);
      if (options.fetchError) throw Error('Offline');
      return { ok: options.httpOkay !== false, json: async () => {
        if (options.jsonError) throw Error('Invalid JSON');
        return options.data || catalog;
      } };
    },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = vm.createContext(sandbox);
  if (!options.noAnalytics) vm.runInContext(analytics, context);
  const directoryDone = vm.runInContext(directory, context);
  await directoryDone;
  const events = () => (window.dataLayer || []).filter((entry) => entry[0] === 'event').map((entry) => ({ name: entry[1], parameters: entry[2] }));
  function input(value, details) { elements['links-q'].value = value; elements['links-q'].emit('input', details); }
  function flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } }
  function select(region) {
    elements['links-tabs'].emit('click', { target: { closest: () => ({ getAttribute: () => region }) } });
  }
  function outbound(siteName, type = 'click', button = 0) {
    const index = catalog.sites.findIndex((s) => s.name === siteName);
    elements['links-groups'].emit(type, { button, target: { closest: () => ({ getAttribute: () => String(index) }) } });
  }
  return { elements, scripts, requests, window, storage, context, events, input, flushTimers, select, outbound, timers };
}

test('production loads one homepage tag and one view for the 60-site catalog', async () => {
  const app = await run();
  assert.equal(app.scripts.length, 1);
  assert.equal(app.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=' + ID);
  assert.equal(app.events().filter((e) => e.name === 'page_view').length, 1);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_directory_view').length, 1);
  assert.equal(app.events().find((e) => e.name === 'ddakfit_directory_view').parameters.site_count, 60);
  assert.match(app.elements['links-count'].textContent, /전체 60곳.*22곳/);
  assert.deepEqual(app.requests, ['/ddakfit/links.json?v=20261101']);
  vm.runInContext(analytics, app.context);
  assert.equal(app.scripts.length, 1);
});

test('Busan tab then all-region Gyeongnam search attributes the clicked institution to Gyeongnam', async () => {
  const app = await run();
  app.select('busan');
  assert.match(app.elements['links-count'].textContent, /19곳 표시/);
  app.input('경남');
  assert.match(app.elements['links-count'].textContent, /전체 지역 검색 결과 8곳/);
  const site = catalog.sites.find((s) => s.region === 'gyeongnam' && s.name.includes('경남'));
  app.outbound(site.name);
  const click = app.events().find((e) => e.name === 'ddakfit_link_out').parameters;
  assert.equal(click.region, 'gyeongnam');
  assert.equal(click.site_region, 'gyeongnam');
  assert.equal(click.selected_region, 'busan');
  assert.equal(click.search_mode, 'search');
  assert.equal(click.site, site.name);
  app.flushTimers();
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 1);
});

test('zero results count one completed search across idle, Enter and blur, never the raw term', async () => {
  const app = await run();
  const query = 'qa-person@example.test no matching institution';
  app.input(query);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_search_no_results').length, 0);
  app.flushTimers();
  app.elements['links-q'].emit('keydown', { key: 'Enter' });
  app.elements['links-q'].emit('blur');
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_search_no_results').length, 1);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 1);
  const parameters = app.events().find((e) => e.name === 'ddakfit_search_no_results').parameters;
  assert.equal(parameters.result_count, 0);
  assert.equal(parameters.search_scope, 'all');
  assert.ok(!JSON.stringify(app.window.dataLayer).includes(query));
  assert.ok(!JSON.stringify(app.window.dataLayer).includes('search_term'));
  assert.equal(app.window.location.href, LIVE);
});

test('typing quickly does not record intermediate searches and blank queries are not failures', async () => {
  const app = await run();
  app.input('없는');
  app.input('경');
  app.input('경남');
  app.flushTimers();
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 1);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_search_no_results').length, 0);
  app.input('  ');
  app.flushTimers();
  app.elements['links-q'].emit('blur');
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 1);
  app.input('경남');
  app.elements['links-q'].emit('keydown', { key: 'Enter' });
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 2);
});

test('IME composition suppresses premature failures, including composition Enter and blur', async () => {
  const app = await run();
  app.elements['links-q'].emit('compositionstart');
  app.input('ㄱ', { isComposing: true });
  app.flushTimers();
  app.elements['links-q'].emit('keydown', { key: 'Enter', keyCode: 229, isComposing: true });
  app.elements['links-q'].emit('blur');
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 0);
  app.elements['links-q'].value = '경남';
  app.elements['links-q'].emit('compositionend');
  app.input('경남');
  app.flushTimers();
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_links_search').length, 1);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_search_no_results').length, 0);
});

test('region switching flushes the finished search, then clears its pending timer', async () => {
  const app = await run();
  app.input('검색결과없는검증문구');
  app.select('ulsan');
  app.flushTimers();
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_search_no_results').length, 1);
  assert.equal(app.elements['links-q'].value, '');
  assert.match(app.elements['links-count'].textContent, /9곳 표시/);
});

test('middle click is recorded once and right click is not a visit', async () => {
  const app = await run();
  const site = catalog.sites.find((s) => s.region === 'national');
  app.outbound(site.name, 'auxclick', 2);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_link_out').length, 0);
  app.outbound(site.name, 'auxclick', 1);
  assert.equal(app.events().filter((e) => e.name === 'ddakfit_link_out').length, 1);
});

test('QA uses only qa_ custom events, persists across reloads and never emits the real page_view', async () => {
  const app = await run({ url: LIVE + '?bcc_analytics_debug=1#links' });
  app.input('no-matching-result');
  app.flushTimers();
  assert.ok(app.events().every((e) => e.name.startsWith('qa_') && e.parameters.debug_mode === true));
  assert.ok(app.events().some((e) => e.name === 'qa_ddakfit_search_no_results'));
  assert.equal(app.window.location.href, LIVE + '#links');
  const reloaded = await run({ storage: app.storage });
  assert.ok(reloaded.events().every((e) => e.name.startsWith('qa_')));
});

test('arbitrary query, campaign and hash data cannot enter the tag queue or library URL', async () => {
  const app = await run({ url: LIVE + '?q=qa-person%40example.test&utm_campaign=private#secret-value' });
  assert.equal(app.window.location.href, LIVE);
  const queue = JSON.stringify(app.window.dataLayer);
  assert.ok(!queue.includes('qa-person'));
  assert.ok(!queue.includes('secret-value'));
  assert.ok(!queue.includes('private'));
  const config = app.window.dataLayer.find((e) => e[0] === 'config')[2];
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(config.page_referrer, '');
  assert.equal(config.page_location, LIVE);
});

test('known navigation hash survives sanitizing and initializes the requested region', async () => {
  const app = await run({ url: LIVE + '#region=gyeongnam' });
  assert.equal(app.window.location.href, LIVE + '#region=gyeongnam');
  assert.match(app.elements['links-count'].textContent, /10곳 표시/);
});

test('local, preview, wrong path, explicit QA exclusion and invalid debug flags load no Google tag', async () => {
  for (const url of ['http://localhost:8765/ddakfit/', 'https://bcc-preview.vercel.app/ddakfit/',
    'https://ddakfit.bccconsulting.kr/embed', 'https://bccconsulting.kr/lecture-request/',
    LIVE + '?qa=1&bcc_analytics_debug=1', LIVE + '?bcc_analytics_debug=0',
    LIVE + '?bcc_analytics_debug=1&bcc_analytics_debug=1']) {
    const app = await run({ url });
    assert.equal(app.scripts.length, 0, url);
    assert.match(app.elements['links-count'].textContent, /전체 60곳/, url);
  }
});

test('existing tracker or opt-out does not get a second Google tag', async () => {
  for (const existing of [{ gtag() {} }, { google_tag_manager: {} }, { dataLayer: [['config']] }, { ['ga-disable-' + ID]: true }]) {
    const app = await run({ existing });
    assert.equal(app.scripts.length, 0);
    app.select('busan');
    assert.match(app.elements['links-count'].textContent, /19곳 표시/);
  }
});

test('blocked QA storage and failed URL sanitization fail closed without breaking browsing', async () => {
  for (const options of [{ blockedStorage: true, url: LIVE + '?bcc_analytics_debug=1' }, { historyError: true }]) {
    const app = await run(options);
    assert.equal(app.scripts.length, 0);
    app.input('경남');
    assert.match(app.elements['links-count'].textContent, /8곳/);
  }
});

test('missing analytics or failed Google script never blocks search or external links', async () => {
  for (const options of [{ noAnalytics: true }, { loaderFailure: true }]) {
    const app = await run(options);
    app.select('busan');
    app.input('경남');
    app.flushTimers();
    assert.match(app.elements['links-count'].textContent, /8곳/);
    assert.match(app.elements['links-groups'].innerHTML, /target="_blank" rel="noopener"/);
    assert.equal(app.events().length, 0);
  }
});

test('HTTP, network, JSON and schema failures are not counted as successful views or zero searches', async () => {
  for (const options of [{ httpOkay: false }, { fetchError: true }, { jsonError: true }, { data: { regions: [], sites: [] } }]) {
    const app = await run(options);
    app.input('경남');
    app.flushTimers();
    assert.match(app.elements['links-groups'].innerHTML, /목록을 불러오지 못했습니다/);
    assert.ok(!app.events().some((e) => /ddakfit/.test(e.name)));
  }
});

test('HTML explains login scope and preserves every product entry URL', () => {
  assert.match(html, /기관 사이트 60곳/);
  assert.match(html, /공고 사이트 모음은 로그인 없이 이용할 수 있습니다/);
  assert.match(html, /AI 공고 찾기·진단·사업계획서·IR 기능은 Google 로그인이 필요합니다/);
  assert.match(html, /<body class="bcc-ddakfit-directory bcc-lecture-request">/);
  const productLinks = [...html.matchAll(/href="(https:\/\/ddakfit\.bccconsulting\.kr[^\"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(productLinks, [
    'https://ddakfit.bccconsulting.kr/embed', 'https://ddakfit.bccconsulting.kr/embed?start=find',
    'https://ddakfit.bccconsulting.kr/embed?start=direct', 'https://ddakfit.bccconsulting.kr/embed',
    'https://ddakfit.bccconsulting.kr/embed', 'https://ddakfit.bccconsulting.kr/embed',
    'https://ddakfit.bccconsulting.kr/embed', 'https://ddakfit.bccconsulting.kr/',
  ]);
});

test('all directory inputs inherit the existing Google automatic-user-data exclusion without importing intake styles or scripts', () => {
  const body = html.match(/<body class="bcc-ddakfit-directory bcc-lecture-request">([\s\S]*)<\/body>/);
  assert.ok(body, 'The existing body.bcc-lecture-request exclusion must match before Google loads.');
  assert.match(body[1], /<input\b[^>]*id="links-q"/);
  assert.equal((body[1].match(/<(?:input|select|textarea)\b/g) || []).length, (html.match(/<(?:input|select|textarea)\b/g) || []).length);
  const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(styles, ['/ddakfit/style.css?v=20261031']);
  const css = readFileSync(new URL('ddakfit/style.css', ROOT), 'utf8');
  assert.doesNotMatch(css, /bcc-lecture-request/);
  assert.doesNotMatch(html, /(?:src|href)="\/lecture-request\//);
});
