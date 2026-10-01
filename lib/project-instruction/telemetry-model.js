import { hash, httpError, object, onlyKeys, receiptToken, uuid } from './model.js';

export const USAGE_POLICY_VERSION = '2026-10-02-usage-v1';
export const USAGE_MAX_BODY_BYTES = 8 * 1024;
const EVENT_KEYS = ['eventId', 'mode', 'outcome', 'durationMs', 'review', 'endUserConsent', 'baselineSeconds', 'workSeconds', 'workTimeSource', 'comparableTask', 'checkedItems', 'correctItems', 'checkMethod', 'criteriaVersion'];
const TIME_KEYS = ['baselineSeconds', 'workSeconds', 'workTimeSource', 'comparableTask'];
const CHECK_KEYS = ['checkedItems', 'correctItems', 'checkMethod', 'criteriaVersion'];
function invalid() { return httpError(400, '사용 기록의 항목과 값을 확인해 주세요.'); }
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid(); return value; }
function completeGroup(event, keys) {
  const count = keys.filter(key => Object.hasOwn(event, key)).length;
  if (count !== 0 && count !== keys.length) throw invalid();
  return count !== 0;
}
export function normalizeUsageEvent(input) {
  object(input, '사용 기록');
  onlyKeys(input, EVENT_KEYS);
  if (!['test', 'live'].includes(input.mode) || !['completed', 'failed'].includes(input.outcome)
      || !['not_reviewed', 'accepted', 'corrected', 'rejected'].includes(input.review)
      || input.endUserConsent !== true) throw invalid();
  const event = { eventId: uuid(input.eventId), mode: input.mode, outcome: input.outcome,
    durationMs: integer(input.durationMs, 0, 86400000), review: input.review, endUserConsent: true };
  const hasTime = completeGroup(input, TIME_KEYS), hasCheck = completeGroup(input, CHECK_KEYS);
  if (input.outcome === 'failed' && (input.review !== 'not_reviewed' || hasTime || hasCheck)) throw invalid();
  if (hasTime) {
    if (!['measured', 'self_reported'].includes(input.workTimeSource) || input.comparableTask !== true) throw invalid();
    Object.assign(event, { baselineSeconds: integer(input.baselineSeconds, 1, 86400), workSeconds: integer(input.workSeconds, 0, 86400), workTimeSource: input.workTimeSource, comparableTask: true });
  }
  if (hasCheck) {
    if (!['human_review', 'reference_check'].includes(input.checkMethod)
        || typeof input.criteriaVersion !== 'string' || !/^[0-9]{1,4}(\.[0-9]{1,4}){0,2}$/.test(input.criteriaVersion)) throw invalid();
    Object.assign(event, { checkedItems: integer(input.checkedItems, 1, 10000), correctItems: integer(input.correctItems, 0, input.checkedItems), checkMethod: input.checkMethod, criteriaVersion: input.criteriaVersion });
  }
  return event;
}
export function normalizeUsageOwner(input, action) {
  const extra = action === 'enable' ? ['writeToken', 'consent'] : action === 'rotate' ? ['writeToken', 'expectedGeneration'] : [];
  onlyKeys(input, ['action', 'id', 'receiptToken', ...extra]);
  let id, receiptHash;
  try { id = uuid(input.id); receiptHash = hash(receiptToken(input.receiptToken)); }
  catch { throw httpError(404, '제출 확인 정보를 찾을 수 없습니다.'); }
  const result = { id, receiptHash, writeHash: null, expectedGeneration: null, consentVersion: null };
  if (extra.includes('writeToken')) result.writeHash = hash(receiptToken(input.writeToken));
  // Receipt credentials authorize deletion; write credentials must never be interchangeable.
  if (result.writeHash && result.writeHash === receiptHash) throw invalid();
  if (action === 'rotate') result.expectedGeneration = integer(input.expectedGeneration, 1, 2147483646);
  if (action === 'enable') {
    const consent = object(input.consent, '사용 기록 동의');
    onlyKeys(consent, ['version', 'usage', 'overseas', 'ownUse', 'age14']);
    if (consent.version !== USAGE_POLICY_VERSION || ['usage', 'overseas', 'ownUse', 'age14'].some(key => consent[key] !== true)) {
      throw httpError(400, '사용 기록 수집·국외 처리·본인 사용·만 14세 이상 확인에 각각 동의해 주세요.');
    }
    result.consentVersion = USAGE_POLICY_VERSION;
  }
  return result;
}
export function usageWriteHash(authorization) {
  try {
    if (typeof authorization !== 'string' || !/^Bearer [a-f0-9]{64}$/i.test(authorization)) throw new Error();
    return hash(receiptToken(authorization.slice(7)));
  } catch { throw httpError(404, '사용 기록 연결을 찾을 수 없습니다.'); }
}
