import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../assets/education.js', import.meta.url), 'utf8');
function page({ search = '', value = '', fields = true, hostname = '127.0.0.1' } = {}) {
  const listeners = {}, changes = {}, events = [];
  const message = { value };
  const interest = { value: '', addEventListener: (name, fn) => { changes[name] = fn; } };
  const location = { search, hostname, pathname: '/', hash: '', origin: 'http://' + hostname, href: 'http://' + hostname + '/' + search };
  const context = {
    URL, URLSearchParams, location,
    window: { gtag: (...args) => events.push(args) },
    document: {
      getElementById: id => fields ? ({ 'lf-message': message, 'lf-education': interest }[id] || null) : null,
      addEventListener: (name, fn) => { listeners[name] = fn; },
    },
  };
  vm.runInNewContext(source, context);
  function click(topic, overrides = {}) {
    let prevented = false;
    const link = { href: location.origin + '/?education=' + topic + '#contact', dataset: { educationTopic: topic, educationAction: 'inquiry' } };
    listeners.click({ target: { closest: () => link }, button: 0, preventDefault: () => { prevented = true; }, ...overrides });
    return prevented;
  }
  return { message, interest, events, location, click, change(topic) { interest.value = topic; changes.change(); } };
}

test('교육 상세에서 넘어온 마케팅 문의 맥락을 양식에 연결한다', () => {
  const p = page({ search: '?education=marketing' });
  assert.equal(p.interest.value, 'marketing');
  assert.match(p.message.value, /^AI 활용 마케팅 교육 문의/);
});
test('알 수 없는 값과 객체 속성명은 문의에 반영하지 않는다', () => {
  for (const topic of ['__proto__', 'constructor', '사용자 입력']) {
    const p = page({ search: '?education=' + encodeURIComponent(topic) });
    assert.equal(p.message.value, '');
    assert.equal(p.interest.value, '');
  }
});
test('미작성 안내문은 바꿀 수 있지만 사용자가 쓴 내용은 보존한다', () => {
  const p = page({ search: '?education=startup' });
  p.change('marketing');
  assert.match(p.message.value, /^AI 활용 마케팅 교육 문의/);
  p.message.value += '\n직접 작성한 문의 내용';
  const written = p.message.value;
  p.change('individual');
  assert.equal(p.message.value, written);
});
test('같은 페이지의 문의 버튼은 새로고침 없이 기존 입력을 유지한다', () => {
  const p = page({ value: '기관의 기존 입력 내용' });
  assert.equal(p.click('institution'), true);
  assert.equal(p.message.value, '기관의 기존 입력 내용');
  assert.equal(p.interest.value, 'institution');
  assert.equal(p.location.hash, 'contact');
});
test('새 탭 열기 단축키와 상세 페이지의 기본 탐색은 가로채지 않는다', () => {
  assert.equal(page().click('marketing', { ctrlKey: true }), false);
  assert.equal(page({ fields: false }).click('marketing'), false);
});
test('분석 이벤트에는 선택한 고정 분야만 포함하고 문의 원문은 보내지 않는다', () => {
  const p = page({ hostname: 'bccconsulting.kr', value: '개인정보가 있을 수 있는 문의' });
  p.click('marketing');
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0][2].education_topic, 'marketing');
  assert.doesNotMatch(JSON.stringify(p.events), /개인정보|문의 원문/);
  const local = page();
  local.click('marketing');
  assert.equal(local.events.length, 0);
});

const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const leadSource = [...home.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('var LEAD_ENDPOINT'));
function leadForm({ status = 201, message = '교육을 문의합니다.' } = {}) {
  let submit;
  const requests = [], events = [], statusEl = {}, button = {};
  const form = {
    name: { value: '테스트 이름' }, contact: { value: 'test@example.invalid' },
    request_type: { value: 'general' }, message: { value: message }, website: { value: '' },
    consent: { checked: true },
    education_interest: { value: 'marketing', selectedOptions: [{ textContent: 'AI 활용 마케팅 교육' }] },
    querySelector: () => button,
    addEventListener: (_, fn) => { submit = fn; },
    reset() { this.message.value = ''; this.education_interest.value = ''; },
  };
  vm.runInNewContext(leadSource, {
    URLSearchParams,
    window: { location: { search: '' } },
    document: { referrer: '', getElementById: id => id === 'bccLeadForm' ? form : statusEl },
    sessionStorage: { getItem: () => '', setItem() {} },
    gtag: (...args) => events.push(args),
    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) });
      return { status, json: async () => ({ error: '접수 오류' }) };
    },
  });
  return { form, requests, events, statusEl, button, async submit() {
    submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
  } };
}

test('문의 접수는 기존 API 형식을 유지하고 초기화 전 선택 분야를 분석에 남긴다', async () => {
  const p = leadForm();
  await p.submit();
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].payload.request_type, 'general');
  assert.equal(p.requests[0].payload.message, '문의 분야: AI 활용 마케팅 교육\n교육을 문의합니다.');
  assert.equal(p.form.education_interest.value, '');
  assert.equal(p.events[0][2].education_topic, 'marketing');
  assert.doesNotMatch(JSON.stringify(p.events), /test@example|테스트 이름|교육을 문의/);
  assert.match(p.statusEl.textContent, /접수되었습니다/);
  assert.equal(p.button.disabled, false);
});

test('최대 길이의 문의에 교육 분야를 붙여도 2,000자 안에 들어간다', async () => {
  const limit = Number(home.match(/id="lf-message"[^>]*maxlength="(\d+)"/)[1]);
  const p = leadForm({ message: '가'.repeat(limit) });
  await p.submit();
  assert.ok(p.requests[0].payload.message.length <= 2000);
  assert.ok(p.requests[0].payload.message.endsWith('가'.repeat(limit)));
});

test('필수 항목과 동의가 없으면 문의를 전송하지 않는다', async () => {
  const p = leadForm();
  p.form.name.value = ' ';
  await p.submit();
  assert.equal(p.requests.length, 0);
  p.form.name.value = '테스트 이름';
  p.form.consent.checked = false;
  await p.submit();
  assert.equal(p.requests.length, 0);
});

test('접수 제한 응답은 작성 내용을 보존하고 재시도할 수 있게 한다', async () => {
  const p = leadForm({ status: 429 });
  await p.submit();
  assert.equal(p.form.message.value, '교육을 문의합니다.');
  assert.equal(p.form.education_interest.value, 'marketing');
  assert.equal(p.events.length, 0);
  assert.equal(p.button.disabled, false);
  assert.match(p.statusEl.textContent, /잠시 후/);
});
