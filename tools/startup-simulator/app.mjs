import { DEFAULT_INPUT, PRESETS, validate, calculate, simulate, compareScenarios } from './model.mjs';

const $ = (selector) => document.querySelector(selector);
const numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const fmt = (value) => numberFormat.format(Math.round(value));
const won = (value) => `${fmt(value)}원`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const STORAGE_KEY = 'bcc-startup-simulator:v1';
const fields = [
  { key: 'name', label: '내 사업 이름', type: 'text', group: 'sales', full: true, maxLength: 80 },
  { key: 'businessType', label: '판매 단위 유형', type: 'select', group: 'sales', full: true },
  { key: 'price', label: '평균 판매 가격', unit: '원', group: 'sales', min: 1, max: 1e9, step: 1, hint: '판매 1건당 · 부가세 제외' },
  { key: 'dailySales', label: '하루 판매 건수', unit: '건', group: 'sales', min: 0, max: 100000, step: 1, hint: '정상 매출일 때의 하루 평균' },
  { key: 'days', label: '월 영업일', unit: '일', group: 'sales', min: 1, max: 31, step: 1 },
  { key: 'unitCost', label: '판매 1건당 원가', unit: '원', group: 'cost', min: 0, max: 1e9, step: 1, hint: '재료·포장·배송 등 · 수수료 제외' },
  { key: 'feePct', label: '판매 수수료율', unit: '%', group: 'cost', min: 0, max: 100, step: 'any', hint: '입력한 판매가 기준 매출 비례 수수료' },
  { key: 'rent', label: '월 임대료', unit: '원', group: 'cost', min: 0, max: 1e12, step: 1 },
  { key: 'labor', label: '월 직원 인건비', unit: '원', group: 'cost', min: 0, max: 1e12, step: 1, hint: '직원 관련 부담금 포함' },
  { key: 'otherFixed', label: '기타 월 고정비', unit: '원', group: 'cost', min: 0, max: 1e12, step: 1, full: true, hint: '공과금·보험·구독료·고정 광고비 등' },
  { key: 'ownerPay', label: '사장님 월 생활비', unit: '원', group: 'owner', min: 0, max: 1e12, step: 1, full: true },
  { key: 'startupCost', label: '초기 투자 비용', unit: '원', group: 'cash', min: 0, max: 1e12, step: 1, hint: '시설·장비·오픈 준비 비용' },
  { key: 'deposit', label: '임대 보증금', unit: '원', group: 'cash', min: 0, max: 1e12, step: 1, hint: '12개월 동안 묶여 있는 돈' },
  { key: 'availableCash', label: '총 준비 자금', unit: '원', group: 'cash', min: 0, max: 1e12, step: 1, full: true, hint: '초기 투자와 보증금 지출 전 금액' },
  { key: 'firstMonthPct', label: '첫 달 매출 수준', unit: '%', group: 'growth', min: 0, max: 100, step: 'any', hint: '정상 매출의 몇 %로 시작할지' },
  { key: 'growthPct', label: '월 매출 성장률', unit: '%', group: 'growth', min: 0, max: 100, step: 'any', hint: '전월 판매량 대비 증가율' },
];
const typeLabels = { cafe: '카페·외식 · 주문 1회', shop: '온라인 판매 · 주문 1회', class: '클래스 · 수강생 1명', service: '1인 서비스 · 계약 1건' };
const icons = {
  cafe: '<path d="M4 9h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9ZM16 10h2a3 3 0 0 1 0 6h-2M7 3v3m4-4v4m4-3v3M2 22h19"/>',
  shop: '<path d="M4 8h16l1 13H3L4 8ZM8 9V6a4 4 0 0 1 8 0v3M8 12h.01M16 12h.01"/>',
  class: '<path d="m3 8 9-5 9 5-9 5-9-5ZM6 10v7c4 3 8 3 12 0v-7M21 8v9M20 21h2M21 17v4"/>',
  service: '<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 7h18v14H3V7ZM3 12l9 3 9-3M10 14v3h4v-3"/>',
};
let currentInput = { ...DEFAULT_INPUT };
let latestResult = null;
let latestSimulation = null;
let selectedPresetId = PRESETS.find((preset) => preset.input.businessType === DEFAULT_INPUT.businessType)?.id || '';

