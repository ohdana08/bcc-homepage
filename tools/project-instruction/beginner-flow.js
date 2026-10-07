import { emptyProjectState, splitItems } from './local-engine.js';

export const BEGINNER_STORAGE_KEY = 'bcc-project-instruction-v5-beginner';
export const BEGINNER_ENGINE = 'local-beginner-v1';
export const LEGACY_KEYS = ['bcc-project-instruction-v4-workflows', 'bcc-project-instruction-classroom-v3-plain'];
export const NARROW_QUESTION = '오늘은 이 중 하나만 먼저 만들어 볼게요. 어떤 걸 고를까요?';
export const MICROPHONE_GUIDANCE = '키보드의 마이크 버튼을 누르면 말로 답할 수 있어요';
export const BEGINNER_QUESTIONS = [
  { id: 'work', label: '반복하는 일', prompt: '요즘 일하면서 "아, 이거 또 해야 해?" 싶은 일이 뭐예요?', example: '매일 주문 내용을 엑셀에 옮겨 적어요.', chips: ['엑셀 정리', '문서 쓰기', '답장 쓰기', '일정 챙기기', '자료 찾기'] },
  { id: 'flow', label: '지금 하는 순서', prompt: '그 일은 보통 어떤 순서로 하세요?', example: '카톡으로 주문 받고 → 엑셀에 옮겨 적고 → 금액 계산해서 → 사장님께 보내요', chips: [] },
  { id: 'material', label: '처음 가진 것', prompt: '그 일을 시작할 때 손에 들고 있는 게 뭐예요?', example: '주문한 내용이 담긴 카톡 메시지가 있어요.', chips: ['카톡 메시지', '엑셀 파일', '사진', '종이 메모', '이메일'] },
  { id: 'result', label: '끝나면 줄 것', prompt: '다 끝나면 뭐가 나와야 하고, 누구한테 줘요?', example: '정리된 표를 팀장님께', chips: [] },
  { id: 'accuracy', label: '틀리면 안 되는 것', prompt: '이것만은 틀리면 안 되는 게 있나요?', example: '주문한 사람의 이름과 금액이 맞아야 해요.', chips: ['금액', '날짜', '이름', '없음'] },
  { id: 'rhythm', label: '횟수와 걸리는 시간', prompt: '얼마나 자주 하고, 한 번에 얼마나 걸려요?', example: '매일 하고, 한 번에 30분 정도 걸려요.', groups: [{ id: 'frequency', label: '하는 횟수', chips: ['매일', '매주', '매달'] }, { id: 'duration', label: '한 번에 걸리는 시간', chips: ['10분', '30분', '1시간 이상'] }] },
];
const QUESTION_IDS = BEGINNER_QUESTIONS.map(q => q.id);
const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const clone = value => JSON.parse(JSON.stringify(value));
export const answerLength = value => Array.from(clean(value)).length;
export function newBeginnerSession() {
  return { engine: BEGINNER_ENGINE, startMode: '', index: 0, phase: 'questions', answers: {}, answerHistory: [], draftsByStage: {}, draft: '', shortRetries: {}, workChoice: '', workOptions: [], rhythmChoices: { frequency: '', duration: '' }, returnToConfirmation: false, markdown: '', legacy: null };
}
export function restoreBeginnerSession(value) {
  if (!value || value.engine !== BEGINNER_ENGINE || !['idea', 'unsure'].includes(value.startMode) || !['questions', 'narrow', 'confirm', 'review', 'complete'].includes(value.phase) || !Number.isInteger(value.index) || value.index < 0 || value.index > 5) return null;
  const session = { ...newBeginnerSession(), ...clone(value) };
  for (const field of ['answers', 'draftsByStage', 'shortRetries', 'rhythmChoices']) {
    if (!session[field] || typeof session[field] !== 'object' || Array.isArray(session[field])) return null;
  }
  if (!Array.isArray(session.answerHistory) || !Array.isArray(session.workOptions) || typeof session.draft !== 'string') return null;
  if (QUESTION_IDS.some(id => session.answers[id] !== undefined && typeof session.answers[id] !== 'string')) return null;
  if (['confirm', 'review', 'complete'].includes(session.phase) && QUESTION_IDS.some(id => !clean(session.answers[id]))) return null;
  if (session.phase === 'complete' && typeof session.markdown !== 'string') return null;
  return session;
}

