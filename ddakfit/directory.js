(async function () {
  'use strict';
  const wrap = document.getElementById('links-groups');
  const tabs = document.getElementById('links-tabs');
  const q = document.getElementById('links-q');
  const count = document.getElementById('links-count');
  if (!wrap || !tabs || !q || !count) return;
  let data;
  try {
    const response = await fetch('/ddakfit/links.json?v=20261101');
    if (!response.ok) throw new Error('Directory unavailable');
    data = await response.json();
    if (!Array.isArray(data.regions) || !data.regions.length || !Array.isArray(data.sites) || !data.sites.length ||
        !data.regions.every((r) => typeof r.id === 'string' && typeof r.label === 'string') ||
        !data.sites.every((s) => ['name', 'url', 'region', 'cat', 'who', 'what'].every((key) => typeof s[key] === 'string') &&
          /^https?:\/\//.test(s.url) && data.regions.some((r) => r.id === s.region))) throw new Error('Invalid directory');
  } catch {
    wrap.innerHTML = '<p class="links-note">목록을 불러오지 못했습니다. 새로고침해 주세요.</p>';
    return; // Loading failure is not a zero-result search.
  }
  let region = (location.hash.match(/^#region=(\w+)$/) || [])[1] || 'national';
  if (!data.regions.some((r) => r.id === region)) region = 'national';
  let timer;
  let composing = false;
  let lastSearch = '';
  let visibleSites = [];
  function track(method, ...args) {
    try { window.BCCDdakfitAnalytics?.[method](...args); } catch { /* Never block browsing. */ }
  }
  function keyword() { return (q.value || '').trim().toLowerCase(); }
  function esc(value) {
    return String(value || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function matches(term) {
    return data.sites.filter((s) => term ? (s.name + s.cat + s.who + s.what).toLowerCase().includes(term) : s.region === region);
  }
  function render() {
    const term = keyword();
    visibleSites = matches(term);
    tabs.innerHTML = data.regions.map((r) => '<button type="button" role="tab" aria-selected="' +
      (r.id === region && !term) + '" data-r="' + esc(r.id) + '">' + esc(r.label) + ' <small>' +
      data.sites.filter((s) => s.region === r.id).length + '</small></button>').join('');
    count.textContent = '전체 ' + data.sites.length + '곳 · ' + (term ? '전체 지역 검색 결과 ' + visibleSites.length + '곳' : '지금 ' + visibleSites.length + '곳 표시');
    const categories = [...new Set(visibleSites.map((s) => s.cat))];
    wrap.innerHTML = categories.map((category) => {
      const items = visibleSites.filter((s) => s.cat === category);
      return '<div class="links-group"><h3>' + esc(category) + ' <small>' + items.length + '</small></h3><ul class="links-list">' +
        items.map((s) => '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener" data-site-index="' + data.sites.indexOf(s) +
          '" data-site="' + esc(s.name) + '" data-region="' + esc(s.region) + '"><b>' + esc(s.name) +
          ' <span aria-hidden="true">↗</span></b><span class="who">' + esc(s.who) + '</span><span class="what">' +
          esc(s.what) + '</span>' + (s.tip ? '<span class="tip">팁 · ' + esc(s.tip) + '</span>' : '') + '</a></li>').join('') + '</ul></div>';
    }).join('') || '<p class="links-note">검색 결과가 없습니다. 다른 말로 찾아보세요.</p>';
  }
  function cancelTimer() { clearTimeout(timer); }
  function recordSearch() {
    cancelTimer();
    if (composing) return;
    const term = keyword();
    if (!term) { lastSearch = ''; return; }
    const resultCount = matches(term).length;
    // Term stays in this document's memory only; no storage, URL, hash or telemetry.
    const key = term + '\u0000' + resultCount;
    if (key === lastSearch) return;
    lastSearch = key;
    track('search', resultCount, region);
  }
  function onInput(event) {
    render();
    cancelTimer();
    if (!keyword()) { lastSearch = ''; return; }
    if (!composing && !event?.isComposing) timer = setTimeout(recordSearch, 800);
  }
  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-r]');
    if (!button) return;
    const nextRegion = button.getAttribute('data-r');
    if (!data.regions.some((r) => r.id === nextRegion)) return;
    recordSearch();
    cancelTimer();
    region = nextRegion;
    q.value = '';
    lastSearch = '';
    render();
    track('region', region);
  });
  q.addEventListener('input', onInput);
  q.addEventListener('compositionstart', () => { composing = true; cancelTimer(); });
  q.addEventListener('compositionend', () => { composing = false; onInput(); });
  q.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && !composing && event.keyCode !== 229) recordSearch();
  });
  q.addEventListener('blur', recordSearch);
  function onOutbound(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest('a[data-site-index]');
    if (!link) return;
    const index = Number(link.getAttribute('data-site-index'));
    const site = data.sites[index];
    if (!Number.isInteger(index) || !site || !visibleSites.includes(site)) return;
    recordSearch();
    track('outbound', site, region, Boolean(keyword()));
  }
  wrap.addEventListener('click', onOutbound);
  wrap.addEventListener('auxclick', onOutbound);
  render();
  track('view', data.sites.length);
})();
