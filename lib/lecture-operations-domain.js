// Business rules shared by the free lecture operations API and its tests.
export const CASE_STATUSES = ['inquiry', 'analyzing', 'drafted', 'reviewing', 'sent', 'waiting', 'won', 'lost', 'on_hold'];
export const SESSION_STATUSES = ['confirmed', 'completed', 'cancelled'];
export const MAX_MONEY = 2147483647;
export const fail = (status, message, code) => Object.assign(new Error(message), { httpStatus: status, publicCode: code });
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, '입력 항목을 확인해 주세요.');
  return value;
}
export function only(value, keys) {
  object(value);
  if (Object.keys(value).some(key => !keys.includes(key))) throw fail(400, '지원하지 않는 입력 항목입니다.');
  return value;
}
export function text(value, max = 1000, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw fail(400, '문자 입력 길이와 형식을 확인해 주세요.');
  const result = value.trim();
  if (required && !result) throw fail(400, '필수 항목을 입력해 주세요.');
  return result;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw fail(400, '기록 번호를 확인해 주세요.');
  return value.toLowerCase();
}
export function integer(value, min = 0, max = MAX_MONEY) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw fail(400, '숫자 범위를 확인해 주세요.');
  return value;
}
export function date(value, optional = false) {
  if (optional && (value === '' || value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw fail(400, '날짜를 확인해 주세요.');
  return value;
}
export function timestamp(value, optional = false) {
  if (optional && (value === '' || value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw fail(400, '날짜와 시간을 확인해 주세요.');
  // Validate the calendar part independently, rather than allowing JS date rollover.
  date(value.slice(0, 10));
  const parts = value.slice(11, 19).split(':').map(Number);
  if (parts[0] > 23 || parts[1] > 59 || parts[2] > 59) throw fail(400, '시간을 확인해 주세요.');
  return new Date(value).toISOString();
}
export function normalizeOperations(body) {
  if (!Array.isArray(body.sessions) || body.sessions.length > 50) throw fail(400, '확정 회차는 최대 50개까지 저장할 수 있습니다.');
  const ids = new Set();
  const sessions = body.sessions.map(row => {
    only(row, ['id', 'title', 'start_at', 'end_at', 'location', 'instructor', 'status']);
    const id = uuid(row.id);
    if (ids.has(id)) throw fail(400, '중복된 회차 번호입니다.');
    ids.add(id);
    const start_at = timestamp(row.start_at), end_at = timestamp(row.end_at);
    if (end_at <= start_at || Date.parse(end_at) - Date.parse(start_at) > 24 * 3600000) throw fail(400, '회차 종료는 시작 이후 24시간 이내로 입력해 주세요.');
    if (!SESSION_STATUSES.includes(row.status)) throw fail(400, '회차 상태를 확인해 주세요.');
    return { id, title: text(row.title, 160, true), start_at, end_at, location: text(row.location, 500), instructor: text(row.instructor, 100, true), status: row.status };
  });
  for (let i = 0; i < sessions.length; i++) for (let j = i + 1; j < sessions.length; j++) {
    const a = sessions[i], b = sessions[j];
    if (a.status !== 'cancelled' && b.status !== 'cancelled' && a.instructor.toLocaleLowerCase() === b.instructor.toLocaleLowerCase() && a.start_at < b.end_at && a.end_at > b.start_at) throw fail(409, '같은 강사의 강의 시간이 겹칩니다.', 'schedule_conflict');
  }
  const checklist = only(body.checklist, ['materials_ready', 'venue_ready', 'documents_ready', 'completed', 'notes']);
  const normalized = {};
  for (const key of ['materials_ready', 'venue_ready', 'documents_ready', 'completed']) {
    if (typeof checklist[key] !== 'boolean') throw fail(400, '준비 상태를 확인해 주세요.');
    normalized[key] = checklist[key];
  }
  normalized.notes = text(checklist.notes, 3000);
  return { sessions, checklist: normalized };
}
export function normalizeSettings(input) {
  only(input, ['contract_amount', 'deduction_amount', 'due_date', 'invoice_status', 'invoice_number', 'notes']);
  const contract_amount = integer(input.contract_amount), deduction_amount = integer(input.deduction_amount);
  if (deduction_amount > contract_amount) throw fail(400, '공제액은 계약 금액을 넘을 수 없습니다.');
  if (!['not_issued', 'issued'].includes(input.invoice_status)) throw fail(400, '청구 상태를 확인해 주세요.');
  return { contract_amount, deduction_amount, due_date: date(input.due_date, true), invoice_status: input.invoice_status, invoice_number: text(input.invoice_number, 100), notes: text(input.notes, 2000) };
}
export function normalizePayment(input) {
  only(input, ['id', 'kind', 'amount', 'date', 'note']);
  if (!['receipt', 'refund'].includes(input.kind)) throw fail(400, '입금 또는 환불을 선택해 주세요.');
  return { id: uuid(input.id), kind: input.kind, amount: integer(input.amount, 1), date: date(input.date), note: text(input.note, 1000) };
}
export const LEDGER_FIELDS = 'id,date,organization,topic,fee,promised_fee,actual_fee,is_paid,paid_at';
export function normalizeLedgerSnapshot(input) {
  only(input, LEDGER_FIELDS.split(','));
  const nullableInteger = value => value === null ? null : integer(value);
  // A comparison snapshot must preserve legacy strings, including whitespace.
  const originalText = (value, max) => {
    if (typeof value !== 'string') throw fail(400, '기존 장부의 문자 형식을 확인해 주세요.');
    text(value, max);
    return value;
  };
  if (![true, false, null].includes(input.is_paid)) throw fail(400, '기존 입금 상태를 확인해 주세요.');
  timestamp(input.paid_at, true);
  return { id: uuid(input.id), date: date(input.date), organization: originalText(input.organization, 200), topic: input.topic === null ? null : originalText(input.topic, 300), fee: integer(input.fee), promised_fee: nullableInteger(input.promised_fee), actual_fee: nullableInteger(input.actual_fee), is_paid: input.is_paid, paid_at: input.paid_at || null };
}
export function settlementView(row) {
  if (!row) return null;
  const expected_amount = row.contract_amount - row.deduction_amount;
  const received_amount = Number(row.received_amount);
  return { ...row, expected_amount, received_amount, receivable_amount: Math.max(0, expected_amount - received_amount), overpaid_amount: Math.max(0, received_amount - expected_amount), status: received_amount > expected_amount ? 'overpaid' : received_amount === expected_amount ? 'paid' : received_amount > 0 ? 'partial' : 'unpaid' };
}