function renderFields() {
  for (const field of fields) {
    const descriptionIds = [field.hint ? `${field.key}-hint` : '', `${field.key}-error`].filter(Boolean).join(' ');
    const common = `id="${field.key}" name="${field.key}" aria-describedby="${descriptionIds}"`;
    let input;
    if (field.type === 'select') {
      input = `<select ${common}>${Object.entries(typeLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><span class="input-unit" aria-hidden="true">⌄</span>`;
    } else if (field.type === 'text') {
      input = `<input ${common} type="text" maxlength="${field.maxLength}" autocomplete="off" placeholder="예: 나의 작은 동네 카페">`;
    } else {
      input = `<input ${common} type="number" inputmode="${field.step === 'any' ? 'decimal' : 'numeric'}" min="${field.min}" max="${field.max}" step="${field.step}" required><span class="input-unit" aria-hidden="true">${field.unit}</span>`;
    }
    $(`#${field.group}-fields`).insertAdjacentHTML('beforeend', `<div class="field${field.full ? ' full-width' : ''}"><label for="${field.key}">${field.label}${field.unit ? `<span class="sr-only"> (${field.unit})</span>` : ''}</label><div class="input-wrap">${input}</div>${field.hint ? `<p class="field-hint" id="${field.key}-hint">${field.hint}</p>` : ''}<p class="field-error" id="${field.key}-error" hidden></p></div>`);
  }
}

function renderPresets() {
  $('#preset-options').innerHTML = PRESETS.map((preset) => `<button type="button" class="preset-card" data-preset="${escapeHTML(preset.id)}" aria-pressed="${preset.id === selectedPresetId}"><span class="preset-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[preset.input.businessType] || icons.service}</svg></span><span><strong>${escapeHTML(preset.label)}</strong><small>${escapeHTML(preset.description)}</small></span><span class="preset-check" aria-hidden="true">✓</span></button>`).join('');
}

function populateForm(input) {
  fields.forEach((field) => { $(`#${field.key}`).value = input[field.key]; });
  currentInput = { ...input };
}

function readForm() {
  return Object.fromEntries(fields.map((field) => {
    const raw = $(`#${field.key}`).value;
    return [field.key, field.type ? raw : raw.trim() === '' ? NaN : Number(raw)];
  }));
}

function validateForm() {
  const validation = validate(currentInput);
  for (const field of fields) {
    const error = validation.errors[field.key];
    const input = $(`#${field.key}`);
    const message = $(`#${field.key}-error`);
    input.setAttribute('aria-invalid', error ? 'true' : 'false');
    message.textContent = error || '';
    message.hidden = !error;
  }
  $('#validation-summary').hidden = validation.valid;
  $('#results').hidden = !validation.valid;
  $('#cash-section').hidden = !validation.valid;
  $('#print-assumptions').hidden = !validation.valid;
  $('#save-plan').disabled = !validation.valid;
  $('#print-report').disabled = !validation.valid;
  $('#validation-list').innerHTML = Object.entries(validation.errors).map(([key, error]) => `<li><a href="#${escapeHTML(key)}">${escapeHTML(fields.find((field) => field.key === key)?.label || key)}: ${escapeHTML(error)}</a></li>`).join('');
  if (!validation.valid) {
    latestResult = null;
    latestSimulation = null;
  }
  return validation.valid;
}

function putMoney(selector, value, suffix = '원') {
  const element = $(selector);
  element.innerHTML = `${fmt(value)}<small>${suffix}</small>`;
  element.classList.toggle('is-negative', value < 0);
}

