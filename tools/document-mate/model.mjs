/** Browser-safe, deterministic document model. No network or storage access. */
export const DOCUMENT_TYPES = Object.freeze({
  plan: { label: '계획서', headings: ['추진 배경', '목적', '대상', '기간', '장소', '주요 내용', '추진 일정', '역할', '준비사항', '예산', '기대 결과'] },
  report: { label: '결과보고서', headings: ['개요', '추진 내용', '활동 결과', '확인된 성과', '문제점', '개선방안', '첨부자료'] },
  minutes: { label: '회의록', headings: ['회의명', '일시', '장소', '참석자', '주요 안건', '논의 내용', '결정사항', '담당자', '후속 일정'] },
  journal: { label: '업무일지', headings: ['날짜', '업무명', '수행 내용', '진행상황', '문제사항', '조치사항', '다음 업무'] },
  handover: { label: '인수인계서', headings: ['업무명', '현재 상태', '주요 업무', '진행 중 업무', '관련 파일·자료', '주요 연락처', '주의사항', '다음 담당자가 해야 할 일'] },
});

const ATTACHMENTS = {
  plan: ['추진 일정표', '예산 산출 근거(해당하는 경우)'],
  report: ['활동 기록·사진(공유 권한 확인)', '성과를 확인할 수 있는 원자료'],
  minutes: ['회의 안건 자료', '결정사항 확인 자료'],
  journal: ['업무 산출물', '진행상황을 확인할 수 있는 기록'],
  handover: ['관련 파일 목록과 접근 방법', '미완료 업무 목록'],
};
export const FIELD_LABELS = Object.freeze({
  purpose: '작성 목적', reader: '제출 대상', period: '활동 기간', date: '날짜', location: '장소',
  activities: '주요 활동', activity_content: '주요 활동', main_content: '주요 내용', feedback: '반응',
  results: '확인된 성과', quantitative_results: '확인된 성과', target_audience: '대상', issues: '문제점',
  improvements: '개선방안', schedule: '추진 일정', budget: '예산', expectations: '기대 결과',
  meeting_name: '회의명', participants: '참석자', agenda: '주요 안건', discussion: '논의 내용',
  decisions: '결정사항', action_items: '후속 조치', owner: '담당자', status: '현재 상태',
  task_name: '업무명', tasks: '주요 업무', pending_tasks: '미완료 업무', next_tasks: '다음 업무',
  attachments: '첨부자료', references: '관련 자료', contacts: '연락처', cautions: '주의사항',
});
const KINDS = new Set(['fact', 'opinion', 'prediction', 'unknown']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '';
const normalized = (value) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const fieldKey = (value) => normalized(value).replace(/[\s·/()\[\]:_-]/g, '').toLowerCase();
const numbers = (value) => value.match(/\d+(?:[,.]\d+)*(?:\s*[%％])?/g) || [];
const hasNewNumbers = (value, evidence) => numbers(value).some((number) => !numbers(evidence).includes(number));
const unknownMarker = /^(?:\[?\s*(?:확인\s*필요|미확인|미입력|(?:아직\s*)?미정|자료\s*없음|정보\s*없음|협의\s*필요|(?:잘\s*)?모름|모릅니다|몰라요|(?:잘\s*)?모르겠(?:어요|습니다)|(?:아직\s*)?(?:정하지\s*않았(?:어요|습니다)|결정되지\s*않았(?:어요|습니다)))\s*\]?)\.?$/;
const predictionPattern = /(?:예상|기대|전망|추정|예정|예측|목표|가정|만약|잠정|것(?:이다|입니다|으로)|높아질|증가할|개선될|향상될|계획(?:이다|입니다|임|해|하))/;
const conditionalPattern = /(?:조건|경우|(?:이|라|으|되|하|가|오|된다|한다|있다|없다)면(?=[\s,.!?\d]|$)|약\s*\d)/;
const opinionPattern = /(?:반응.{0,8}(?:좋|긍정)|만족도.{0,8}(?:높|좋)|효과.{0,8}(?:있|좋)|성과.{0,8}(?:있|좋)|참여.{0,8}많|홍보.{0,8}잘|좋았|좋은|높았|낮았|많았|훌륭|성공적|효과적|긍정적|부정적|만족스러|만족하|아쉽|보람|생각(?:한다|합니다|해|합)|느꼈)/;
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
].map(fieldKey));

