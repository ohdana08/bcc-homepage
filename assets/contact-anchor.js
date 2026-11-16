/* Keep an explicit contact destination aligned while late media/fonts settle.
 * User interaction immediately releases alignment; no form values or analytics. */
(() => {
  'use strict';
  const form = document.getElementById('bccLeadForm');
  if (!form) return;
  const target = form.closest('.lead-form-card') || form;
  let active = false, observer, frame = 0, expiry;
  function stop() {
    active = false;
    observer?.disconnect();
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(expiry);
  }
  function align() {
    frame = 0;
    if (!active || location.hash !== '#contact') return;
    const header = document.querySelector('.nav');
    const offset = Math.max(0, header?.getBoundingClientRect().bottom || 0) + 16;
    const delta = target.getBoundingClientRect().top - offset;
    if (Math.abs(delta) > 2) window.scrollTo({top: Math.max(0, window.scrollY + delta), behavior: 'instant'});
  }
  function schedule() {
    if (active && !frame) frame = requestAnimationFrame(align);
  }
  function start() {
    stop();
    if (location.hash !== '#contact') return;
    active = true;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(schedule);
      observer.observe(document.body);
    }
    schedule();
    expiry = setTimeout(stop, 30000);
  }
  // Stop before any deliberate scrolling, selection, typing or form interaction.
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(type =>
    window.addEventListener(type, stop, {capture: true, passive: true}));
  window.addEventListener('hashchange', start);
  window.addEventListener('load', schedule);
  document.addEventListener('load', schedule, true);
  document.fonts?.ready.then(schedule);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash === '#contact') {
      // Also handle a repeated click when the hash is already #contact.
      setTimeout(start, 0);
    }
  });
  start();
})();