function renderSummary(result) {
  $('.summary-card').classList.toggle('is-loss', result.surplusAfterOwner < 0);
  $('#monthly-surplus').textContent = fmt(result.surplusAfterOwner);
  $('#summary-description').textContent = result.surplusAfterOwner > 0 ? `월 ${won(currentInput.ownerPay)}의 생활비를 가져간 뒤에도 ${won(result.surplusAfterOwner)}이 남아요.` : result.surplusAfterOwner === 0 ? '설정한 생활비까지 정확히 충당해요. 추가로 남는 금액은 0원이에요.' : `설정한 생활비까지 가져가려면 매월 ${won(-result.surplusAfterOwner)}이 더 필요해요.`;
  putMoney('#monthly-revenue', result.revenue);
  putMoney('#operating-surplus', result.operatingSurplus);
  putMoney('#owner-draw', result.ownerDraw);
}

function renderBreakdown(result) {
  const rows = [
    { label: '판매에 드는 변동비', amount: result.variableCosts, color: '#c8bda4' },
    { label: '가게 운영 고정비', amount: result.fixedCosts, color: '#8a9b78' },
    { label: '사장님 생활비', amount: result.ownerDraw, color: '#b8c99a' },
    { label: result.surplusAfterOwner < 0 ? '부족한 금액' : '생활비 차감 후 잉여', amount: result.surplusAfterOwner, color: result.surplusAfterOwner < 0 ? '#c88b71' : '#456747' },
  ];
  const total = result.variableCosts + result.fixedCosts + result.ownerDraw + Math.max(0, result.surplusAfterOwner);
  $('#breakdown-title').textContent = result.surplusAfterOwner < 0 ? '매출보다 지출이 많아요' : '매출은 이렇게 나뉘어요';
  $('#breakdown-title').nextElementSibling.textContent = result.surplusAfterOwner < 0 ? '지출 합계 기준 · 월' : '정상 매출 · 월 기준';
  $('#cost-bar').setAttribute('title', result.surplusAfterOwner < 0 ? `지출 구성 비율. 총지출 ${won(total)}, 매출 ${won(result.revenue)}.` : `매출 ${won(result.revenue)}의 구성 비율.`);
  $('#cost-bar').innerHTML = rows.filter((row) => row.amount > 0).map((row) => `<span style="width:${total ? row.amount / total * 100 : 0}%;background:${row.color}"></span>`).join('');
  $('#breakdown-rows').innerHTML = rows.map((row) => `<div class="breakdown-row"><span class="breakdown-label"><span class="breakdown-dot" style="background:${row.color}" aria-hidden="true"></span>${row.label}</span><strong class="${row.amount < 0 ? 'is-negative' : ''}">${won(row.amount)}</strong></div>`).join('');
  let title, description, tone, symbol;
  if (result.contributionPerUnit <= 0) {
    title = result.contributionPerUnit < 0 ? '한 건을 팔 때마다 돈이 줄어들어요.' : '한 건을 팔아도 운영비에 보탤 돈이 없어요.';
    description = `판매 1건당 공헌이익이 ${won(result.contributionPerUnit)}입니다. 판매 가격, 원가와 수수료를 먼저 확인해 주세요.`;
    tone = 'is-negative'; symbol = '!';
  } else if (result.surplusAfterOwner < 0) {
    const shortfall = Math.max(0, result.targetDaily - currentInput.dailySales);
    title = `생활비 목표까지, 하루 ${fmt(shortfall)}건 더 필요해요.`;
    description = `현재 하루 ${fmt(currentInput.dailySales)}건 → 목표 ${fmt(result.targetDaily)}건. 목표 매출을 실제로 만들 수 있는지 작은 판매 실험으로 확인해 보세요.`;
    tone = 'is-caution'; symbol = '↗';
  } else {
    title = result.surplusAfterOwner === 0 ? '입력한 가정에서 생활비 목표와 정확히 같아요.' : '입력한 가정에서는 생활비 목표를 충당해요.';
    description = `생활비까지 충당하는 기준은 하루 ${fmt(result.targetDaily)}건입니다. 아래에서 판매량이 20% 줄어도 괜찮은지 확인해 보세요.`;
    tone = ''; symbol = '✓';
  }
  $('#target-insight').className = `target-insight ${tone}`;
  $('#target-insight').innerHTML = `<span class="insight-icon" aria-hidden="true">${symbol}</span><div><h3>${title}</h3><p>${description}</p></div>`;
  $('#break-even-daily').innerHTML = result.breakEvenDaily === null ? '달성 불가' : `${fmt(result.breakEvenDaily)}<small>건 / 일</small>`;
  $('#target-daily').innerHTML = result.targetDaily === null ? '달성 불가' : `${fmt(result.targetDaily)}<small>건 / 일</small>`;
  $('#break-even-revenue').textContent = result.breakEvenRevenue === null ? '현재 가격·원가 구조 기준' : `월 매출 약 ${won(result.breakEvenRevenue)} 기준`;
  $('#target-revenue').textContent = result.targetRevenue === null ? '현재 가격·원가 구조 기준' : `월 매출 약 ${won(result.targetRevenue)} 기준`;
  $('#margin-warning').hidden = result.contributionPerUnit > 0;
  $('#margin-warning').textContent = '공헌이익이 0원 이하이면 판매량 증가만으로 비용 문제를 해결할 수 없습니다. 원가와 판매 수수료를 포함한 가격 구조를 먼저 조정해 보세요.';
}

