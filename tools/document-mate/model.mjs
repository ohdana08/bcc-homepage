/** Browser-safe, deterministic document model. No network or storage access. */
export const DOCUMENT_TYPES = Object.freeze({
  plan: { label: '계획서', headings: ['추진 배경', '목적', '대상', '기간', '장소', '주요 내용', '추진 일정', '역할', '준비사항', '예산', '기대 결과'] },
  report: { label: '결과보고서', headings: ['개요', '추진 내용', '활동 결과', '확인된 성과', '문제점', '개선방안', '첨부자료'] },
  minutes: { label: '회의록', headings: ['회의명', '일시', '장소', '참석자', '주요 안건', '논의 내용', '결정사항', '담당자', '후속 일정'] },
  journal: { label: '업무일지', headings: ['날짜', '업무명', '수행 내용', '진행상황', '문제사항', '조치사항', '다음 업무'] },
  handover: { label: '인수인계서', headings: ['업무명', '현재 상태', '주요 업무', '진행 중 업무', '관련 파일·자료', '주요 연락처', '주의사항', '다음 담당자가 해야 할 일'] },
  cooperation: { label: '협조요청 공문', headings: ['수신', '발신', '협조 목적', '협조 사항', '수령 일시', '수령 장소', '수령 방법', '문의', '붙임'] },
  reply: { label: '회신 공문', headings: ['수신', '발신', '회신 목적', '회신 내용', '처리 경과', '후속 조치', '문의', '붙임'] },
});
export const FIELD_LABELS = Object.freeze({
  purpose: '작성 목적', reader: '제출 대상', period: '활동 기간', date: '날짜', location: '장소',
  activities: '주요 활동', activity_content: '주요 활동', main_content: '주요 내용', feedback: '반응',
  results: '확인된 성과', quantitative_results: '확인된 성과', target_audience: '대상', issues: '문제점',
  improvements: '개선방안', schedule: '추진 일정', budget: '예산', expectations: '기대 결과',
  meeting_name: '회의명', participants: '참석자', agenda: '주요 안건', discussion: '논의 내용',
  decisions: '결정사항', action_items: '후속 조치', owner: '담당자', status: '현재 상태',
  task_name: '업무명', tasks: '주요 업무', pending_tasks: '미완료 업무', next_tasks: '다음 업무',
  attachments: '첨부자료', references: '관련 자료', contacts: '연락처', cautions: '주의사항',
  recipient: '수신', sender: '발신', request: '협조 사항', reply_content: '회신 내용', progress: '처리 경과',
  basis: '관련 근거', basis_title: '근거 문서 제목', basis_number: '관련 공문번호', basis_date: '근거 문서 날짜',
  basis_relation: '근거와의 관계', legal_basis: '법적 근거', receipt_date: '수령 일시', receipt_location: '수령 장소',
  receipt_method: '수령 방법', items: '품목', quantity: '수량', deadline: '기한', inquiry: '문의', confirmed_attachments: '확정 붙임',
});
const KINDS = new Set(['fact', 'opinion', 'prediction', 'unknown']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
const normalized = (value) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const fieldKey = (value) => normalized(value).replace(/[\s·/()\[\]:_-]/g, '').toLowerCase();
const numbers = (value) => value.match(/\d+(?:[,.]\d+)*(?:\s*[%％])?/g) || [];
const hasNewNumbers = (value, evidence) => numbers(value).some((number) => !numbers(evidence).includes(number));
const unknownMarker = /^(?:\[?\s*(?:확인\s*필요|미확인|미입력|미집계|미측정|(?:아직\s*)?미정|자료\s*없음|정보\s*없음|협의\s*필요|(?:잘\s*)?모름|모릅니다|몰라요|(?:잘\s*)?모르겠(?:어요|습니다)|(?:아직\s*)?(?:정하지\s*않았(?:어요|습니다)|결정되지\s*않았(?:어요|습니다)|못\s*정했(?:어요|습니다)))\s*\]?)\.?$/;
const predictionPattern = /(?:예상|기대|전망|추정|예정|예측|목표|가정|만약|잠정|것(?:이다|입니다|으로)|높아질|증가할|개선될|향상될|계획(?:이다|입니다|이야|임|해|하)|하려(?:는|고)|(?:할|만들|될|볼|보낼|올릴)\s*(?:거(?:예요|야)|것(?:이에요|입니다|이다)))/;
const conditionalPattern = /(?:조건|경우|(?:승인|확인|확정)\s*후|(?:이|라|으|되|하|가|오|된다|한다|있다|없다)면(?=[\s,.!?\d]|$)|약\s*\d)/;
const opinionPattern = /(?:반응.{0,8}(?:좋|긍정)|만족도.{0,8}(?:높|좋)|효과.{0,8}(?:있|좋)|성과.{0,8}(?:있|좋)|참여.{0,8}많|홍보.{0,8}잘|좋았|좋은|높았|낮았|많았|훌륭|성공적|효과적|긍정적|부정적|만족스러|만족하|아쉽|보람|생각(?:한다|합니다|해|합)|느꼈)/;
const UNKNOWN_TOPIC_NAMES = Object.freeze({
  location: ['장소', '행사장', '회의실'], budget: ['예산', '비용', '금액'],
  period: ['기간', '시기', '날짜', '일시'], date: ['날짜', '일시'], schedule: ['일정'],
  reader: ['제출 대상', '제출처', '수신처', '읽는 사람'], purpose: ['작성 목적', '제출 목적'],
  activities: ['주요 활동', '활동 내용'], activity_content: ['주요 활동', '활동 내용'], main_content: ['주요 내용', '행사 내용'],
  target_audience: ['대상', '참여 대상'], participants: ['참석자', '참석 인원'], owner: ['담당자'],
  results: ['성과', '활동 결과'], quantitative_results: ['성과', '활동 결과'], issues: ['문제점'],
  improvements: ['개선방안', '개선 방안'], expectations: ['기대 결과'],
  views: ['조회수'], satisfaction: ['만족도'], contacts: ['연락처'],
  recipient: ['수신', '수신 기관'], receipt_date: ['수령 일시', '수령 날짜'], receipt_location: ['수령 장소'],
});
// Match a clear answer at the end of its own clause. General negation such as
// “설문은 하지 않았다” is not an answer to the separate question about outcomes.
const explicitUnknownAnswer = /(?:미정(?:입니다|이다|이에요|임)?|미확인(?:입니다|이다|이에요|임)?|미집계(?:입니다|이다|이에요|임)?|미측정(?:입니다|이다|이에요|임)?|(?:잘\s*)?모름|모릅니다|몰라요|(?:잘\s*)?모르겠(?:어요|습니다)|(?:아직\s*)?(?:정하지|결정하지|확정하지|결정되지|확정되지|집계하지|측정하지)\s*않(?:았(?:어요|습니다|다|음)|음)|(?:아직\s*)?(?:안|못)\s*(?:정했|결정했|확정했)(?:어요|습니다|다|음)|(?:아직\s*)?전달받지\s*못했(?:어요|습니다|다|음)|확인\s*필요)\s*[.!?。！？]*$/;

function isExplicitlyUnresolved(field, sources) {
  const aliases = [...new Set([...(UNKNOWN_TOPIC_NAMES[field.id] || []), field.label])].map(fieldKey).filter(Boolean);
  return sources.some((source) => typeof source?.text === 'string' && source.text
    .split(/[\r\n;!?。！？]|\.(?!\d)|(?:지만|이고|이며|반면|그러나)\s*/)
    .some((clause) => {
      const answer = explicitUnknownAnswer.exec(clause.trim());
      if (!answer) return false;
      const topic = fieldKey(clause.trim().slice(0, answer.index));
      return aliases.some((alias) => topic.includes(alias));
    }));
}
// Only neutral field names may be invented by the extractor. All other labels
// must occur in the submitted material; otherwise labels could smuggle in a fact.
const GENERIC_LABELS = new Set([
  ...Object.values(DOCUMENT_TYPES).flatMap((type) => [type.label, ...type.headings]),
  '제목', '문서 제목', '작성 목적', '제출 목적', '문서 목적', '독자', '읽는 사람', '제출 대상', '보고 대상', '제출처', '수신처',
  '기관명', '대상 기관', '담당 부서', '작성자', '작성일', '작성 일자', '승인 여부', '담당자 확인', '연락처',
  '주요 활동', '활동 내용', '활동 기간', '활동 날짜', '활동 연도', '활동 수', '시기', '활동 개요', '활동 목적', '사업명', '사업 기간',
  '행사명', '행사 기간', '행사 장소', '행사 결과', '행사 개요', '회의 일시', '회의 장소', '회의 참석자',
  '참여 인원', '참여자 수', '참석 인원', '참석자 수', '응답자 수', '만족도', '설문 만족도', '설문 결과', '조사 결과',
  '결과', '성과', '반응', '기대', '확인 근거', '측정 근거', '자료 출처', '결과 근거', '문제', '개선점', '개선 방안',
  '업무 내용', '업무 개요', '업무 결과', '담당 업무', '담당자별 역할', '다음 행동', '후속 조치', '후속 업무', '후속 일정',
  '준비 사항', '예산 산출 근거', '예산 집행', '예산 내역', '관련 자료', '참고 자료', '증빙 자료', '자료', '첨부', '첨부 자료',
  '확인 사항', '주의 사항', '기타', '비고', '추가 내용', '추가 확인 내용', '인계자', '인수자', '인계 일자', '미완료 업무',
  ...Object.values(FIELD_LABELS), '관련근거', '근거 문서', '근거 제목', '근거 날짜', '근거 문서번호', '공문번호',
  '관련 공문', '관계 문서', '법령', '법령명', '법령 조항', '관련 법령', '회신 관계', '협조사항', '처리경과',
  '수신자', '발신자', '요청 사항', '회신 기한', '회신 방법', '문의처', '붙임 목록', '물품명', '수령 담당자',
].map(fieldKey));

export function isBasisField(field) {
  return /^(?:basis(?:_|$)|legal_basis$)/.test(field?.id || '')
    || /^(?:관련근거|법적근거|근거(?:문서)?(?:제목|번호|날짜)?|관련공문(?:번호)?|회신관계|근거와의관계|법령(?:명|조항)?|관련법령|관계문서)$/.test(fieldKey(field?.label || ''));
}
const basisIdentifierField = (field) => /^(?:basis|basis_title|basis_number|basis_date)$/.test(field?.id || '') || /^(?:관련근거|근거문서|근거문서제목|관련공문번호|근거문서날짜)$/.test(fieldKey(field?.label || ''));

const directSource = (source) => typeof source?.text === 'string' && /^(?:input|intake-context|reviewed-values|answer[-.:].*)$/.test(source?.id || '');
export class SourceCoverageError extends Error {}
const sourceStatementId = (sourceId, offset, text) => {
  let hash = 2166136261;
  for (const char of `${sourceId}\0${text}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `source-statement-${hash.toString(36)}-${offset.toString(36)}`;
};
const supplemental = (field) => /^source-statement-/.test(field.id) || /^보완한\s*원문/.test(field.label);
const sameProvenance = (a, b) => a.sourceId && a.sourceId === b.sourceId && a.quote && b.quote && normalized(a.quote) === normalized(b.quote);
export function directStatements(sources) {
  const statements = [];
  for (const source of sources.filter((source) => /^(?:input|answer[-.:].*)$/.test(source?.id || '') && typeof source.text === 'string')) {
    let start = 0;
    const boundaries = [...source.text.matchAll(/(?<=[.!?。！？])\s+(?=[가-힣A-Za-z])|[\r\n]+/g)];
    for (const boundary of [...boundaries, { index: source.text.length, 0: '' }]) {
      const raw = source.text.slice(start, boundary.index);
      const offset = start + raw.length - raw.trimStart().length;
      const text = raw.trim();
      start = boundary.index + boundary[0].length;
      if (!text) continue;
      if (/^(?:(?:이|위|다음|해당)\s*(?:내용|자료)(?:을|를)?\s*)?(?:계획서|결과보고서|보고서|회의록|업무일지|인수인계서|공문)(?:로|를|으로)?\s*(?:써|작성해|만들어|정리해)(?:줘|주세요)[.!?\s]*$/.test(text)) continue;
      if (text.length > 2400) throw new SourceCoverageError('한 문단이 너무 길어 원문을 빠짐없이 검토할 수 없습니다. 2,400자 이내의 문장·문단으로 나누어 주세요.');
      statements.push({ sourceId: source.id, text, offset, id: sourceStatementId(source.id, offset, text) });
    }
  }
  return statements;
}
export function reconcileReviewedEdits(fields, sources, edits, options = {}) {
  const changed = new Set();
  const rebased = new Set();
  const provenance = options.provenanceFields || fields;
  const latestCorrection = sources.reduce((last, source, index) => /^(?:edit[-.:]|reviewed-values$)/.test(source.id) ? index : last, -1);
  const effective = edits.filter((edit) => !(edit.derivedFromEditIds?.length && edit.value === edit.derivedValue)).map((edit) => {
    if (!options.preferNewerAnswers) return edit;
    const latest = fields.filter((field) => field.value && field.kind !== 'unknown'
      && (!supplemental(edit) && !supplemental(field) && (field.id === edit.id || fieldKey(field.label) === fieldKey(edit.label)))
      && /^answer[-.:]/.test(field.sourceId) && sources.findIndex((source) => source.id === field.sourceId) > latestCorrection).at(-1);
    return latest ? { ...edit, value: latest.value, kind: latest.kind } : edit;
  });
  for (const edit of effective) for (const other of effective) {
    if (edit.id === other.id || !edit.originalValue || !other.originalValue || edit.sourceId !== other.sourceId || !edit.quote || !other.quote) continue;
    if (!(edit.quote.includes(other.quote) || other.quote.includes(edit.quote))) continue;
    if (edit.originalValue.includes(other.originalValue) && edit.kind !== 'unknown' && other.kind !== 'unknown'
      && edit.value !== other.value && !edit.value.includes(other.value)) throw new SourceCoverageError('같은 원문을 수정한 항목들이 서로 다릅니다. 중복 항목의 최신 값을 일치시켜 주세요.');
  }
  // A later direct edit must not coexist with an earlier free-text correction
  // whose topic linkage was not retained. Stop visibly rather than send both.
  if (!options.ensureEdits) for (const edit of effective) {
    for (const derived of provenance.filter((field) => field.derivedFromEditIds?.includes(edit.id))) {
      const template = derived.originalValue || '';
      const at = template.indexOf(edit.originalValue);
      if (!edit.originalValue || at < 0 || !derived.derivedValue) continue;
      const prefix = template.slice(0, at), suffix = template.slice(at + edit.originalValue.length);
      if (!derived.derivedValue.startsWith(prefix) || !derived.derivedValue.endsWith(suffix)) continue;
      const prior = derived.derivedValue.slice(prefix.length, suffix ? -suffix.length : undefined);
      if (prior && prior !== edit.value && provenance.some((field) => /^answer[-.:]/.test(field.sourceId) && field.value.includes(prior) && !effective.some((other) => other.id === field.id))) {
        throw new SourceCoverageError('추가 답변과 최신 수정값이 서로 다릅니다. 보완한 원문의 이전 정정값도 함께 확인해 주세요.');
      }
    }
  }
  for (const edit of effective) {
    if (!edit.originalValue || !edit.sourceId || !edit.quote || edit.value === edit.originalValue) continue;
    const source = sources.find((source) => source.id === edit.sourceId);
    if (!source || !normalized(source.text).includes(normalized(edit.quote)) || !normalized(edit.quote).includes(normalized(edit.originalValue))) throw new SourceCoverageError('수정 전 원문 연결을 확인할 수 없습니다. 원문과 수정값을 다시 확인해 주세요.');
    for (const field of fields) {
      if (effective.some((other) => other.id === field.id && (!supplemental(other) || sameProvenance(other, provenance.find((item) => item.id === field.id) || field)))) continue;
      const original = provenance.find((item) => item.id === field.id);
      if (!original || original.sourceId !== edit.sourceId || !original.quote || !(normalized(original.quote).includes(normalized(edit.quote)) || normalized(edit.quote).includes(normalized(original.quote)))) continue;
      const old = original.originalValue ?? original.value;
      if (old && edit.originalValue.includes(old) && old !== edit.originalValue) {
        Object.assign(field, { value: '', kind: 'unknown', required: false, origin: 'user' });changed.add(field.id);continue;
      }
      if (!normalized(old).includes(normalized(edit.originalValue))) continue;
      if (old.split(edit.originalValue).length !== 2) throw new SourceCoverageError('중복 원문에서 수정할 위치가 모호합니다. 보완한 원문 항목도 함께 확인해 주세요.');
      if (!rebased.has(field.id)) { field.value = old; rebased.add(field.id); }
      field.value = field.value.replace(edit.originalValue, edit.kind === 'unknown' ? '[확인 필요]' : edit.value);
      field.kind = inferKind(field.value, field.kind); field.origin = 'user';changed.add(field.id);
      field.derivedFromEditIds = [...new Set([...(field.derivedFromEditIds || []), edit.id])];
      field.derivedValue = field.value;
    }
  }
  if (options.ensureEdits) for (const edit of effective) {
    let field = fields.find((field) => supplemental(edit) || supplemental(field)
      ? sameProvenance(field, edit)
      : field.id === edit.id || fieldKey(field.label) === fieldKey(edit.label));
    if (!field) {
      if (fields.length >= 72) throw new SourceCoverageError('검토 항목이 72개를 넘습니다. 자료를 나누어 주세요.');
      let id = edit.id;
      if (fields.some((item) => item.id === id)) id = sourceStatementId(edit.sourceId || 'reviewed', 0, edit.quote || edit.originalValue || edit.value);
      if (fields.some((item) => item.id === id)) throw new SourceCoverageError('수정 항목의 원문 연결이 겹칩니다. 항목을 다시 확인해 주세요.');
      field = { ...edit, id };fields.push(field);
    }
    Object.assign(field, { value: edit.kind === 'unknown' ? '' : edit.value, kind: edit.kind, required: false, origin: 'user', originalValue: edit.originalValue || '', sourceId: edit.sourceId || '', quote: edit.quote || '' });
    changed.add(field.id);
  }
  return [...changed];
}
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Recipient direction is a syntactic fact, unlike a model's role label.
 * Only current direct input is considered, never a received attachment's roles.
 * Explicit reviewed edits are protected at the later draft boundary. */
export function applyCorrespondenceRoles(fields, sources, protectedIds = []) {
  const protectedSet = new Set(protectedIds);
  const recipients = [];
  const outgoingRoutes = [];
  for (const source of sources.filter(directSource)) {
    for (const sentence of source.text.split(/[\r\n!?。！？]|\.(?!\d)/).map((part) => part.trim()).filter(Boolean)) {
      if (/시스템|프롬프트|역할을|예문|예시|인용|라고\s*(?:적|쓰|있)/.test(sentence)) continue;
      const currentSentence = sentence.replace(/^(?:이번에는|이번 문서는|현재)\s+/, '');
      const route = /^(.{1,60}?)에서\s*(.{1,60}?)(?:에게|께|에)\s+[^.!?\n]{0,150}(?:요청합니다|보냅니다|발송합니다|제출합니다|회신합니다)\s*$/.exec(currentSentence);
      if (route && !/받|했|하였|보냈|요청한|요청했던|지난|예전|과거|하지\s*말|말고|않|아니|대신/.test(sentence)) {
        const sender = route[1].trim();
        const recipient = route[2].trim();
        if (![sender, recipient].some((name) => /(?:은|는|이|가)\s|에서|에게/.test(name))) {
          outgoingRoutes.push({ sender, recipient });
          recipients.push({ value: recipient, quote: sentence, sourceId: source.id });
          continue;
        }
      }
      // Do not let the shorter recipient-only parser mistake X in "X에서 Y에"
      // for the destination when the explicit current outgoing route is absent.
      if (/^.{1,60}?에서\s*/.test(sentence)) continue;
      const explicit = /^수신(?:자|\s*기관)?\s*[:：]\s*(.{1,80})$/.exec(currentSentence);
      const directed = /^([^.!?\n]{1,80}?)(?:에게|께|에)\s*([^.!?\n]{0,40}?)(?:회신|답변|제출|보내|보낼)/.exec(currentSentence);
      const target = explicit?.[1]?.trim() || directed?.[1]?.trim();
      if (!target || (!explicit && (/(?:은|는|이|가)\s/.test(target)
        || /받(?:은|았|아|는|을|고)|요청받|부탁받|수신했|수신하였|하지\s*말|말고|않|아니|대신/.test(sentence)
        || (sentence.match(/에게|께/g) || []).length > 1))) continue;
      recipients.push({ value: target, quote: sentence, sourceId: source.id });
    }
  }
  const unique = [...new Map(recipients.map((item) => [fieldKey(item.value), item])).values()];
  for (const sender of fields.filter((field) => field.id === 'sender' && field.value && !protectedSet.has(field.id))) {
    // An institution appearing in a reference or venue does not establish who
    // sends the current document. Require a direct self/role declaration.
    const role = '(?:발신(?:자|\\s*기관)?|작성\\s*기관|(?:우리|저희)\\s*(?:기관|단체|회사|학교|부서|팀)|우리|저희)';
    const declared = new RegExp(`^${role}\\s*(?:은|는|이|가|[:：])\\s*${escapePattern(sender.value)}(?:\\s*(?:입니다|이에요|예요|이고|이며|에서|이야|임))?\\s*$`);
    const explicitSender = outgoingRoutes.some((route) => route.sender === sender.value)
      || sources.filter(directSource).some((source) => source.text.split(/[\r\n!?。！？]|\.(?!\d)/)
        .some((sentence) => declared.test(sentence.trim())));
    if (!explicitSender) Object.assign(sender, { value: '', quote: '', sourceId: '', kind: 'unknown', required: false });
  }
  if (unique.length === 1 && !protectedSet.has('recipient')) {
    let recipient = fields.find((field) => field.id === 'recipient');
    if (!recipient && fields.length < 72) { recipient = { id: 'recipient', label: '수신' }; fields.push(recipient); }
    if (recipient) Object.assign(recipient, unique[0], { kind: 'fact', required: false });
  }
  return fields;
}
export function applyHandoverRecipient(fields, sources, protectedIds = []) {
  const recipient = fields.find((field) => field.id === 'recipient' || field.id === 'reader');
  if (recipient?.value || protectedIds.includes(recipient?.id || 'recipient')) return fields;
  for (const source of sources.filter(directSource)) {
    const match = /(?:^|[.!?\n]\s*)후임자인\s+([^.!?\n]{1,40}?)에게\s+[^.!?\n]{0,100}(?:넘겨|인계)/.exec(source.text);
    if (!match) continue;
    const entry = recipient || { id: 'recipient', label: '인수자' };
    Object.assign(entry, { value: match[1].trim(), quote: match[0].trim(), sourceId: source.id, kind: 'fact', required: false });
    if (!recipient) fields.push(entry);
    break;
  }
  return fields;
}

export function explicitUnresolvedStates(fields, { includeSuperseded = false } = {}) {
  const states = [];
  for (const field of fields.filter((field) => field.value && field.kind !== 'unknown')) {
    for (const quote of field.value.split(/[\r\n!?。！？]|\.(?!\d)|(?:이고|이며|지만|반면|그러나)\s*/).map((part) => part.trim())) {
      const match = /^(.{1,60}?)(?:은|는|이|가|도)\s*(?:아직\s*)?(?:미정(?:이에요|입니다|이다|임)?|(?:정하지|정해지지|결정하지|결정되지|확정하지|확정되지)\s*않(?:았(?:어요|습니다|다|음)|은|음)|못\s*정했(?:어요|습니다|다|음))\s*$/.exec(quote);
      if (!match) continue;
      const topic = match[1].trim();
      let remaining = topic;
      const topics = [];
      for (const candidate of ['대체 일정', '다음 회의 날짜', '수령 일시', '수령 장소', '수령 담당자', '장소', '예산', '날짜', '일정', '담당자', '연락처']) {
        const pattern = new RegExp(candidate.split(' ').map(escapePattern).join('\\s*'));
        if (pattern.test(remaining)) { topics.push(candidate); remaining = remaining.replace(pattern, ''); }
      }
      for (const label of topics.length ? topics : [topic]) if (!states.some((state) => state.fieldId === field.id && fieldKey(state.topic) === fieldKey(label))) states.push({ fieldId: field.id, topic: label, quote, state: 'undecided' });
    }
  }
  if (includeSuperseded) return states;
  // A newly reviewed value takes precedence over a sibling field's older shared
  // quotation, e.g. location=학생회관 versus "장소와 예산은 미정" in budget.
  const editedTopics = (field) => {
    const label = fieldKey(field.label);
    const aliases = (UNKNOWN_TOPIC_NAMES[field.id] || []).map(fieldKey);
    // A specific label such as 수령 일정 must not erase 대체 일정 through the
    // generic schedule alias 일정. Unqualified fields may use exact aliases.
    if (label && label !== fieldKey(FIELD_LABELS[field.id] || '') && !aliases.includes(label)) return [label];
    return [...aliases, label].filter(Boolean);
  };
  const current = states.filter((state) => !fields.some((field) => field.origin === 'user' && field.id !== state.fieldId
    && field.value && field.kind !== 'unknown'
    && editedTopics(field).includes(fieldKey(state.topic))
    && !states.some((other) => other.fieldId === field.id && fieldKey(other.topic) === fieldKey(state.topic))));
  return [...new Map(current.map((state) => [fieldKey(state.topic), state])).values()];
}

/** Classify explicit user edits as well as AI extracts. A newly filled unknown
 * field is classified from its new value; an explicit unknown marker stays empty. */
export function inferKind(value, preferred = 'fact') {
  const text = clean(value, 12000);
  if (!text || unknownMarker.test(text)) return 'unknown';
  // A preferred change is not a forecast of its effects. In particular the
  // conditional in "정하면 좋겠어요" must not promote a proposal to prediction.
  if (/좋겠(?:어요|습니다|다)|제\s*생각에는|(?:을|를|기를)\s*제안(?:합니다|해요|함)/.test(text)) return 'opinion';
  if (predictionPattern.test(text) || conditionalPattern.test(text)) return 'prediction';
  if (opinionPattern.test(text)) return 'opinion';
  return ['fact', 'opinion', 'prediction'].includes(preferred) ? preferred : 'fact';
}

function safeLabel(value, fallback, allText) {
  const label = clean(value, 100).replace(/[\r\n]+/g, ' ');
  const key = fieldKey(label);
  // A prose substring is not a template heading: “승인 완료” must not become
  // a heading when the sentence says “승인 완료가 아닙니다”. Custom headings
  // must occupy the full source line/cell (formatting/enumeration aside).
  const sourceHeading = key && !hasNewNumbers(label, allText) && allText.split(/[\r\n\t|]+/).some((line) => {
    const heading = line.trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:\d+(?:\.\d+)*[.)]|[가-힣][.)]|[①-⑳])\s*/, '')
      .replace(/^[-*•]\s+/, '')
      .replace(/\s*[:：]\s*$/, '');
    return fieldKey(heading) === key;
  });
  return label && (GENERIC_LABELS.has(key) || sourceHeading) ? label : fallback;
}

const QUALIFIERS = /(?:아니(?:다|었|에|며|고|라|라고|오|겠)|아닙|아닌|않(?:았|는|다|고|음|습니다|겠)|없(?:었|다|음|습니다|는|어)|미(?:정|확인|승인|완료|실시|달성|제출|확정)|취소|철회|불가|불가능|거절|보류|예상|기대|전망|추정|예정|예측|가정|목표|잠정|조건|경우|(?:이|라|으|되|하|가|오|된다|한다|있다|없다)면(?=[\s,.!?\d]|$)|만약|약\s*(?=\d)|최대|최소|이상|이하|미만|초과)/g;

function prepareEvidence(text) {
  const raw = text.normalize('NFC');
  const positions = [];
  let flat = '';
  for (let index = 0; index < raw.length; index++) {
    if (/\s/.test(raw[index])) {
      if (!flat || flat.endsWith(' ')) continue;
      flat += ' ';
    } else flat += raw[index];
    positions.push(index);
  }
  return { raw, flat, positions };
}

function contextAt(evidence, start, end) {
  const rawStart = evidence.positions[start];
  const rawEnd = evidence.positions[end - 1] + 1;
  let from = 0;
  let to = evidence.raw.length;
  // A negative statement in an unrelated sentence or table row must not taint
  // a supported positive statement. Decimal points are not sentence boundaries.
  for (const match of evidence.raw.matchAll(/[\n\r!?。！？]|\.(?!\d)|(?<=미정|미확정)(?:이고|이며)\s+(?=[가-힣A-Za-z0-9\s]{1,40}(?:은|는|이|가)\s)/g)) {
    if (match.index + match[0].length <= rawStart) from = match.index + match[0].length;
    else if (match.index >= rawEnd - 1) { to = match.index; break; }
  }
  return evidence.raw.slice(from, to);
}

function groundedValue(value, quote, evidence) {
  if (!value || !quote || !evidence || hasNewNumbers(value, quote)) return false;
  const excerpt = normalized(value);
  const citation = normalized(quote);
  for (let quoteAt = evidence.flat.indexOf(citation); quoteAt >= 0; quoteAt = evidence.flat.indexOf(citation, quoteAt + 1)) {
    for (let valueAt = citation.indexOf(excerpt); valueAt >= 0; valueAt = citation.indexOf(excerpt, valueAt + 1)) {
      const start = quoteAt + valueAt;
      const end = start + excerpt.length;
      // Prevent 20명 from being extracted from 120명, -20명 or 20명대.
      if (/^\d/.test(excerpt) && /[\d.,+−-]/.test(evidence.flat[start - 1] || '')) continue;
      if (/\d$/.test(excerpt) && /[\d.,%％a-zA-Z가-힣]/.test(evidence.flat[end] || '')) continue;
      if (/(?:명|건|원|개|회|시간|분|일|월|년|%|％)$/.test(excerpt) && /[대여쯤]/.test(evidence.flat[end] || '')) continue;
      const context = contextAt(evidence, start, end);
      // The model may shorten the quote itself, so inspect its source sentence.
      // Do not turn “20명이 아니다 / 예상 20명” into the assertion “20명”.
      const qualifications = [...context.matchAll(QUALIFIERS)].map((match) => match[0].replace(/\s+/g, ''));
      if (qualifications.some((qualifier) => !excerpt.replace(/\s+/g, '').includes(qualifier))) continue;
      return true;
    }
  }
  return false;
}

/**
 * Ground every extracted value in its exact source quote. Values are deliberately
 * extracts rather than fresh prose: even a plausible paraphrase can add a fact.
 * This runs at the server boundary, never after a person edits reviewed fields.
 */
export function normalizeAnalysis(raw, sources = [], answeredFieldIds = [], options = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const documentType = Object.hasOwn(DOCUMENT_TYPES, raw.documentType) ? raw.documentType : 'report';
  const definition = DOCUMENT_TYPES[documentType];
  const sourceMap = new Map(sources.filter((source) => typeof source?.id === 'string' && typeof source?.text === 'string').map((source) => [source.id, source.text]));
  const evidenceMap = new Map([...sourceMap].map(([id, text]) => [id, prepareEvidence(text)]));
  const allText = [...sourceMap.values()].join('\n');
  const fields = [];
  const ids = new Set();
  const rejectedLabels = [];
  for (const candidate of (Array.isArray(raw.fields) ? raw.fields : []).slice(0, 48)) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (options.basisStatus === 'none' && isBasisField(candidate)) continue;
    const candidateId = clean(candidate.id, 80);
    const id = ID_PATTERN.test(candidateId) && !ids.has(candidateId) ? candidateId : `field-${fields.length + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const label = safeLabel(candidate.label, FIELD_LABELS[id] || `항목 ${fields.length + 1}`, allText);
    let value = clean(candidate.value, 2400);
    let quote = clean(candidate.quote, 3000);
    let sourceId = clean(candidate.sourceId, 80);
    let kind = KINDS.has(candidate.kind) ? candidate.kind : 'unknown';
    // A source substring, a quote substring and number agreement are all required.
    // No fallback to the model's knowledge, current date or another user's source.
    const supported = groundedValue(value, quote, evidenceMap.get(sourceId));
    if (kind === 'unknown' || !supported || unknownMarker.test(value)) {
      if (value && kind !== 'unknown' && !unknownMarker.test(value)) rejectedLabels.push(label);
      value = '';
      quote = '';
      sourceId = '';
      kind = 'unknown';
    } else kind = inferKind(value, kind);
    const basis = isBasisField({ id, label });
    fields.push({ id, label, value, kind, sourceId, quote, required: candidate.required === true && (!basis || (options.basisStatus === 'provided' && basisIdentifierField({ id, label }))) });
  }

  // A request such as “...에서 5부씩 받아가라고 ...” already states the
  // collection action. Reuse that verified original excerpt, never invent the
  // paraphrase “직접 방문 수령” (which would fail exact-quote validation).
  // This is deliberately limited to goods-collection cooperation, not every
  // cooperation letter, and must not override an explicit undecided answer.
  if (documentType === 'cooperation') {
    const method = fields.find((field) => field.id === 'receipt_method' && field.kind === 'unknown');
    const request = fields.find((field) => field.id === 'request' && field.kind !== 'unknown'
      && /받아\s*가|(?:방문|직접|와서|오셔서).{0,30}(?:수령|받아|받으)/.test(field.value)
      && !/않|없|못|아니|아닙|불가|미정|정하지|어렵/.test(field.value));
    if (method && request && !isExplicitlyUnresolved(method, sources)) {
      Object.assign(method, { value: request.value, quote: request.quote, sourceId: request.sourceId, kind: request.kind, required: false });
      for (let index = rejectedLabels.length - 1; index >= 0; index--) if (rejectedLabels[index] === method.label) rejectedLabels.splice(index, 1);
    }
  }
  // A directly supplied answer may be misfiled under “협조 사항” even though
  // it already says the requested use/support cannot be provided. Preserve the
  // whole grounded answer instead of asking for the same reply a second time.
  if (documentType === 'reply') {
    const reply = fields.find((field) => field.id === 'reply_content' && field.kind === 'unknown');
    const answer = fields.find((field) => ['request', 'progress', 'status'].includes(field.id)
      && field.kind !== 'unknown' && /^(?:input|answer[-.:])/.test(field.sourceId)
      && /(?:제공|사용|대관|지원|협조|참여|수용).{0,20}(?:할\s*수\s*없(?:습니다|어요|다)|불가(?:합니다|해요|하다|함)|가능(?:합니다|해요|하다|함)|어렵(?:습니다|어요|다))/.test(field.value)
      && !/[?？]|(?:가능|불가|제공).{0,12}(?:여부|인지)/.test(field.value));
    if (reply && answer && !isExplicitlyUnresolved(reply, sources)) {
      Object.assign(reply, { value: answer.value, quote: answer.quote, sourceId: answer.sourceId, kind: answer.kind, required: false });
    }
  }

  if (['cooperation', 'reply'].includes(documentType)) {
    applyCorrespondenceRoles(fields, sources);
    for (const field of fields) ids.add(field.id);
  }

  // Preserve complete direct statements as visible review fields when partial
  // extraction has lost any content. Never repair fabricated/noncontiguous quotes.
  if (options.preserveDirectStatements) {
    let number = 0;
    const whole = (text) => normalized(text).replace(/[.!?。！？]+$/, '');
    for (const statement of directStatements(sources)) {
      if (fields.some((field) => field.kind !== 'unknown' && field.sourceId === statement.sourceId && whole(field.value).includes(whole(statement.text)))) continue;
      const id = statement.id;
      number++;
      if (ids.has(id)) throw new SourceCoverageError('보완 원문 식별자가 겹칩니다. 다시 분석해 주세요.');
      if (fields.length >= 72) throw new SourceCoverageError('원문을 보존하면 검토 항목이 72개를 넘습니다. 자료를 나누어 분석해 주세요.');
      ids.add(id);
      fields.push({ id, label: `보완한 원문 ${number}`, value: statement.text, quote: statement.text, sourceId: statement.sourceId, kind: inferKind(statement.text), required: false });
    }
    if (fields.reduce((sum, field) => sum + field.value.length, 0) > 24000) throw new SourceCoverageError('추출한 내용과 보완 원문의 합계가 24,000자를 넘습니다. 자료를 나누어 분석해 주세요.');
  }

  if (documentType === 'handover') {
    applyHandoverRecipient(fields, sources);
    for (const field of fields) ids.add(field.id);
  }

  for (const field of fields) field.originalValue = field.value;
  const userEditedFieldIds = options.reviewedEdits?.length ? reconcileReviewedEdits(fields, sources, options.reviewedEdits, { preferNewerAnswers: true, ensureEdits: true }) : [];
  for (const field of fields) ids.add(field.id);
  let sections = [];
  const usedIds = new Set();
  const candidates = Array.isArray(raw.sections) && raw.sections.length ? raw.sections.slice(0, 24) : definition.headings.map((heading) => ({ heading, fieldIds: [] }));
  for (const [index, section] of candidates.entries()) {
    if (options.basisStatus === 'none' && isBasisField({ label: section?.heading || '' })) continue;
    const fieldIds = [...new Set(Array.isArray(section?.fieldIds) ? section.fieldIds.filter((id) => ids.has(id) && !usedIds.has(id)) : [])];
    // A rejected heading cannot be renamed by its array position: the model
    // may have grouped activities where the default template puts “목적”.
    const fieldLabels = [...new Set(fieldIds.map((id) => fields.find((field) => field.id === id).label))];
    const fallbackHeading = fieldLabels.length
      ? clean(fieldLabels.slice(0, 3).join(' · ') + (fieldLabels.length > 3 ? ' 등' : ''), 200)
      : '추가 내용';
    const heading = safeLabel(section?.heading, fallbackHeading, allText);
    if (!fieldIds.length) {
      // Preserve empty template headings as explicit gaps rather than dropping them.
      const match = fields.find((field) => !usedIds.has(field.id) && fieldKey(field.label) === fieldKey(heading));
      if (match) fieldIds.push(match.id);
      else {
        let id = `section-${index + 1}`;
        while (ids.has(id)) id += '-gap';
        ids.add(id);
        fields.push({ id, label: heading, value: '', kind: 'unknown', sourceId: '', quote: '', required: false });
        fieldIds.push(id);
      }
    }
    for (const id of fieldIds) usedIds.add(id);
    sections.push({ heading, fieldIds });
  }
  const unplaced = fields.filter((field) => !usedIds.has(field.id)).map((field) => field.id);
  if (unplaced.length) sections.push({ heading: '추가 확인 내용', fieldIds: unplaced });
  if (options.preserveDirectStatements && sections.length > 24) throw new SourceCoverageError('원문을 보존하면 문서 구조가 24개를 넘습니다. 자료나 양식을 나누어 주세요.');

  const knownLabels = new Set(fields.filter((field) => field.kind !== 'unknown').map((field) => fieldKey(field.label)));
  const answered = new Set(answeredFieldIds);
  // “장소와 예산은 아직 정하지 않았어요” already answers both questions.
  // Leave those gaps visible for final review without repeatedly asking them.
  for (const field of fields) {
    if (field.kind === 'unknown' && isExplicitlyUnresolved(field, sources)) answered.add(field.id);
  }
  // These labels help organization but are not missing operational facts.
  for (const field of fields) if (field.kind === 'unknown' && ((documentType === 'journal' && field.id === 'task_name') || (documentType === 'handover' && field.id === 'next_tasks'))) field.required = false;
  // Zero questions is valid. Do not promote an optional blank solely to force
  // a question (for example, unmeasured statistics in an otherwise useful report).
  const askedLabels = new Set();
  const questions = [];
  let askedBasis = false;
  const knownBasis = fields.filter((field) => isBasisField(field) && field.value && field.kind !== 'unknown');
  const knownBasisText = knownBasis.map((field) => field.value).join('\n');
  // The question text is generated locally so a model cannot sneak a supposed
  // fact or several hidden subquestions into a single question.
  const priorityIds = [...(Array.isArray(raw.questions) ? raw.questions.map((item) => item?.fieldId) : []), ...fields.filter((field) => field.required).map((field) => field.id)];
  for (const id of priorityIds) {
    const field = fields.find((item) => item.id === id);
    if (!field || field.kind !== 'unknown' || !field.required || answered.has(id) || knownLabels.has(fieldKey(field.label)) || askedLabels.has(fieldKey(field.label))) continue;
    if (isBasisField(field)) {
      if (askedBasis) continue;
      const alreadyIdentified = field.id === 'basis_number' ? /[\p{L}\d]+-\d+/u.test(knownBasisText)
        : field.id === 'basis_date' ? /\d{4}\s*(?:년|[.\/-])\s*\d{1,2}\s*(?:월|[.\/-])\s*\d{1,2}/.test(knownBasisText)
          : field.id === 'basis_title' ? knownBasis.some((item) => item.id === 'basis_title') || /[「『“"]([^」』”"]+)[」』”"]|\(\s*\d{4}[^()]*[,，]\s*[^()]+\)/.test(knownBasisText)
            : knownBasis.length > 0;
      if (alreadyIdentified) continue;
      askedBasis = true;
    }
    questions.push({ fieldId: id, question: `${field.label}에 관해 확인된 내용을 알려주세요. 모르면 건너뛰어도 됩니다.` });
    askedLabels.add(fieldKey(field.label));
    if (questions.length === 3) break;
  }

  const warnings = ['자료에 적힌 내용을 정리한 초안입니다. 원자료의 정확성과 제출기관의 양식은 직접 확인해 주세요.'];
  if (options.preserveDirectStatements && (fields.length > 72 || fields.reduce((sum, field) => sum + field.value.length, 0) > 24000)) throw new SourceCoverageError('원문과 사용자 정정을 보존하면 검토 한도를 넘습니다. 자료를 나누어 주세요.');
  if (rejectedLabels.length) warnings.push(`원문으로 확인되지 않은 항목은 비워 두었습니다: ${[...new Set(rejectedLabels)].join(', ')}`);
  if (fields.some((field) => field.kind === 'opinion')) warnings.push('반응·만족도·효과에 대한 평가를 객관적 성과와 구분해 주세요.');
  if (fields.some((field) => field.kind === 'prediction')) warnings.push('예상과 기대는 이미 달성한 결과로 제출하지 마세요.');
  // Generic titles/reasons avoid unsupported years, organizations and outcomes.
  return {
    documentType,
    title: definition.label,
    recommendationReason: `${definition.label}의 구조를 제안합니다. 문서 종류와 항목이 목적에 맞는지 확인해 주세요.`,
    fields,
    ...(userEditedFieldIds.length ? { userEditedFieldIds } : {}),
    sections,
    questions,
    warnings,
    // Attachment advice is composed for the actual task in the separate writer.
    // A genre-wide fixed list would suggest photos even for a goods receipt letter.
    suggestedAttachments: [],
    basisStatus: options.basisStatus || 'unknown',
  };
}

/** Render only fields reviewed/edited by the person; never generate new prose. */
export function createDraft(analysis) {
  const fields = Array.isArray(analysis?.fields) ? analysis.fields : [];
  const map = new Map(fields.map((field) => [field.id, field]));
  const missing = (field) => field.kind === 'unknown' || !clean(field.value, 12000);
  const sections = (Array.isArray(analysis?.sections) ? analysis.sections : []).map((section) => ({
    heading: clean(section.heading, 200),
    content: (Array.isArray(section.fieldIds) ? section.fieldIds : []).map((id) => map.get(id)).filter(Boolean).map((field) => {
      const prefix = field.kind === 'opinion' ? '사용자 의견: ' : field.kind === 'prediction' ? '예상·기대: ' : '';
      return `${clean(field.label, 200)}: ${missing(field) ? '[확인 필요]' : prefix + clean(field.value, 12000)}`;
    }).join('\n') || '[확인 필요]',
  }));
  return {
    mode: 'manual',
    documentType: analysis?.documentType || 'report',
    title: clean(analysis?.title, 200) || DOCUMENT_TYPES[analysis?.documentType]?.label || '문서 초안',
    sections,
    unknowns: [...new Set(fields.filter(missing).map((field) => clean(field.label, 200)))],
    unsupportedExpressions: fields.filter((field) => !missing(field) && field.kind === 'opinion').map((field) => `${clean(field.label, 200)}: ${clean(field.value, 12000)} — 사용자 의견이며 객관적 근거를 확인해 주세요.`),
    suggestedAttachments: Array.isArray(analysis?.suggestedAttachments) ? analysis.suggestedAttachments.map((value) => clean(value, 300)) : [],
  };
}

function markdownText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
}

export function toMarkdown(analysis) {
  const draft = createDraft(analysis);
  const list = (items) => items.length ? items.map((item) => `- ${markdownText(item)}`).join('\n') : '- 없음';
  return [
    `# ${markdownText(draft.title)} (검토용 초안)`,
    '> AI문서메이트가 자료를 정리한 검토용 초안입니다. 최종 승인·제출본이 아닙니다.',
    ...draft.sections.map((section) => `## ${markdownText(section.heading)}\n\n${section.content.split('\n').map((line) => `- ${markdownText(line)}`).join('\n')}`),
    `## 추가 확인 필요\n\n${list(draft.unknowns)}`,
    `## 근거를 확인할 표현\n\n${list(draft.unsupportedExpressions)}`,
    `## 첨부하면 좋은 자료\n\n${list(draft.suggestedAttachments)}`,
    '## 제출 전 검토\n\n- [ ] 날짜·인원·금액·기관명과 원자료 대조\n- [ ] 의견·예상과 확인된 사실 구분\n- [ ] 빈 항목과 제출기관 양식 확인\n- [ ] 개인정보·공유 권한 확인\n- [ ] 담당자 최종 검토',
  ].join('\n\n') + '\n';
}
