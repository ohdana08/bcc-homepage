import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalizePayload } from '../lib/lecture-request.js';

const APP = readFileSync(new URL('../lecture-request/app.js', import.meta.url), 'utf8');
const base = { institution_name: '합성 기관', contact_name: '합성 담당자', contact_email: 'fixture@example.invalid', audience: '아직 미정', purpose: '추천받고 싶어요' };
const normalized = (extra = {}) => normalizePayload({ ...base, ...extra });
const plain = (value) => JSON.parse(JSON.stringify(value));
function source(start, end) {
  const begin = APP.indexOf(start), finish = APP.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, start);
  return APP.slice(begin, finish);
}

test('feedback: legacy schedule restores one candidate and free-form time without losing line breaks', () => {
  const time = '담당자와 협의\n\n14:00~17:00 가능';
  const result = normalized({ lecture_date: '2026-11-12', time });
  assert.deepEqual(result.schedule_candidates, [{ lecture_date: '2026-11-12', time }]);
  assert.equal(result.lecture_date, '2026-11-12'); assert.equal(result.time, time);
  assert.deepEqual(normalized().schedule_candidates, []);
});

test('feedback: multiple requested dates never imply one confirmed date and preserve date-time pairing', () => {
  const candidates = [{ lecture_date: '2026-11-12', time: '오전\n오후' }, { lecture_date: '2026-11-13', time: '저녁\n19:00 이후' }];
  const result = normalized({ lecture_date: '2026-01-01', time: 'stale', schedule_candidates: candidates });
  assert.deepEqual(result.schedule_candidates, candidates);
  assert.equal(result.lecture_date, ''); assert.equal(result.time, '');
  const same = normalized({ schedule_candidates: [{ lecture_date: '2026-11-12', time: '오전' }, { lecture_date: '2026-11-12', time: '오후' }] });
  assert.equal(same.lecture_date, '2026-11-12'); assert.equal(same.time, '');
  assert.deepEqual(normalized({ lecture_date: '2026-11-12', schedule_candidates: [] }).schedule_candidates, []);
  assert.equal(normalized({ lecture_date: '2026-11-12', schedule_candidates: [] }).lecture_date, '');
});

test('feedback: schedule bounds and malformed nested fields are rejected before storage', () => {
  for (const schedule_candidates of [null, {}, '2026-11-12', Array(6).fill({}), [null], [[]], [{ lecture_date: '2026-02-30' }], [{ lecture_date: '2026-1-1' }], [{ time: 'a'.repeat(101) }], [{ time: [] }], [{ lecture_date: '2026-11-12', confirmed: true }]]) {
    assert.throws(() => normalized({ schedule_candidates }), (error) => error.httpStatus === 400);
  }
  assert.equal(normalized({ schedule_candidates: Array.from({ length: 5 }, (_, index) => ({ lecture_date: '2026-11-' + (10 + index), time: '오후' })) }).schedule_candidates.length, 5);
  assert.equal(normalized({ schedule_candidates: [{ lecture_date: '2028-02-29', time: '오전' }] }).lecture_date, '2028-02-29');
  assert.deepEqual(normalized({ schedule_candidates: [{ lecture_date: '', time: '협의 가능' }] }).schedule_candidates, [{ lecture_date: '', time: '협의 가능' }]);
});

test('feedback: required fields remain the original five and budget ranges never infer an amount', () => {
  for (const key of Object.keys(base)) assert.throws(() => normalized({ [key]: '' }));
  for (const range of ['100~200만원', '300만원 이상', '100~500만원', '500~1,000만원']) {
    const result = normalized({ total_budget_range: range });
    assert.equal(result.total_budget_range, range); assert.equal(result.total_budget, null); assert.equal(result.lecturer_fee, null);
  }
});