function renderScenarios() {
  const labels = { low: ['덜 팔리면', '판매량 −20%'], base: ['계획대로', '현재 가정'], high: ['더 팔리면', '판매량 +20%'] };
  $('#scenario-cards').innerHTML = compareScenarios(currentInput).map((scenario) => `<article class="scenario-card${scenario.id === 'base' ? ' is-base' : ''}" data-scenario="${scenario.id}"><h3 class="scenario-label">${labels[scenario.id][0]}<span>${labels[scenario.id][1]}</span></h3><p class="scenario-volume">월 ${fmt(scenario.units)}건 · 매출 ${won(scenario.revenue)}</p><p class="scenario-value${scenario.surplusAfterOwner < 0 ? ' is-negative' : ''}">${won(scenario.surplusAfterOwner)}</p><p class="scenario-caption">생활비 차감 후 / 월</p></article>`).join('');
}

function compactMoney(value) {
  const sign = value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  const decimal = (n) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(n);
  if (absolute >= 1e12) return `${sign}${decimal(absolute / 1e12)}조`;
  if (absolute >= 1e8) return `${sign}${decimal(absolute / 1e8)}억`;
  if (absolute >= 1e4) return `${sign}${decimal(absolute / 1e4)}만`;
  return `${sign}${fmt(absolute)}`;
}

function renderChart(result, simulation) {
  const values = [result.openingCash, ...simulation.months.map((month) => month.closingCash)];
  const width = 850, height = 276, left = 67, right = 19, top = 28, bottom = 35;
  let minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const range = maximum - minimum || 10000;
  maximum += range * .14;
  if (minimum < 0) minimum -= range * .12;
  const x = (index) => left + index / 12 * (width - left - right);
  const y = (value) => top + (maximum - value) / (maximum - minimum) * (height - top - bottom);
  const path = values.map((value, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(' ');
  const baseline = y(0);
  const area = `${path} L ${x(12)} ${baseline} L ${x(0)} ${baseline} Z`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = minimum + (maximum - minimum) * index / 4;
    return `<line x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}" stroke="#e6ebdf" stroke-dasharray="3 5"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${compactMoney(value)}</text>`;
  }).join('');
  const monthLabels = values.map((_, index) => `<text x="${x(index)}" y="${height - 11}" text-anchor="middle">${index === 0 ? '시작' : `${index}개월`}</text>`).join('');
  const circles = values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="${index === 12 ? 4 : 2.5}" fill="${value < 0 ? '#b97151' : '#53764b'}" stroke="#fffefa" stroke-width="1.5"><title>${index === 0 ? '초기 지출 후' : `${index}개월 차`}: ${won(value)}</title></circle>`).join('');
  $('#cash-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="cash-chart-title cash-chart-description"><title id="cash-chart-title">12개월 예상 현금 잔액</title><desc id="cash-chart-description">초기 지출 후 ${won(result.openingCash)}, 12개월 후 ${won(simulation.endCash)}. 최저 잔액 ${won(simulation.minimumCash)}. 각 월의 정확한 금액은 아래 월별 계산표에 있습니다.</desc><defs><linearGradient id="cash-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b7cc91" stop-opacity=".36"/><stop offset="100%" stop-color="#b7cc91" stop-opacity=".03"/></linearGradient></defs><text x="${left - 13}" y="12" text-anchor="end">원</text>${grid}<path d="${area}" fill="url(#cash-fill)"/><line x1="${left}" y1="${baseline}" x2="${width - right}" y2="${baseline}" stroke="#9ca98c" stroke-width="1" stroke-dasharray="5 4"/><path d="${path}" fill="none" stroke="#53764b" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>${circles}${monthLabels}</svg>`;
}

