/*
 * BCC 공통 분석 스크립트 — GA4 + PostHog
 * 2026-11-07 사용자 승인(BCC_Brain/CLAUDE.md "SEO/GEO 유입과 전환 병목 관찰").
 *
 * - GA4: 페이지에 이미 G-5TN5XW0T2J 스니펫이 있으면 다시 로드하지 않는다.
 * - PostHog: POSTHOG_KEY가 비어 있으면 아무것도 하지 않는다(가입 후 키만 넣으면 동작).
 * - 개인정보: 모든 입력값·개인정보 요소 마스킹, 텍스트 복사 캡처 끔, URL 쿼리에서 토큰·이메일 제거,
 *   어드민·수강실·마이페이지에서는 세션 리플레이를 켜지 않는다.
 */
(function () {
  'use strict';

  var GA4_ID = 'G-5TN5XW0T2J';
  var POSTHOG_KEY = '';                          // ← PostHog 프로젝트 API 키(phc_...)를 여기에 넣는다
  var POSTHOG_HOST = 'https://us.i.posthog.com'; // EU 리전이면 https://eu.i.posthog.com

  var path = location.pathname;

  // 어드민·내부 페이지는 측정 자체를 하지 않는다.
  if (/^\/admin/.test(path) || /^\/gyeol\//.test(path)) return;

  // 로그인·구매자 전용 영역: 페이지뷰만 보내고 세션 리플레이는 끈다.
  var NO_REPLAY = /^\/(mypage\.html|course-claude101-pro\.html|signup\.html|success\.html|fail\.html)$/.test(path);

  /* ---------- GA4 ---------- */
  if (!document.querySelector('script[src*="gtag/js?id=' + GA4_ID + '"]')) {
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID);
  }

  /* ---------- PostHog ---------- */
  if (!POSTHOG_KEY) return;

  // 쿼리스트링에서 개인정보·토큰으로 보이는 값을 지운다.
  var SENSITIVE_PARAM = /^(token|access_token|key|email|phone|name|tel|code|session|order|orderId|paymentKey|customerKey)$/i;
  function scrubUrl(u) {
    try {
      var url = new URL(u, location.origin);
      var drop = [];
      url.searchParams.forEach(function (_, k) { if (SENSITIVE_PARAM.test(k)) drop.push(k); });
      drop.forEach(function (k) { url.searchParams.set(k, '[redacted]'); });
      return url.toString();
    } catch (e) { return u; }
  }

  // 공식 스니펫(posthog-js) — 배열 스텁을 만들고 라이브러리를 비동기로 로드한다.
  !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split("."); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } } (p = t.createElement("script")).type = "text/javascript", p.crossOrigin = "anonymous", p.async = !0, p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js", (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = "posthog", u.people = u.people || [], u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e }, u.people.toString = function () { return u.toString(1) + ".people (stub)" }, o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "), n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]) }, e.__SV = 1) }(document, window.posthog || []);

  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',   // 익명 방문자는 프로필을 만들지 않는다
    capture_pageview: true,
    capture_pageleave: true,              // 체류시간·이탈 계산용
    respect_dnt: true,
    disable_session_recording: NO_REPLAY,
    autocapture: {
      capture_copied_text: false,
      element_allowlist: ['a', 'button', 'form', 'input', 'select', 'textarea', 'label']
    },
    mask_all_element_attributes: false,
    mask_all_text: false,                 // 본문 텍스트는 공개 콘텐츠이므로 보존
    session_recording: {
      maskAllInputs: true,                // 모든 입력값은 **** 처리
      maskTextSelector: 'input, textarea, select, [data-pii], .pii, [type="email"], [type="tel"]',
      blockSelector: '[data-ph-block], iframe',
      recordCrossOriginIframes: false
    },
    sanitize_properties: function (props) {
      if (props.$current_url) props.$current_url = scrubUrl(props.$current_url);
      if (props.$referrer) props.$referrer = scrubUrl(props.$referrer);
      if (props.$pathname && /\/(mypage|course-)/.test(props.$pathname)) props.$title = '[masked]';
      return props;
    }
  });
})();