// A narrow local rule recognises explicit lists of actions, not arbitrary prose.
// It never deletes the original or chooses which task the person intended.
export function detectWorkOptions(answer) {
  if (/https?:\/\/|^[/~]|[A-Za-z]:\\/.test(clean(answer))) return [];
  const options = clean(answer).split(/\s*(?:[,，;；·+\/\n]+|\s+(?:그리고|또는|및)\s+|(?:하고|이랑|랑|와|과)\s+)\s*/).map(part => part.replace(/^[-•\d.)]+\s*/, '').trim()).filter(Boolean);
  const action = /정리|쓰기|작성|답장|회신|챙기|찾기|찾아|검색|계산|옮기|집계|보내|만들|확인|관리|예약|회의록|공문|보고서|견적서/;
  if (options.length < 2 || options.length > 8 || options.some(part => part.length > 160 || !action.test(part) || /^(?:특히|예를|그중|예컨대)/.test(part))) return [];
  return [...new Set(options)].length > 1 ? [...new Set(options)] : [];
}
function advance(session) {
  if (session.returnToConfirmation || session.index === 5) {
    const missing = QUESTION_IDS.findIndex(id => !clean(session.answers[id]));
    if (missing >= 0) {
      session.index = missing; session.phase = 'questions'; session.returnToConfirmation = false;
      session.draft = session.draftsByStage[QUESTION_IDS[missing]] || '';
      return { session, status: 'advance' };
    }
    session.phase = 'confirm'; session.returnToConfirmation = false; session.draft = ''; session.markdown = '';
    return { session, status: 'confirm' };
  }
  session.index += 1; session.phase = 'questions';
  session.draft = session.draftsByStage[QUESTION_IDS[session.index]] ?? session.answers[QUESTION_IDS[session.index]] ?? '';
  return { session, status: 'advance' };
}
export function submitBeginnerAnswer(current, rawAnswer) {
  const session = clone(current);
  const answer = clean(rawAnswer);
  const id = QUESTION_IDS[session.index];
  session.draft = rawAnswer;
  if (session.phase === 'questions') session.draftsByStage[id] = rawAnswer;
  if (!answer) return { session, status: 'empty', message: '한마디만 적어주세요. 아직 모르겠다고 적어도 괜찮아요.' };
  if (session.phase === 'narrow') {
    if (!session.workOptions.includes(answer)) return { session, status: 'choice', message: '아래에서 하나를 골라주세요. 앞의 답을 바꾸려면 이전 답변 수정으로 돌아갈 수 있어요.' };
    session.workChoice = answer;
    session.answerHistory.push({ question: 'workChoice', answer });
    session.draftsByStage.work = session.answers.work;
    return advance(session);
  }
  if (session.phase !== 'questions') return { session, status: 'ignored' };
  if (answerLength(answer) <= 10 && !session.shortRetries[id]) {
    session.shortRetries[id] = true;
    return { session, status: 'short', message: '조금만 더 들려주실래요? 예: ' + BEGINNER_QUESTIONS[session.index].example + '\n짧게 적어도 괜찮아요. 한 번 더 보내면 다음으로 넘어가요.' };
  }
  session.answers[id] = answer;
  session.answerHistory.push({ question: id, answer });
  session.draftsByStage[id] = answer;
  session.markdown = '';
  if (id === 'work') {
    session.workChoice = ''; session.workOptions = detectWorkOptions(answer);
    if (session.workOptions.length) { session.phase = 'narrow'; session.draft = ''; return { session, status: 'narrow' }; }
  }
  return advance(session);
}
export function editBeginnerQuestion(current, index, returnToConfirmation = false) {
  if (!Number.isInteger(index) || index < 0 || index > 5) throw new Error('질문을 다시 확인해 주세요.');
  const session = clone(current);
  if (session.phase === 'questions') session.draftsByStage[QUESTION_IDS[session.index]] = session.draft;
  session.index = index; session.phase = 'questions'; session.returnToConfirmation = returnToConfirmation;
  session.draft = session.draftsByStage[QUESTION_IDS[index]] ?? session.answers[QUESTION_IDS[index]] ?? '';
  session.markdown = '';
  return session;
}
const chipToken = value => new RegExp('(^|[\\s·,;()])' + value + '(?=$|[\\s·,;()])');
export function rhythmChoicesFromText(value) {
  return Object.fromEntries(BEGINNER_QUESTIONS[5].groups.map(group => {
    const found = group.chips.filter(chip => chipToken(chip).test(value));
    return [group.id, found.length === 1 ? found[0] : ''];
  }));
}
export function selectRhythmChip(current, group, value) {
  const session = clone(current);
  const definition = BEGINNER_QUESTIONS[5].groups.find(item => item.id === group);
  if (!definition?.chips.includes(value)) return session;
  session.rhythmChoices = rhythmChoicesFromText(session.draft);
  const previous = session.rhythmChoices[group];
  session.rhythmChoices[group] = value;
  const text = session.draft || '';
  // Replace only this group's earlier chip. Preserve custom text and the other group.
  const previousToken = previous ? chipToken(previous) : null;
  if (previousToken && previousToken.test(text)) session.draft = text.replace(previousToken, (_, before) => before + value);
  else if (!text.includes(value)) session.draft = [text.trim(), value].filter(Boolean).join(' · ');
  session.draftsByStage.rhythm = session.draft;
  return session;
}