test('feedback: UI scalar schedule projection agrees with backend and keeps untouched legacy time', () => {
  const context = vm.createContext({});
  vm.runInContext(source('  function scheduleLegacy(', '  function scheduleCandidates('), context);
  const candidates = [{ lecture_date: '2026-11-12', time: '오전' }, { lecture_date: '2026-11-13', time: '저녁' }];
  assert.deepEqual(plain(context.scheduleLegacy(candidates)), { lecture_date: '', time: '' });
  const row = { preservedTime: '오전\n\n14시 이후', inputs: [], custom: { value: '' } };
  assert.equal(context.scheduleTime(row), row.preservedTime);
  row.preservedTime = null; row.inputs = [{ checked: true, value: '오전' }, { checked: true, value: '오후' }, { checked: true, value: '__custom' }]; row.custom.value = ' 14:00~17:00 ';
  assert.equal(context.scheduleTime(row), '오전\n오후\n14:00~17:00');
});

function node(tag) {
  return { tagName: tag.toUpperCase(), children: [], checked: false, value: '', append(...children) { this.children.push(...children); }, remove() { this.removed = true; }, addEventListener() {}, querySelector() { return this; } };
}
function choiceHarness(data) {
  const original = { value: '' };
  const group = { config: { numeric: true, rangeField: 'total_budget_range', options: ['미정·협의', '100~500만원'] }, inputs: ['미정·협의', '100~500만원', '__custom'].map(value => ({ value, checked: false })), original, fieldset: node('fieldset') };
  const context = vm.createContext({ choiceGroups: new Map([['total_budget', group]]), document: { createElement: node }, syncChoice() {}, labels: { total_budget: '', total_budget_range: '' }, numeric: new Set(['total_budget']), form: {}, FormData: class { get() { return ''; } }, scheduleCandidates: () => [], scheduleLegacy: () => ({ lecture_date: '', time: '' }) });
  vm.runInContext(source('  function restoreChoices(', '  function buildChoices(') + source('  function payload(', '  function restore(data)'), context);
  context.restoreChoices(data);
  return { context, group };
}
test('feedback: removed budget choices and exact legacy amounts survive an untouched edit/save', () => {
  const rangeOnly = choiceHarness({ total_budget_range: '100~200만원', total_budget: null });
  assert.equal(rangeOnly.context.payload().total_budget_range, '100~200만원');
  assert.equal(rangeOnly.context.payload().total_budget, null);
  assert.ok(rangeOnly.group.legacyOption);
  const exact = choiceHarness({ total_budget_range: '이전 담당자 예산', total_budget: 2200000 });
  assert.equal(exact.context.payload().total_budget_range, '이전 담당자 예산');
  assert.equal(exact.context.payload().total_budget, 2200000);
  exact.group.preservedRange = ''; exact.group.original.value = '2500000';
  assert.equal(exact.context.payload().total_budget_range, '직접 입력');
  assert.equal(exact.context.payload().total_budget, 2500000);
});

function attachmentHarness({ saved = [], local = [], api, consent = true } = {}) {
  const requests = [], notices = { textContent: '' };
  const context = vm.createContext({ localAttachments: local, savedAttachments: saved, attachmentBusy: false, attachmentsLoaded: true, attachmentListError: '', attachmentConsentGranted: consent, busy: false, dirty: false, MAX_ATTACHMENT_BYTES: 2 * 1024 * 1024, ATTACHMENT_EXTENSIONS: new Set(['pdf','hwp','hwpx','doc','docx','xls','xlsx','ppt','pptx','png','jpg','jpeg']), crypto: { randomUUID }, $: () => notices, renderAttachments() {}, fileBase64: async () => 'SYNTHETIC', attachmentApi: async body => { requests.push(body); return api ? api(body) : { attachments: [] }; } });
  vm.runInContext(source('  function attachmentItems(', '  function fileSize(') + source('  function selectAttachments(', '  async function attachmentApi(') + source('  async function refreshAttachments(', '  function fileBase64(') + source('  async function uploadAttachments(', '  async function downloadAttachment('), context);
  return { context, requests, notices };
}
const file = (name = '기관양식.pdf', size = 1200) => ({ name, size });
test('feedback: file selection enforces size/type/combined capacity and reuses a pending upload ID', () => {
  const id = randomUUID();
  const harness = attachmentHarness({ saved: [{ id, name: '기관양식.pdf', size: 1200, status: 'pending' }, { id: randomUUID(), name: 'a.pdf', size: 1, status: 'ready' }] });
  harness.context.selectAttachments([file(), file('b.docx'), file('c.pdf')]);
  assert.equal(harness.context.attachmentItems().length, 3);
  assert.equal(harness.context.localAttachments[0].id, id);
  assert.equal(harness.context.localAttachments.length, 2);
  const invalid = attachmentHarness(); invalid.context.selectAttachments([file('bad.exe'), file('empty.pdf', 0), file('large.pdf', 2097153)]);
  assert.equal(invalid.context.localAttachments.length, 0);
  invalid.context.selectAttachments([file('MAX.HWP', 2097152)]); assert.equal(invalid.context.localAttachments.length, 1);
});