function renderCash(result, simulation) {
  putMoney('#opening-cash', result.openingCash);
  putMoney('#ending-cash', simulation.endCash);
  $('#minimum-cash').textContent = won(simulation.minimumCash);
  $('#recovery-month').textContent = simulation.recoveryMonth === null ? '12개월 내 회수되지 않음' : simulation.recoveryMonth === 0 ? '초기 지출 없음' : `${simulation.recoveryMonth}개월 차`;
  $('#simple-payback').textContent = result.simplePaybackMonths === null ? '현재 가정으로 회수 불가' : result.simplePaybackMonths === 0 ? '초기 지출 없음' : `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(result.simplePaybackMonths)}개월`;
  const fundingAlert = $('#funding-alert');
  fundingAlert.hidden = simulation.firstShortageMonth !== 0;
  fundingAlert.textContent = simulation.firstShortageMonth === 0 ? `초기 자금 ${won(-result.openingCash)} 부족 · 월 잉여와 별개로, 시작 전에 자금을 더 준비해야 해요.` : '';
  const status = $('#cash-status');
  status.classList.toggle('is-negative', simulation.firstShortageMonth !== null);
  if (simulation.firstShortageMonth === 0) status.innerHTML = `<strong>시작 전부터 자금이 부족해요.</strong>초기 투자와 보증금에 ${won(-result.openingCash)}의 자금이 더 필요합니다.`;
  else if (simulation.firstShortageMonth !== null) status.innerHTML = `<strong>${simulation.firstShortageMonth}개월 차에 현금이 부족해져요.</strong>가장 부족할 때 ${won(Math.max(0, -simulation.minimumCash))}의 추가 자금이 필요합니다.`;
  else status.innerHTML = '<strong>이 가정의 12개월 월말 기준, 부족이 없어요.</strong>월중 입출금 시점은 반영하지 않습니다. 판매 속도가 달라지면 잔액도 바뀝니다.';
  renderChart(result, simulation);
  const openingRow = `<tr><td>초기 지출 후</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="${result.openingCash < 0 ? 'is-negative' : ''}">${fmt(result.openingCash)}</td></tr>`;
  $('#cash-table tbody').innerHTML = openingRow + simulation.months.map((month) => `<tr><th scope="row">${month.month}개월</th><td>${fmt(month.units)}</td>${['revenue', 'variableCosts', 'operatingSurplus', 'ownerDraw', 'netCashFlow', 'closingCash'].map((key) => `<td class="${month[key] < 0 ? 'is-negative' : ''}">${fmt(month[key])}</td>`).join('')}</tr>`).join('');
}

