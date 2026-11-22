/* Free, rule-based matching through the existing Ddakfit catalogue.
 * Conditions live only in this form; never send them to analytics or storage. */
(function () {
  'use strict';
  const form = document.getElementById('recommendation-form');
  if (!form) return;
  const button = document.getElementById('recommendation-submit');
  const status = document.getElementById('recommendation-status');
  const results = document.getElementById('recommendation-results');
  const selection = document.getElementById('recommendation-selection');
  const list = document.getElementById('recommendation-list');
  let controller;
  let revision = 0;

  function track(state, count) {
    try { window.BCCDdakfitAnalytics?.recommendation(state, count); } catch { /* Optional. */ }
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function renderCard(card) {
    const url = safeUrl(card.url);
    if (!url) throw new Error('Invalid notice');
    const item = node('li', undefined, 'recommendation-card');
    item.append(node('p', '조건으로 찾은 후보 · 신청 자격은 공고문에서 확인', 'recommendation-label'));
    item.append(node('h3', card.title));
    item.append(node('p', card.description, 'recommendation-description'));
    const detail = node('dl');
    for (const [label, value] of [['지원 대상', card.who], ['지원 규모', card.amount], ['신청 마감', card.deadline]]) {
      detail.append(node('dt', label), node('dd', value));
    }
    item.append(detail);
    const actions = node('div', undefined, 'recommendation-actions');
    const original = node('a', '공식 공고 보기 ↗', 'button secondary');
    original.href = url;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    original.addEventListener('click', () => track('notice'));
    const diagnosis = node('a', '이 공고로 진단받기 →', 'button');
    diagnosis.href = '#diagnosis';
    diagnosis.addEventListener('click', (event) => {
      event.preventDefault();
      if (openNoticeDiagnosis(url)) track('diagnosis');
    });
    actions.append(original, diagnosis);
    item.append(actions, node('p', '진단은 Google 로그인 후 공고문·양식을 첨부해 진행합니다.', 'hint'));
    return item;
  }
  function reset() {
    revision += 1;
    controller?.abort();
    controller = undefined;
    button.disabled = false;
    button.textContent = '내 조건으로 지원사업 찾기 →';
    form.removeAttribute('aria-busy');
    results.hidden = true;
    list.replaceChildren();
    status.textContent = '조건을 선택한 뒤 찾기 버튼을 눌러주세요.';
  }
  form.addEventListener('change', reset);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    reset();
    const current = revision;
    controller = new AbortController();
    const request = controller;
    const timeout = setTimeout(() => request.abort(), 22000);
    const fields = ['age', 'region', 'business', 'industry'];
    const body = Object.fromEntries(fields.map((name) => [name, form.elements.namedItem(name).value]));
    const labels = fields.map((name) => form.elements.namedItem(name).selectedOptions[0].textContent);
    button.disabled = true;
    button.textContent = '지원사업을 찾고 있어요…';
    form.setAttribute('aria-busy', 'true');
    status.textContent = '수집된 공고에서 선택한 조건에 맞는 후보를 찾고 있어요.';
    track('start');
    try {
      const response = await fetch('/api/ddakfit-recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        body: JSON.stringify(body), signal: request.signal,
      });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!Array.isArray(data.results) || !Number.isSafeInteger(data.total) || data.total < data.results.length ||
          data.results.length > 3 || (data.total > 0 && data.results.length === 0)) throw new Error('Invalid response');
      const cards = data.results.map(renderCard);
      if (current !== revision) return;
      list.replaceChildren(...cards);
      selection.textContent = '선택한 조건: ' + labels.join(' · ');
      results.hidden = false;
      status.textContent = data.total
        ? `수집된 공고에서 후보 ${data.total}건을 찾았습니다. 이 중 ${cards.length}건을 먼저 보여드려요.`
        : '현재 수집한 공고 중 선택한 조건에 맞는 후보를 찾지 못했어요. 조건을 다시 확인하거나 아래 공고 사이트 모음에서 직접 찾아보세요.';
      track('results', data.total);
      status.focus({ preventScroll: true });
      status.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    } catch {
      if (current !== revision) return;
      results.hidden = true;
      status.textContent = '공고를 불러오지 못했어요. 잠시 후 찾기 버튼을 다시 눌러주세요. 아래 공고 사이트 모음은 계속 이용할 수 있습니다.';
      track('error');
      status.focus({ preventScroll: true });
    } finally {
      clearTimeout(timeout);
      if (current === revision) {
        controller = undefined;
        button.disabled = false;
        button.textContent = '내 조건으로 지원사업 찾기 →';
        form.removeAttribute('aria-busy');
      }
    }
  });
})();