/** Classify explicit user edits as well as AI extracts. A newly filled unknown
 * field is classified from its new value; an explicit unknown marker stays empty. */
export function inferKind(value, preferred = 'fact') {
  const text = clean(value, 12000);
  if (!text || unknownMarker.test(text)) return 'unknown';
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
  for (const match of evidence.raw.matchAll(/[\n\r!?。！？]|\.(?!\d)/g)) {
    if (match.index < rawStart) from = match.index + 1;
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
export function normalizeAnalysis(raw, sources = [], answeredFieldIds = []) {
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
    fields.push({ id, label, value, kind, sourceId, quote, required: candidate.required === true });
  }

  let sections = [];
  const usedIds = new Set();
  const candidates = Array.isArray(raw.sections) && raw.sections.length ? raw.sections.slice(0, 24) : definition.headings.map((heading) => ({ heading, fieldIds: [] }));
  for (const [index, section] of candidates.entries()) {
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

  const knownLabels = new Set(fields.filter((field) => field.kind !== 'unknown').map((field) => fieldKey(field.label)));
  const answered = new Set(answeredFieldIds);
  // A concise extraction still needs one useful follow-up when an essential
  // outcome/decision is absent. Do not let an all-false model flag disable it.
  const coreIds = {
    plan: ['purpose', 'main_content', 'activities', 'schedule'],
    report: ['purpose', 'quantitative_results', 'results', 'issues'],
    minutes: ['purpose', 'decisions', 'action_items'],
    journal: ['purpose', 'status', 'next_tasks'],
    handover: ['purpose', 'status', 'pending_tasks', 'next_tasks'],
  }[documentType];
  if (!fields.some((field) => field.required && field.kind === 'unknown' && !answered.has(field.id))) {
    const importantGap = coreIds.map((id) => fields.find((field) => field.id === id))
      .find((field) => field && field.kind === 'unknown' && !answered.has(field.id) && !knownLabels.has(fieldKey(field.label)));
    if (importantGap) importantGap.required = true;
  }
  const askedLabels = new Set();
  const questions = [];
  // The question text is generated locally so a model cannot sneak a supposed
  // fact or several hidden subquestions into a single question.
  const priorityIds = [...(Array.isArray(raw.questions) ? raw.questions.map((item) => item?.fieldId) : []), ...fields.filter((field) => field.required).map((field) => field.id)];
  for (const id of priorityIds) {
    const field = fields.find((item) => item.id === id);
    if (!field || field.kind !== 'unknown' || !field.required || answered.has(id) || knownLabels.has(fieldKey(field.label)) || askedLabels.has(fieldKey(field.label))) continue;
    questions.push({ fieldId: id, question: `${field.label}에 관해 확인된 내용을 알려주세요. 모르면 건너뛰어도 됩니다.` });
    askedLabels.add(fieldKey(field.label));
    if (questions.length === 3) break;
  }

  const warnings = ['자료에 적힌 내용을 정리한 초안입니다. 원자료의 정확성과 제출기관의 양식은 직접 확인해 주세요.'];
  if (rejectedLabels.length) warnings.push(`원문으로 확인되지 않은 항목은 비워 두었습니다: ${[...new Set(rejectedLabels)].join(', ')}`);
  if (fields.some((field) => field.kind === 'opinion')) warnings.push('반응·만족도·효과에 대한 평가를 객관적 성과와 구분해 주세요.');
  if (fields.some((field) => field.kind === 'prediction')) warnings.push('예상과 기대는 이미 달성한 결과로 제출하지 마세요.');
  // Generic titles/reasons avoid unsupported years, organizations and outcomes.
  return {
    documentType,
    title: definition.label,
    recommendationReason: `${definition.label}의 구조를 제안합니다. 문서 종류와 항목이 목적에 맞는지 확인해 주세요.`,
    fields,
    sections,
    questions,
    warnings,
    suggestedAttachments: [...ATTACHMENTS[documentType]],
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