function renderPrintInputs() {
  $('#print-plan-name').textContent = `${currentInput.name || '이름 없는 사업'} · ${new Date().toLocaleDateString('ko-KR')}`;
  $('#print-inputs').innerHTML = `<table><caption>입력 금액은 모두 부가세 제외·세전, 원 단위입니다.</caption><tbody>${fields.filter((field) => field.key !== 'name').map((field) => `<tr><th scope="row">${field.label}</th><td>${field.key === 'businessType' ? escapeHTML(typeLabels[currentInput.businessType]) : `${field.unit === '%' ? escapeHTML(String(currentInput[field.key])) : fmt(currentInput[field.key])} ${field.unit || ''}`}</td></tr>`).join('')}</tbody></table>`;
}

function update() {
  currentInput = readForm();
  if (!validateForm()) return false;
  latestResult = calculate(currentInput);
  latestSimulation = simulate(currentInput);
  renderSummary(latestResult);
  renderBreakdown(latestResult);
  renderScenarios();
  renderCash(latestResult, latestSimulation);
  renderPrintInputs();
  return true;
}

function storageStatus(message, tone = '') {
  const status = $('#storage-status');
  status.textContent = message;
  status.className = `storage-status${tone ? ` is-${tone}` : ''}`;
}

$('#assumptions').addEventListener('input', (event) => {
  if (!event.target.matches('input, select')) return;
  selectedPresetId = '';
  document.querySelectorAll('[data-preset]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
  update();
  storageStatus('입력값을 변경했어요. 보관하려면 내 기기에 저장을 눌러 주세요.');
});
$('#assumptions').addEventListener('submit', (event) => event.preventDefault());
$('#preset-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-preset]');
  if (!button) return;
  const preset = PRESETS.find((item) => item.id === button.dataset.preset);
  if (!preset) return;
  selectedPresetId = preset.id;
  populateForm(preset.input);
  document.querySelectorAll('[data-preset]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.preset === preset.id)));
  update();
  storageStatus(`${preset.label} 가상 예시를 적용했어요. 내 사업에 맞게 숫자를 바꿔 주세요.`);
});
$('#save-plan').addEventListener('click', () => {
  if (!update()) return;
  try {
    const savedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, input: currentInput, savedAt }));
    storageStatus(`이 브라우저에 저장했어요 · ${new Date(savedAt).toLocaleString('ko-KR')} · 외부 전송 없음`, 'success');
  } catch {
    storageStatus('브라우저 저장 공간에 접근할 수 없어 저장하지 못했어요. 현재 결과는 인쇄로 보관할 수 있습니다.', 'error');
  }
});
$('#load-plan').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { storageStatus('이 브라우저에 저장된 계획이 아직 없어요.', 'error'); return; }
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !saved.input || !validate(saved.input).valid) { storageStatus('저장된 입력값의 형식이 올바르지 않아 불러오지 못했어요. 현재 입력은 유지했습니다.', 'error'); return; }
    populateForm(saved.input);
    selectedPresetId = '';
    document.querySelectorAll('[data-preset]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
    update();
    storageStatus('저장해 둔 계획을 불러왔어요. 현재 화면의 가정으로 다시 계산했습니다.', 'success');
  } catch {
    storageStatus('저장된 계획을 읽을 수 없어 불러오지 못했어요. 현재 입력은 유지했습니다.', 'error');
  }
});
$('#print-report').addEventListener('click', () => {
  if (update()) window.print();
});
let closedBeforePrint = [];
window.addEventListener('beforeprint', () => {
  closedBeforePrint = [...document.querySelectorAll('details:not([open])')];
  closedBeforePrint.forEach((element) => { element.open = true; });
  if (latestResult && latestSimulation) renderPrintInputs();
});
window.addEventListener('afterprint', () => {
  closedBeforePrint.forEach((element) => { element.open = false; });
  closedBeforePrint = [];
});
$('#validation-list').addEventListener('click', (event) => {
  const anchor = event.target.closest('a');
  if (!anchor) return;
  const input = document.getElementById(anchor.getAttribute('href').slice(1));
  if (!input) return;
  const details = input.closest('details');
  if (details) details.open = true;
  input.focus();
});

renderFields();
renderPresets();
populateForm(DEFAULT_INPUT);
update();
