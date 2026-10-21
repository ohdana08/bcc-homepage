/*
 * The intake tracker accepts no form data. Receipt IDs are used only for local
 * duplicate suppression, never as Analytics parameters or network payloads.
 * Google settings: automatic form, site-search, outbound and history tracking
 * must remain disabled for this stream. The form works without this file/GA.
 */
(() => {
  'use strict';
  const MEASUREMENT_ID = 'G-5TN5XW0T2J';
  const CANONICAL = 'https://bccconsulting.kr/lecture-request/';
  const TITLE = '강의 의뢰 | BCC 비즈니스커리어컨설팅';
  const COMPLETED_KEY = 'bcc-lecture-request-ga4-completed-v1';
  const DEBUG_KEY = 'bcc-lecture-request-ga4-debug-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STEP_NAMES = Object.freeze({ 2: 'audience_goals', 3: 'schedule_environment', 4: 'budget_requests', 5: 'review_consent' });
  const seen = new Set();
  const completed = new Set();
  let active = false;
  let debug = false;
  let sendCommand = null;
  let safeContext = null;

  function readStorage(key) {
    try { return window.sessionStorage.getItem(key); } catch { return null; }
  }
  function writeStorage(key, value) {
    try { window.sessionStorage.setItem(key, value); } catch { /* Tracking never blocks the form. */ }
  }
  function isPrivate(url) {
    const hash = new URLSearchParams(url.hash.slice(1));
    return [...hash.keys(), ...url.searchParams.keys()].some((key) => ['receipt', 'key'].includes(key.toLowerCase())) || url.searchParams.get('mode') === 'edit';
  }
  function stop() {
    active = false;
    // This flag also disables automatic GA events while the same document is
    // used for the rare changed-retry draft recovery (which stays in memory).
    try { window['ga-disable-' + MEASUREMENT_ID] = true; } catch { /* Best effort, no form dependency. */ }
  }
  function send(name, parameters = {}) {
    if (!active || !sendCommand) return false;
    try {
      const current = new URL(window.location.href);
      if (isPrivate(current)) { stop(); return false; }
      sendCommand('event', (debug ? 'qa_' : '') + name, { ...safeContext, ...parameters, send_to: MEASUREMENT_ID });
      return true;
    } catch { stop(); return false; }
  }
  function once(name, parameters) {
    if (seen.has(name)) return;
    if (send(name, parameters)) seen.add(name);
  }
  function start() { once('lecture_request_start'); }
  function step(number) {
    if (!Number.isInteger(number) || !STEP_NAMES[number]) return;
    // A valid move past the first form step also confirms a start when a
    // browser autofilled/restored fields without firing an input event.
    if (number === 2) start();
    once('lecture_request_step_' + number, { step_number: number, step_name: STEP_NAMES[number] });
  }
  function complete(localReceipt) {
    if (typeof localReceipt !== 'string' || !UUID.test(localReceipt) || !active) return;
    // A receipt can only deduplicate local attempts, never enter the dataLayer.
    const localKey = (debug ? 'qa:' : 'live:') + localReceipt.toLowerCase();
    if (completed.has(localKey)) return;
    if (send('lecture_request_complete')) {
      completed.add(localKey);
      writeStorage(COMPLETED_KEY, JSON.stringify([...completed].slice(-100)));
    }
  }
  window.BCCLectureAnalytics = Object.freeze({ start, step, complete, stop });

  try {
    const url = new URL(window.location.href);
    const allowedOrigin = ['https://bccconsulting.kr', 'https://www.bccconsulting.kr'].includes(url.origin) && !url.username && !url.password;
    const allowedPath = ['/lecture-request/', '/lecture-request/index.html'].includes(url.pathname);
    const hash = new URLSearchParams(url.hash.slice(1));
    if (!allowedOrigin || !allowedPath || isPrivate(url) || url.searchParams.has('qa') || hash.has('qa')) return;
    // Explicit local/preview/QA exclusion takes priority over debug mode.
    const debugValues = url.searchParams.getAll('bcc_analytics_debug');
    if (debugValues.length && (debugValues.length !== 1 || debugValues[0] !== '1')) return;
    debug = debugValues[0] === '1' || readStorage(DEBUG_KEY) === '1';
    if (debug) {
      writeStorage(DEBUG_KEY, '1');
      // Do not remove the explicit QA marker unless a reload can recover it.
      // With blocked storage, leave the URL intact and never load Google.
      if (readStorage(DEBUG_KEY) !== '1') return;
    }
    if (window['ga-disable-' + MEASUREMENT_ID] === true) return;
    // This page owns one direct Google tag. Do not attach a second tracker if
    // a tag manager or another GA loader has unexpectedly been added to it.
    if (typeof window.gtag === 'function' || window.google_tag_manager || document.querySelector('script[src*="googletagmanager.com"], script[src*="google-analytics.com"]')) return;
    if (window.dataLayer && (!Array.isArray(window.dataLayer) || window.dataLayer.length > 0)) return;

    const campaign = {};
    const allowedCampaign = {
      utm_source: ['campaign_source', 'kakao'],
      utm_medium: ['campaign_medium', 'messenger'],
      utm_campaign: ['campaign_name', 'lecture_request'],
      utm_content: ['campaign_content', 'channel_reply'],
    };
    for (const [query, [field, allowed]] of Object.entries(allowedCampaign)) {
      const values = url.searchParams.getAll(query);
      if (values.length === 1 && values[0] === allowed) campaign[field] = allowed;
    }
    const entryChannel = debug ? 'qa' : Object.keys(campaign).length === 4 ? 'kakao_channel' : 'other';
    if (debug) Object.assign(campaign, { campaign_source: 'codex', campaign_medium: 'test', campaign_name: 'lecture_request_qa', campaign_content: 'validation' });

    // The library must never observe an arbitrary query/hash, including gclid,
    // free-text UTM values or accidental contact details in a pasted URL.
    // If URL sanitizing fails, fail closed without loading Google.
    window.history.replaceState(null, '', '/lecture-request/');
    const cleanUrl = new URL(window.location.href);
    if (cleanUrl.search || cleanUrl.hash) return;
    safeContext = { page_location: CANONICAL, page_title: TITLE, page_referrer: '', entry_channel: entryChannel, ...campaign, ...(debug ? { debug_mode: true } : {}) };

    try {
      const stored = JSON.parse(readStorage(COMPLETED_KEY) || '[]');
      if (Array.isArray(stored)) stored.slice(-100).forEach((value) => {
        if (typeof value === 'string' && /^(qa|live):/.test(value) && UUID.test(value.slice(value.indexOf(':') + 1))) completed.add(value);
      });
    } catch { /* Invalid/blocked storage affects analytics only. */ }

    const dataLayer = window.dataLayer || [];
    window.dataLayer = dataLayer;
    sendCommand = function () { dataLayer.push(arguments); };
    window.gtag = sendCommand;
    sendCommand('js', new Date());
    sendCommand('set', { ...safeContext, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    sendCommand('config', MEASUREMENT_ID, { ...safeContext, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
    active = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    script.referrerPolicy = 'no-referrer';
    script.onerror = stop;
    document.head.appendChild(script);
    if (!debug) once('page_view');
    once('lecture_request_view');
    window.addEventListener('hashchange', () => {
      try { if (isPrivate(new URL(window.location.href))) stop(); } catch { stop(); }
    });
  } catch { stop(); }
})();
