/* Inquiry funnel v1. Only fixed enums are sent; never form values or receipt IDs.
 * PostHog only: existing GA4 tracking retains its own conversion definitions. */
(() => {
  'use strict';
  const pages = {'/':'home','/index.html':'home','/claude101.html':'claude_intro','/tools.html':'tools','/employment-tools/':'tools','/employment-tools/index.html':'tools','/startup-tools/':'tools','/startup-tools/index.html':'tools','/work-tools/':'tools','/work-tools/index.html':'tools','/ai-automation-education/':'automation','/ai-automation-education/index.html':'automation','/geo-education/':'geo','/geo-education/index.html':'geo','/lecture-request/':'lecture_request','/lecture-request/index.html':'lecture_request'};
  const url = new URL(location.href);
  const page = pages[url.pathname];
  if (!page || !['https://bccconsulting.kr','https://www.bccconsulting.kr'].includes(url.origin)) return;
  const privateUrl = () => {
    const u = new URL(location.href);
    return [...u.searchParams.keys(), ...new URLSearchParams(u.hash.slice(1)).keys()].some(k => /^(receipt|key)$/i.test(k)) || u.searchParams.get('mode') === 'edit';
  };
  if (privateUrl()) return;
  const read = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const write = (k,v) => { try { sessionStorage.setItem(k,v); } catch {} };
  const test = new URLSearchParams(url.hash.slice(1)).has('qa') || url.searchParams.has('qa') || url.searchParams.has('bcc_analytics_debug') || read('bcc-inquiry-test') === '1' || read('bcc-lecture-request-ga4-debug-v1') === '1';
  if (test) write('bcc-inquiry-test','1');
  let stopped = false;
  let source = 'direct_or_unknown';
  try { const ref = new URL(document.referrer); if (ref.origin === url.origin) source = pages[ref.pathname] || 'other_internal'; } catch {}
  // A fixed source marker survives referrer suppression/new-tab navigation.
  const marker = window.BCCInquiryEntryFrom || url.searchParams.get('inquiry_from');
  if (Object.values(pages).includes(marker)) source = marker;
  let cta = null;
  try { cta = JSON.parse(read('bcc-inquiry-cta') || 'null'); } catch {}
  if (!Object.values(pages).includes(marker) && cta && Object.values(pages).includes(cta.page) && Number.isFinite(cta.at) && Date.now()-cta.at >= 0 && Date.now()-cta.at < 30*60*1000) source = cta.page;
  const seen = new Set();
  function emit(stage, form, extra = {}, once = false) {
    if (stopped || privateUrl()) return;
    const key = stage + ':' + form + ':' + (extra.step_number || '');
    if (once && seen.has(key)) return;
    try {
      if (typeof window.posthog?.capture !== 'function') return;
      window.posthog.capture('inquiry_' + stage, {schema_version:1, page_group:page, source_page:source, form_kind:form, is_test:test, ...extra});
      if (once) seen.add(key);
    } catch {} // Analytics must never interrupt navigation or submission.
  }
  const receipts = new Set();
  window.BCCInquiry = Object.freeze({
    isTest: test,
    simple(stage) {
      if (!['submit_attempt','submit_success','submit_error','validation_error'].includes(stage)) return;
      emit(stage,'simple');
    },
    detail(method,value) {
      if (page !== 'lecture_request') return;
      if (method === 'stop') { stopped = true; try { window.posthog?.stopSessionRecording?.(); } catch {} return; }
      if (method === 'start') emit('form_start','detailed',{},true);
      if (method === 'step' && Number.isInteger(value) && value >= 2 && value <= 5) {
        emit('form_start','detailed',{},true);
        emit('step_view','detailed',{step_number:value},true);
      }
      if (method === 'skip_to_review') emit('optional_steps_skipped','detailed');
      if (method === 'submit_attempt' || method === 'submit_error' || method === 'validation_error') emit(method,'detailed', Number.isInteger(value) && value >= 1 && value <= 5 ? {step_number:value} : {});
      if (method === 'complete' && typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) && !receipts.has(value)) {
        emit('submit_success','detailed'); receipts.add(value);
      }
    }
  });
  emit('page_view','none',{},true);
  if (page === 'lecture_request') emit('form_view','detailed',{},true);
  document.addEventListener('click', event => {
    const a = event.target.closest?.('a[href]'); if (!a) return;
    let target; try { target = new URL(a.href,location.href); } catch { return; }
    let kind;
    if (target.origin === url.origin && /^\/lecture-request\/(?:index\.html)?$/.test(target.pathname)) kind='detailed';
    else if (target.origin === url.origin && target.hash === '#contact' && pages[target.pathname]) kind='simple';
    else if (target.protocol === 'tel:') kind='phone';
    else if (target.hostname === 'pf.kakao.com') kind='kakao';
    if (!kind) return;
    const placement = a.closest('.mobile-conversion-bar') ? 'mobile_sticky' : a.closest('header,nav,.nav') ? 'navigation' : a.closest('footer') ? 'footer' : a.closest('#contact') ? 'contact' : a.closest('.hero') ? 'hero' : 'body';
    emit('cta_click',kind,{placement});
    if (kind === 'simple' || kind === 'detailed') {
      write('bcc-inquiry-cta',JSON.stringify({page,at:Date.now()}));
      const sameDocument = target.origin === location.origin && target.pathname === location.pathname && target.search === location.search;
      if (sameDocument) source = page;
      else { target.searchParams.set('inquiry_from',page); a.href = target.href; }
    }
  },true);
  const form = document.getElementById('bccLeadForm');
  if (form) {
    const viewed = () => emit('form_view','simple',{},true);
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { viewed(); observer.disconnect(); } },{threshold:0.1}); observer.observe(form);
    }
    ['input','change'].forEach(type => form.addEventListener(type,event => {
      if (!event.isTrusted || !['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName) || event.target.name === 'website') return;
      viewed(); emit('form_start','simple',{},true);
    }));
  }
})();
