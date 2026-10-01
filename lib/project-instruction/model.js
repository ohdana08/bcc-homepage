import { createHash, timingSafeEqual } from 'node:crypto';

export const POLICY_VERSION = '2026-10-01-v1';
export const MAX_BODY_BYTES = 200 * 1024;
export const MAX_DOCUMENT_LENGTH = 60000;
export const PARTICIPATION_OPTIONS = Object.freeze({
  ageRange: ['', '14~19세', '20대', '30대', '40대', '50대', '60대 이상'],
  gender: ['', '여성', '남성', '직접 분류하지 않음'],
  occupation: ['', '사무·행정', '교육·강의', '사업·운영', '기획·콘텐츠', '학생·취업 준비', '그 밖의 일'],
  aiExperience: ['', '오늘 처음이에요', '몇 번 사용했어요', '일상에서 자주 써요', '업무에 활용하고 있어요'],
});
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
export function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, label + '을 확인해 주세요.');
  return value;
}
export function onlyKeys(value, keys) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw httpError(400, '지원하지 않는 입력 항목이 있습니다.');
}
export function boundedString(value, max, label, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw httpError(400, label + '을 확인해 주세요.');
  const result = value.trim();
  if (required && !result) throw httpError(400, label + '을 입력해 주세요.');
  return result;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw httpError(400, '제출 식별값을 확인해 주세요.');
  return value.toLowerCase();
}
export function receiptToken(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw httpError(400, '제출 확인 정보를 확인해 주세요.');
  return value.toLowerCase();
}
export function classCode(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw httpError(400, '강의 링크를 확인해 주세요.');
  return value;
}
export function hash(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function hashesEqual(a, b) { return /^[a-f0-9]{64}$/.test(a || '') && /^[a-f0-9]{64}$/.test(b || '') && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
export function normalizeSubmission(input) {
  object(input, '제출 내용');
  onlyKeys(input, ['action', 'idempotencyKey', 'receiptToken', 'classCode', 'participation', 'document', 'consent']);
  const participation = object(input.participation, '참여 정보');
  onlyKeys(participation, ['institution', 'course', 'session', ...Object.keys(PARTICIPATION_OPTIONS)]);
  const cleaned = {};
  for (const key of ['institution', 'course', 'session']) cleaned[key] = boundedString(participation[key], 120, '강의 정보');
  for (const [key, options] of Object.entries(PARTICIPATION_OPTIONS)) {
    const value = participation[key] === undefined ? '' : participation[key];
    if (!options.includes(value)) throw httpError(400, '선택한 참여 정보를 확인해 주세요.');
    cleaned[key] = value;
  }
  const consent = object(input.consent, '동의 내용');
  onlyKeys(consent, ['version', 'age14', 'internal', 'caseStudy', 'overseas']);
  if (consent.version !== POLICY_VERSION || consent.age14 !== true || consent.internal !== true || consent.overseas !== true) throw httpError(400, '만 14세 이상 확인, 내부 보관 및 국외 처리 동의가 있어야 제출할 수 있습니다.');
  if (consent.caseStudy !== undefined && typeof consent.caseStudy !== 'boolean') throw httpError(400, '사례 사용 동의를 확인해 주세요.');
  if (typeof input.document !== 'string' || !input.document.trim() || input.document.length > MAX_DOCUMENT_LENGTH || input.document.includes('\0')) throw httpError(400, '확인한 업무지시서는 1~60,000자까지 제출할 수 있습니다.');
  const normalized = {
    idempotencyKey: uuid(input.idempotencyKey),
    classCode: classCode(input.classCode),
    participation: cleaned,
    document: input.document, // Exact reviewed document, including leading/trailing whitespace.
    consent: { version: POLICY_VERSION, age14: true, internal: true, overseas: true, caseStudy: consent.caseStudy === true },
  };
  const tokenHash = hash(receiptToken(input.receiptToken));
  return { normalized, tokenHash, payloadHash: hash(JSON.stringify(normalized)) };
}
export function documentTitle(document) {
  const named = document.match(/\*\*만들 것의 이름\*\*\s*\n(?:[ \t]*\n)*[ \t]*>[^\S\n]*([^\n]+)/)?.[1]?.trim();
  if (named && !/아직 정하지|미정|모르겠/.test(named)) return named.replace(/\\([\\`*_{}\[\]()#!|~])/g, '$1').slice(0, 120);
  return (document.split(/\r?\n/).find(line => line.trim()) || 'AI 업무지시서').replace(/^\s*[#>*\s]+/, '').trim().slice(0, 120) || 'AI 업무지시서';
}
export function calendarYearsLater(date, years = 3) {
  const result = new Date(date);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + years);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result.toISOString();
}
export function publicClass(row) {
  return { id: row.id, code: row.public_code, institution: row.institution, course: row.course, session: row.session, isOpen: row.is_open, createdAt: row.created_at };
}
export function submissionSummary(row) {
  return { id: row.id, classId: row.class_id, title: row.title, participation: row.participation, submittedAt: row.submitted_at, expiresAt: row.expires_at,
    consent: { version: row.consent_version, age14: row.age14, internal: row.internal_consent, overseas: row.overseas_consent, caseStudy: row.case_study }, caseUpdatedAt: row.case_updated_at, caseWithdrawnAt: row.case_withdrawn_at };
}