// Only explicit delivery markers allow a recipient to be extracted. If the
// sentence has no such marker, keep its result text visible and say who is unknown.
export function deliverySummary(rawAnswer) {
  const raw = clean(rawAnswer);
  if (!raw || /^(?:아직\s*)?(?:모르|미정)/.test(raw)) return { result: '아직 정하지 않은 결과', recipient: '아직 정하지 않은 사람', raw };
  const match = raw.match(/^(.+?)(?:을|를)\s+([^\n,;]+?)(?:에게|한테|께)(?:\s*(?:드려요|줘요|주어요|줍니다|드립니다|보내요|보냅니다|전달해요|전달합니다))?[.!。]?$/);
  if (match && clean(match[1]) && clean(match[2]) && !/만들|만든|정리|완성|해서|하고|보내|전달/.test(match[2])) return { result: clean(match[1]), recipient: clean(match[2]), raw };
  return { result: raw, recipient: '아직 정하지 않은 사람', raw };
}
export function beginnerConfirmation(session) {
  const delivery = deliverySummary(session.answers.result);
  const material = clean(session.answers.material) || '아직 정하지 않은 자료';
  const finalCode = text => [...text].at(-1)?.charCodeAt(0);
  const ending = text => { const code = finalCode(text); return code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0; };
  const objectParticle = ending(material) ? '을' : '를';
  const directionParticle = ending(delivery.result) && ending(delivery.result) !== 8 ? '으로' : '로';
  return { text: '제가 이해한 내용이에요: ' + material + objectParticle + ' 받아서 ' + delivery.result + directionParticle + ' 만들어 ' + delivery.recipient + '에게 주는 것. 맞나요?', ...delivery };
}
export function migrateLegacyRecord(raw, key) {
  let legacy;
  try { legacy = JSON.parse(raw); } catch { return null; }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  const state = legacy.state || {};
  const answers = state.answers || {};
  const session = newBeginnerSession();
  session.startMode = 'idea';
  session.legacy = { key, raw };
  const value = (answer, fallback) => clean(answer || (Array.isArray(fallback) ? fallback.join('\n') : fallback));
  const mapped = { work: value(answers.problem, state.problem), flow: value(answers.flow, state.userFlow), material: value(answers.inputs, state.inputs), result: value(answers.solution, state.solution) };
  for (const [id, answer] of Object.entries(mapped)) if (answer) { session.answers[id] = answer; session.draftsByStage[id] = answer; }
  const stageMap = { problem: 'work', flow: 'flow', inputs: 'material', solution: 'result' };
  for (const [stage, draft] of Object.entries(legacy.draftsByStage || {})) if (stageMap[stage] && typeof draft === 'string') session.draftsByStage[stageMap[stage]] = draft;
  const draftId = stageMap[legacy.stage];
  if (draftId && typeof legacy.draft === 'string' && legacy.draft) session.draftsByStage[draftId] = legacy.draft;
  const firstMissing = QUESTION_IDS.findIndex(id => !session.answers[id]);
  session.index = Math.max(0, firstMissing);
  session.draft = session.draftsByStage[QUESTION_IDS[session.index]] || '';
  session.workOptions = detectWorkOptions(session.answers.work);
  if (session.workOptions.length) { session.index = 0; session.phase = 'narrow'; session.draft = ''; }
  return session;
}
export function beginnerProjectState(session) {
  let retained = {};
  if (session.legacy?.raw) {
    try { retained = JSON.parse(session.legacy.raw).state || {}; } catch { /* preserved raw remains available */ }
  }
  const state = { ...emptyProjectState(), ...clone(retained) };
  const a = session.answers;
  if (a.work) state.problem = session.workChoice || a.work;
  if (a.flow) { state.currentMethod = a.flow; state.userFlow = splitItems(a.flow); }
  if (a.material) state.inputs = [a.material];
  if (a.result) { state.solution = a.result; state.oneLine = a.result; state.outputs = [a.result]; }
  // Accuracy and time are reported answers, not invented acceptance tests or measured savings.
  state.beginner = { answers: clone(a), answerHistory: clone(session.answerHistory), workChoice: session.workChoice, workOptions: clone(session.workOptions), retainedLegacy: !!session.legacy };
  return state;
}
