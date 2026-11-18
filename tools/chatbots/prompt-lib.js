// BCC 챗봇 도구 — 프롬프트·정리본 순수 함수 모음 (DOM 없음, 브라우저·Node 테스트 공용)
// 2026-11-18: 도구별 꼬리 문구·템플릿·첨부 자료 지원 추가. 설정이 없는 기존 도구의 출력은 이전과 글자 단위로 같아야 한다.

export const FOOTER = '🔒 본 챗봇은 **비즈니스커리어컨설팅**(대표: 오예림)이 제작한 콘텐츠입니다. 무단 복제·재배포·상업적 활용을 금지합니다. 문의: https://pf.kakao.com/_xbrxjxkxj/chat';

// 기존 모든 도구의 기본 꼬리 문구(변경 금지)
const DEFAULT_PROCEED = '[진행 방법]\n위 입력을 이미 받은 것으로 보고, 지침의 다음 단계부터 바로 시작하세요. 한 번에 질문 하나씩, 사용자가 답하면 다음으로 넘어가세요. 입력에 없는 내용은 지어내지 말고 물어보세요.';
// prompt_tail: "direct" 인 도구 전용 — 외부 AI가 질문 없이 첫 응답에서 결과를 완성하게 한다
const DIRECT_PROCEED = "[진행 방법]\n위 입력을 이미 받은 것으로 처리하고, 추가 질문 없이 첫 응답에서 지정된 출력 형식 전체를 완성하세요. 정보가 부족하면 질문하지 말고 '미확인/가설'로 표시하세요.";

// 문장 끝의 마침표·쉼표 등만 지운다(괄호·따옴표는 의미가 있으므로 지우지 않는다)
export function stripEnd(s){ return String(s ?? '').trim().replace(/[\s.。!?…,，;:]+$/u, '').trim(); }

// 한글 조사 선택: kind = '은는' | '을를' | '이가' | '으로'
export function josa(word, kind){
  const w = String(word ?? '').trim();
  let ch = '';
  for (let i = w.length - 1; i >= 0; i--) { const c = w[i]; if (/[가-힣0-9A-Za-z]/.test(c)) { ch = c; break; } }
  let batchim = null; // true/false/null(모름)
  let rieul = false;
  if (/[가-힣]/.test(ch)) { const code = ch.charCodeAt(0) - 0xAC00; const j = code % 28; batchim = j !== 0; rieul = j === 8; }
  else if (/[0-9]/.test(ch)) { batchim = '013678'.includes(ch); rieul = ch === '1' || ch === '7' || ch === '8'; } // 영·일·삼·육·칠·팔 = 받침 있음, 일·칠·팔 = ㄹ받침
  else if (/[A-Za-z]/.test(ch)) { const lc = ch.toLowerCase(); batchim = 'lmnr'.includes(lc); rieul = lc === 'l' || lc === 'r'; }
  if (batchim === null) batchim = false;
  if (kind === '은는') return batchim ? '은' : '는';
  if (kind === '을를') return batchim ? '을' : '를';
  if (kind === '이가') return batchim ? '이' : '가';
  if (kind === '으로') return (!batchim || rieul) ? '로' : '으로';
  return '';
}

export function attachText(answers, s){ return String((answers && answers[s.key + '__attach']) || '').trim(); }

// 선택형 질문에서 "직접 쓴 글"을 결과에 넣을지 (custom_when이 있으면 그 선택지일 때만)
function customApplies(s, answers){ return s.custom_when === undefined || answers[s.key] === s.custom_when; }

export function valueText(bot, answers, s){
  const v = answers[s.key]; const c = answers[s.key + '__custom'];
  let t = Array.isArray(v) ? v.join(', ') : (v || '');
  if (s.options && c && c !== t && !t.includes(c) && customApplies(s, answers)) t = t ? `${t} (${s.custom_label || '직접 입력'}: ${c})` : c;
  return t || '(비움)';
}

// 질문 답이 비었는지(첨부 자료가 있으면 비지 않은 것으로 본다)
export function isFilled(answers, s){
  const v = answers[s.key];
  const has = Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
  return has || !!attachText(answers, s);
}

