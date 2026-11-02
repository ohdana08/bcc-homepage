/* Directory-only analytics. This file never calls the paid product or its APIs.
 * The HTML body also carries bcc-lecture-request to reuse the existing Google
 * tag automatic user-provided-data exclusion: body.bcc-lecture-request and its
 * descendants. Removing that class breaks this page's existing exclusion.
 */
(function () {
  'use strict';
  if (window.BCCDdakfitAnalytics) return;
  const ID = 'G-5TN5XW0T2J';
  const CANONICAL = 'https://bccconsulting.kr/ddakfit/';
  const TITLE = '딱지원핏 | 정부지원사업 공고 사이트 모음부터 사업계획서·IR까지 | BCC';
  const DEBUG_KEY = 'bcc-ddakfit-directory-ga4-debug-v1';
  const REGIONS = ['national', 'busan', 'gyeongnam', 'ulsan'];
  let active = false;
  let debug = false;
  let command;
  let context;
  let viewed = false;

  function stop() {
    active = false;
    try { window['ga-disable-' + ID] = true; } catch { /* Analytics is optional. */ }
  }
  function send(name, parameters) {
    if (!active) return;
    try { command('event', (debug ? 'qa_' : '') + name, { ...context, ...parameters, send_to: ID }); }
    catch { stop(); }
  }
  function validRegion(value) { return REGIONS.includes(value); }
  function validCount(value) { return Number.isInteger(value) && value >= 0; }
  window.BCCDdakfitAnalytics = Object.freeze({
    view(count) {
      if (viewed || !validCount(count)) return;
      viewed = true;
      send('ddakfit_directory_view', { site_count: count });
    },
    region(region) {
      if (validRegion(region)) send('ddakfit_links_region', { region, selected_region: region });
    },
    search(count, selectedRegion) {
      if (!validCount(count) || !validRegion(selectedRegion)) return;
      const parameters = { result_count: count, search_scope: 'all', selected_region: selectedRegion };
      send('ddakfit_links_search', parameters);
      if (count === 0) send('ddakfit_search_no_results', parameters);
    },
    outbound(site, selectedRegion, searchMode) {
      // Called only with a catalog entry, never the user's query or a URL.
      if (!site || typeof site.name !== 'string' || !validRegion(site.region) || !validRegion(selectedRegion)) return;
      send('ddakfit_link_out', {
        site: site.name.slice(0, 100), region: site.region, site_region: site.region,
        selected_region: selectedRegion, search_mode: searchMode ? 'search' : 'region',
      });
    },
  });

  try {
    const url = new URL(window.location.href);
    if (!['https://bccconsulting.kr', 'https://www.bccconsulting.kr'].includes(url.origin) ||
        !['/ddakfit/', '/ddakfit/index.html'].includes(url.pathname) || url.username || url.password) return;
    const hashParameters = new URLSearchParams(url.hash.slice(1));
    if (url.searchParams.has('qa') || hashParameters.has('qa')) return;
    const values = url.searchParams.getAll('bcc_analytics_debug');
    if (values.length && (values.length !== 1 || values[0] !== '1')) return;
    try { debug = values[0] === '1' || window.sessionStorage.getItem(DEBUG_KEY) === '1'; }
    catch { debug = values[0] === '1'; }
    if (debug) {
      try {
        window.sessionStorage.setItem(DEBUG_KEY, '1');
        if (window.sessionStorage.getItem(DEBUG_KEY) !== '1') return;
      } catch { return; }
    }
    if (window['ga-disable-' + ID] === true || typeof window.gtag === 'function' || window.google_tag_manager ||
        document.querySelector('script[src*="googletagmanager.com"], script[src*="google-analytics.com"]')) return;
    if (window.dataLayer && (!Array.isArray(window.dataLayer) || window.dataLayer.length)) return;

    // Keep only known in-page navigation, never search text or arbitrary URL data.
    const safeHash = /^#(?:main|links|find|diagnosis|plan|presentation|continue-title|region=(?:national|busan|gyeongnam|ulsan))$/.test(url.hash) ? url.hash : '';
    window.history.replaceState(null, '', '/ddakfit/' + safeHash);
    const clean = new URL(window.location.href);
    if (clean.search || clean.hash !== safeHash) return;
    context = {
      page_location: CANONICAL, page_title: TITLE, page_referrer: '',
      ...(debug ? { debug_mode: true, traffic_type: 'qa', campaign_source: 'codex', campaign_medium: 'test', campaign_name: 'ddakfit_directory_qa' } : {}),
    };
    const dataLayer = window.dataLayer || [];
    window.dataLayer = dataLayer;
    command = function () { dataLayer.push(arguments); };
    window.gtag = command;
    command('js', new Date());
    const settings = { ...context, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false };
    command('set', settings);
    command('config', ID, settings);
    active = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    script.referrerPolicy = 'no-referrer';
    script.onerror = stop;
    document.head.appendChild(script);
    if (!debug) send('page_view', {});
  } catch { stop(); }
})();