test('feedback: decomposed macOS Hangul filenames reuse the pending ID even at capacity', () => {
  const id = randomUUID();
  const harness = attachmentHarness({ saved: [{ id, name: '기관양식.pdf', size: 1200, status: 'pending' }, { id: randomUUID(), name: 'a.pdf', size: 1, status: 'pending' }, { id: randomUUID(), name: 'b.pdf', size: 1, status: 'ready' }] });
  harness.context.selectAttachments([file(' 기관양식.pdf '.normalize('NFD'))]);
  assert.equal(harness.context.localAttachments.length, 1);
  assert.equal(harness.context.localAttachments[0].id, id);
  assert.equal(harness.context.attachmentItems().length, 3);
});

test('feedback: sequential uploads preserve a failed attachment ID for retry and never resubmit the inquiry', async () => {
  const first = { id: randomUUID(), file: file('one.pdf'), status: 'selected', error: '' };
  const second = { id: randomUUID(), file: file('two.docx'), status: 'selected', error: '' };
  const stored = new Map(); let failed = false, inFlight = 0, maxFlight = 0;
  const harness = attachmentHarness({ local: [first, second], api: async body => {
    if (body.action === 'list') return { attachments: [...stored.values()] };
    inFlight++; maxFlight = Math.max(maxFlight, inFlight); await Promise.resolve(); inFlight--;
    if (body.upload_id === first.id && !failed) { failed = true; throw new Error('합성 연결 실패'); }
    const attachment = { id: body.upload_id, name: body.filename, size: 1200, mime: 'application/pdf', status: 'ready' }; stored.set(attachment.id, attachment); return { attachment };
  } });
  const ref = { receipt: randomUUID(), key: 'LOCAL_ONLY' };
  await harness.context.uploadAttachments(ref);
  assert.equal(first.status, 'failed'); assert.equal(second.status, 'ready');
  await harness.context.uploadAttachments(ref);
  assert.equal(first.status, 'ready'); assert.equal(maxFlight, 1);
  const uploads = harness.requests.filter(item => item.action === 'upload');
  assert.deepEqual(uploads.map(item => item.upload_id), [first.id, second.id, first.id]);
  assert.ok(uploads.every(item => item.consent === true && item.consent_version === '2026-10-22-attachment-v1'));
  assert.ok(harness.requests.every(item => ['upload','list'].includes(item.action)));
});

test('feedback: a lost successful upload response reconciles by ID and consent is required before any upload', async () => {
  const local = { id: randomUUID(), file: file(), status: 'selected', error: '' }; let saved;
  const harness = attachmentHarness({ local: [local], api: async body => {
    if (body.action === 'list') return { attachments: saved ? [saved] : [] };
    saved = { id: body.upload_id, name: body.filename, size: 1200, status: 'ready' }; throw new Error('합성 응답 유실');
  } });
  const ref = { receipt: randomUUID(), key: 'LOCAL_ONLY' };
  await harness.context.uploadAttachments(ref); await harness.context.uploadAttachments(ref);
  assert.equal(local.status, 'ready'); assert.equal(harness.requests.filter(item => item.action === 'upload').length, 1);
  const denied = attachmentHarness({ consent: false, local: [{ ...local, status: 'selected' }] });
  await denied.context.uploadAttachments(ref); assert.equal(denied.requests.length, 0);
});