function stepByKey(bot, k){ return (bot.steps || []).find(x => x.key === k); }

// 템플릿 치환: {{key}} 답 / {{key:은는}} 조사 / {{key_attach}} 첨부 / {{key_choice}} 선택 / {{key_custom}} 직접 쓴 글 / 특수값
export function fillTemplate(bot, answers, tpl, opt){
  const o = opt || {};
  return String(tpl).replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (_, k, jo) => {
    if (k === 'today') return o.today || '';
    if (k === 'stmt') return (answers.__stmt && answers.__stmt.trim()) || composeStatement(bot, answers);
    if (k === 'cause') return (answers.__cause && answers.__cause.trim()) || '입력 없음';
    if (k === 'input_mode') return inputMode(bot, answers);
    let key = k, kind = 'text';
    if (/_attach$/.test(k) && stepByKey(bot, k.replace(/_attach$/, ''))) { key = k.replace(/_attach$/, ''); kind = 'attach'; }
    else if (/_choice$/.test(k) && stepByKey(bot, k.replace(/_choice$/, ''))) { key = k.replace(/_choice$/, ''); kind = 'choice'; }
    else if (/_custom$/.test(k) && stepByKey(bot, k.replace(/_custom$/, ''))) { key = k.replace(/_custom$/, ''); kind = 'custom'; }
    const s = stepByKey(bot, key);
    if (!s) return answers[k] || '';
    if (kind === 'attach') return attachText(answers, s) || s.empty_text || '첨부 자료 없음';
    if (kind === 'choice') { const v = answers[s.key]; return (Array.isArray(v) ? v.join(', ') : v) || '선택 안 함'; }
    if (kind === 'custom') { const c = String(answers[s.key + '__custom'] || '').trim(); return (c && customApplies(s, answers)) ? c : '해당 없음'; }
    const raw = Array.isArray(answers[s.key]) ? answers[s.key].join(', ') : String(answers[s.key] || '').trim();
    const val = raw || s.empty_text || '미입력';
    return jo ? stripEnd(val) + josa(val, jo) : val;
  });
}

export function composeStatement(bot, answers){
  if (!bot.statement_template) return '';
  const filled = fillTemplate(bot, answers, bot.statement_template.replace(/\{\{(\w+)(:[^}]+)?\}\}/g, (m, k, jo) => {
    const s = stepByKey(bot, k); if (!s) return m;
    const raw = stripEnd(answers[s.key] || '') || '(추가 확인 필요)';
    return raw + (jo ? josa(raw, jo.slice(1)) : '');
  }));
  return filled;
}

export function inputMode(bot, answers){
  const d = (bot.steps || []).find(s => s.key === 'doc'); const i = (bot.steps || []).find(s => s.key === 'item');
  const hasDoc = d && isFilled(answers, d); const hasItem = i && isFilled(answers, i) && String(answers.item || '').trim() !== '미정';
  if (hasDoc && hasItem) return '문제 정의서 + 제품·서비스 설명';
  if (hasDoc) return '문제 정의서 기반';
  if (hasItem) return '제품·서비스 설명 기반';
  return '입력 부족';
}

// 완성 프롬프트
export function buildPrompt(bot, answers, opt){
  if (bot.prompt_template) {
    const body = fillTemplate(bot, answers, bot.prompt_template, opt);
    const proceed = bot.prompt_tail === 'direct' ? DIRECT_PROCEED : DEFAULT_PROCEED;
    return `${body}\n\n---\n${proceed}\n\n[출력 규칙]\n모든 응답의 맨 마지막에 아래 문구를 그대로 붙이세요.\n---\n${FOOTER}`;
  }
  const inputs = bot.steps.map(s => `- ${s.label || s.question}: ${valueText(bot, answers, s)}`).join('\n');
  const proceed = bot.prompt_tail === 'direct' ? DIRECT_PROCEED : DEFAULT_PROCEED;
  return `${bot.prompt_header}\n\n---\n[사용자가 미리 적어둔 입력]\n${inputs}\n\n${proceed}\n\n[출력 규칙]\n모든 응답의 맨 마지막에 아래 문구를 그대로 붙이세요.\n---\n${FOOTER}`;
}
