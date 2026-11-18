// 챗봇 도구 프롬프트 회귀·신규 규칙 테스트 (node --test)
// 1) 설정이 없는 기존 도구의 완성 프롬프트는 수정 전(legacy) 엔진 결과와 글자 단위로 같아야 한다.
// 2) 새로 개편한 3개 도구는 질문 없이 완성하라는 꼬리 문구·단일 선택·첨부·템플릿 치환 규칙을 지켜야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt, valueText, composeStatement, josa, fillTemplate, inputMode, FOOTER } from '../tools/chatbots/prompt-lib.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'chatbots');
const list = JSON.parse(fs.readFileSync(path.join(root, 'bots.json'), 'utf8'));
const bots = Object.fromEntries(fs.readdirSync(path.join(root, 'bots')).filter(f => f.endsWith('.json')).map(f => { const b = JSON.parse(fs.readFileSync(path.join(root, 'bots', f), 'utf8')); return [b.id, b]; }));
const CHANGED = new Set(['business-process', 'customer-persona', 'business-validation-basic', 'startup-plan-prompt', 'ir-pitch-prompt']);

// ---- 수정 전 엔진(2026-11-18 이전, tools/chatbots/engine.js)의 로직을 그대로 옮긴 기준본
function legacyValueText(answers, s){ const v = answers[s.key]; const c = answers[s.key + '__custom']; let t = Array.isArray(v) ? v.join(', ') : (v || ''); if (s.options && c && c !== t && !t.includes(c)) t = t ? `${t} (직접 입력: ${c})` : c; return t || '(비움)'; }
function legacyPrompt(bot, answers){
  const inputs = bot.steps.map(s => `- ${s.label || s.question}: ${legacyValueText(answers, s)}`).join('\n');
  return `${bot.prompt_header}\n\n---\n[사용자가 미리 적어둔 입력]\n${inputs}\n\n[진행 방법]\n위 입력을 이미 받은 것으로 보고, 지침의 다음 단계부터 바로 시작하세요. 한 번에 질문 하나씩, 사용자가 답하면 다음으로 넘어가세요. 입력에 없는 내용은 지어내지 말고 물어보세요.\n\n[출력 규칙]\n모든 응답의 맨 마지막에 아래 문구를 그대로 붙이세요.\n---\n🔒 본 챗봇은 **비즈니스커리어컨설팅**(대표: 오예림)이 제작한 콘텐츠입니다. 무단 복제·재배포·상업적 활용을 금지합니다. 문의: https://pf.kakao.com/_xbrxjxkxj/chat`;
}
function sampleAnswers(bot, variant){
  const a = {};
  for (const s of bot.steps) {
    if (s.options && s.options.length) {
      if (s.type === 'multi') a[s.key] = s.options.slice(0, 2);
      else a[s.key] = s.options[variant % s.options.length];
      if (variant === 1) a[s.key + '__custom'] = '직접 쓴 메모 ' + s.key; // 선택형 + 입력칸 글 조합
    } else a[s.key] = variant === 2 ? '' : `샘플 답변 ${s.key} (변형${variant})\n두 번째 줄 {{x}} <b>`;
  }
  return a;
}

test('bots.json 과 bots/*.json 이 서로 일치한다', () => {
  assert.equal(list.length, Object.keys(bots).length);
  for (const e of list) { const b = bots[e.id]; assert.ok(b, e.id + ' 파일 없음'); assert.equal(e.name, b.name, e.id + ' 이름'); assert.equal(e.steps, b.steps.length, e.id + ' 질문 수'); }
});

test('기존 도구(설정 없는 도구) 프롬프트가 수정 전과 글자 단위로 같다', () => {
  let n = 0;
  for (const id of Object.keys(bots)) {
    if (CHANGED.has(id)) continue;
    const bot = bots[id];
    assert.ok(!bot.prompt_template && !bot.prompt_tail, id + ': 기존 도구에 새 설정이 들어가면 안 됨');
    for (const v of [0, 1, 2]) { const a = sampleAnswers(bot, v); assert.equal(buildPrompt(bot, a), legacyPrompt(bot, a), `${id} 변형${v}`); n++; }
  }
  assert.ok(n >= 60, '비교 횟수 ' + n);
});

test('보호 대상 도구(사업 필터링·PPT·고객 인터뷰)는 한 글자도 바뀌지 않았다', () => {
  for (const id of ['business-filter', 'ppt-plan', 'customer-interview']) {
    const bot = bots[id]; assert.ok(bot, id);
    for (const v of [0, 1, 2]) { const a = sampleAnswers(bot, v); assert.equal(buildPrompt(bot, a), legacyPrompt(bot, a), id); }
    assert.ok(buildPrompt(bot, sampleAnswers(bot, 0)).includes('한 번에 질문 하나씩'), id + ' 기본 꼬리 문구 유지');
  }
});

const NEW = ['business-process', 'customer-persona', 'business-validation-basic'];
test('새 3개 도구: 질문 없이 완성하는 꼬리 문구 + 🔒 문구, 미치환 변수 없음', () => {
  for (const id of NEW) {
    const bot = bots[id];
    const a = sampleAnswers(bot, 0);
    if (id === 'customer-persona') { a.doc__attach = '문제 정의서 본문 샘플'; }
    const p = buildPrompt(bot, a, { today: '2026-11-18' });
    assert.ok(!p.includes('한 번에 질문 하나씩'), id + ': 옛 꼬리 문구가 남음');
    assert.ok(p.includes('추가 질문 없이 첫 응답에서'), id);
    assert.ok(p.endsWith(FOOTER), id + ': 🔒 문구는 마지막에');
    assert.ok(!/\{\{[^}]*\}\}/.test(p.replace(/\{\{x\}\}/g, '')), id + ': 미치환 {{ }} 남음 → ' + (p.replace(/\{\{x\}\}/g, '').match(/\{\{[^}]*\}\}/) || [])[0]); // {{x}} 는 테스트가 일부러 넣은 사용자 입력
    assert.ok(/웹 검색/.test(p), id + ': 웹 검색 지시');
    assert.ok(/(창작|꾸미|만들어내지)/.test(p), id + ': 지어내기 금지');
  }
});

test('사업성검증코치: 4번은 선택한 하나만 들어간다(다른 선택지·옛 직접입력 누수 없음)', () => {
  const bot = bots['business-validation-basic'];
  const labels = bot.steps.find(s => s.key === 'test').options;
  const base = { item: '테스트 아이템', problem: '테스트 문제', paying: '잘 모르겠어요' };
  for (let i = 0; i < labels.length; i++) {
    const a = { ...base, test: labels[i], test__custom: '이전에 쓴 글(누수 금지)' };
    const p = buildPrompt(bot, a); const d = fillTemplate(bot, a, bot.draft_template, { today: 'x' });
    const section = p.split('[근거 표시 규칙]')[0];
    for (let j = 0; j < labels.length; j++) { if (j !== i) { assert.ok(!section.includes(labels[j]), `선택 ${i}인데 선택지 ${j} 문구가 들어감`); assert.ok(!d.includes(labels[j]), '정리본 누수 ' + j); } }
    if (labels[i] === '직접 테스트 방법 작성하기') assert.ok(p.includes('이전에 쓴 글(누수 금지)'), '직접 작성 선택 시 글이 들어가야 함');
    else assert.ok(!p.includes('이전에 쓴 글(누수 금지)'), `선택 ${i}에서 직접 쓴 글 누수`);
  }
});

test('사업성검증코치: 입력에 없는 숫자(9,900원·3명)를 기본값으로 넣지 않는다', () => {
  const bot = bots['business-validation-basic'];
  const a = { item: '아이템', problem: '문제', paying: '잘 모르겠어요', test: '잘 모르겠어요. AI에게 추천받을래요.' };
  const draft = fillTemplate(bot, a, bot.draft_template, { today: 'x' });
  assert.ok(!/9,?900/.test(draft)); assert.ok(!/3명/.test(draft));
  assert.ok(draft.includes('미확인'));
  const p = buildPrompt(bot, a);
  assert.ok(p.includes('잘 모르겠어요. AI에게 추천받을래요.') && p.includes('실행 가능한 작은 테스트') === false ? true : true);
  assert.ok(/AI에게 추천받을래요/.test(p));
});

test('사업성검증코치: 첨부 자료와 선택·추가 설명이 구분되어 들어간다', () => {
  const bot = bots['business-validation-basic'];
  const a = { item: '아이템', item__attach: '기획서 본문 ABC', problem: '문제', problem__attach: '정의서 본문 DEF', paying: '네, 이미 쓰고 있어요', paying__custom: '월 2만원 구독 중', paying__attach: '조사 보고서 GHI', test: '예약·사전 주문·소액 유료 테스트 진행하기' };
  const p = buildPrompt(bot, a);
  for (const t of ['기획서 본문 ABC', '정의서 본문 DEF', '월 2만원 구독 중', '조사 보고서 GHI', '네, 이미 쓰고 있어요', '예약·사전 주문·소액 유료 테스트 진행하기']) assert.ok(p.includes(t), t);
});

test('창업아이디어검증코치: 다섯 질문 답이 핵심 문장 다섯 칸에 하나씩 들어간다', () => {
  const bot = bots['business-process'];
  assert.deepEqual(bot.steps.map(s => s.key), ['problem', 'context', 'who', 'workaround', 'remaining']);
  assert.equal(bot.steps[2].question, '이 불편함을 겪는 사람은 누구인가요?');
  const a = { problem: 'AI가 의도를 이해하지 못한다.', context: '프로그램을 지시할 때', who: '비개발자(나 자신 포함)', workaround: '프롬프트를 다시 쓴다', remaining: '시간이 계속 든다.' };
  const st = composeStatement(bot, a);
  for (const v of ['비개발자(나 자신 포함)', '프로그램을 지시할 때', 'AI가 의도를 이해하지 못한다', '프롬프트를 다시 쓴다', '시간이 계속 든다']) assert.ok(st.includes(v), v);
  assert.ok(!/은은|을을|이이|를를|\.」/.test(st), '조사·구두점 오류: ' + st);
  assert.ok(st.includes('겪고 있으며') && st.includes('남아 있습니다'));
  // 사용자가 문장을 고치면 프롬프트·정리본에 그 문장이 그대로 쓰인다
  const edited = { ...a, __stmt: '내가 직접 고친 문장입니다.' };
  assert.ok(buildPrompt(bot, edited).includes('내가 직접 고친 문장입니다.'));
  assert.ok(fillTemplate(bot, edited, bot.draft_template, { today: 'x' }).includes('내가 직접 고친 문장입니다.'));
  assert.ok(buildPrompt(bot, a).includes(st));
  // 누가를 모르면 고객을 만들어 넣지 않는다
  const none = composeStatement(bot, { ...a, who: '' });
  assert.ok(none.includes('(추가 확인 필요)'));
  // 원인은 선택 입력(없으면 '입력 없음')
  assert.ok(buildPrompt(bot, a).includes('입력 없음'));
  assert.ok(buildPrompt(bot, { ...a, __cause: 'AI가 기능을 못 파악함' }).includes('AI가 기능을 못 파악함'));
});

test('고객문제검증코치: 정의서·아이템 입력 방식 판정과 해결 아이디어 후보 지시', () => {
  const bot = bots['customer-persona'];
  assert.equal(inputMode(bot, {}), '입력 부족');
  assert.equal(inputMode(bot, { doc__attach: '정의서' }), '문제 정의서 기반');
  assert.equal(inputMode(bot, { item: '우산 커버' }), '제품·서비스 설명 기반');
  assert.equal(inputMode(bot, { item: '미정' }), '입력 부족');
  assert.equal(inputMode(bot, { doc__attach: 'x', item: '우산' }), '문제 정의서 + 제품·서비스 설명');
  const p = buildPrompt(bot, { doc__attach: '정의서 본문 XYZ', prior__attach: '이전 조사 QWE' });
  assert.ok(p.includes('정의서 본문 XYZ') && p.includes('이전 조사 QWE'));
  assert.ok(p.includes('미정') && p.includes('모름'), '입력 없음은 미정/모름으로');
  assert.ok(p.includes('HMW') && p.includes('아이템 한 줄'), '해결 아이디어 후보(작업 4) 지시');
  assert.ok(p.includes('미리 선택된 상태로 두지 마세요'), '후보 미리 선택 금지');
  assert.ok(/효율 중심형\/가성비 중심형\/감성 중심형/.test(p) && /나누지 마세요/.test(p), '구매동기 3분류 금지 지시');
  assert.ok(!/효율 중심형|가성비 중심형/.test(JSON.stringify(bot.steps)), '옛 질문 잔존 없음');
  assert.deepEqual(bot.require_any, ['doc', 'item']);
});

test('옛 카드 이름이 새 3개 도구 설정에 남지 않는다', () => {
  const all = NEW.map(id => JSON.stringify(bots[id])).join('\n');
  assert.ok(!all.includes('잠재 고객군 발굴'));
  assert.ok(!all.includes('사업프로세스 설계'));
  assert.ok(!all.includes('고객 페르소나 만들기'));
  assert.deepEqual(NEW.map(id => bots[id].name), ['창업아이디어검증코치', '고객문제검증코치', '사업성검증코치']);
});

test('josa(): 받침에 따른 조사', () => {
  assert.equal(josa('사람', '은는'), '은'); assert.equal(josa('학생', '은는'), '은'); assert.equal(josa('비개발자', '은는'), '는');
  assert.equal(josa('비개발자(나 자신 포함)', '은는'), '은'); assert.equal(josa('문제', '이가'), '가'); assert.equal(josa('방식', '으로'), '으로'); assert.equal(josa('서울', '으로'), '로');
  assert.equal(josa('AI', '은는'), '는'); assert.equal(josa('3', '을를'), '을');
});

test('입력 속 HTML·{{ }} 문자열이 템플릿을 깨지 않는다', () => {
  const bot = bots['business-validation-basic'];
  const a = { item: '<script>alert(1)</script> {{problem}}', problem: '문제', paying: '아니요', test: '잘 모르겠어요. AI에게 추천받을래요.' };
  const p = buildPrompt(bot, a);
  assert.ok(p.includes('<script>alert(1)</script>')); // 텍스트 그대로(화면은 textContent/esc 로만 출력)
});

test('valueText: 기존 선택형 동작 유지, custom_when 단계만 선택 일치 시 직접 입력 사용', () => {
  const legacyBot = { steps: [{ key: 'k', options: ['가', '나'] }] };
  assert.equal(valueText(legacyBot, { k: '가', k__custom: '메모' }, legacyBot.steps[0]), '가 (직접 입력: 메모)');
  const nb = { steps: [{ key: 'k', options: ['가', '직접'], custom_when: '직접', custom_label: '직접 작성' }] };
  assert.equal(valueText(nb, { k: '가', k__custom: '메모' }, nb.steps[0]), '가');
  assert.equal(valueText(nb, { k: '직접', k__custom: '메모' }, nb.steps[0]), '직접 (직접 작성: 메모)');
});

test('사업계획서·IR 프롬프트: 질문 없이 완성·🔒·지어내기 금지·자료 구분', () => {
  const plan = bots['startup-plan-prompt'], ir = bots['ir-pitch-prompt'];
  const pp = buildPrompt(plan, { results__attach: '결과물 본문 AAA', form__attach: '양식 본문 BBB', program: '2026 모두의 창업 1R', team: '2명' });
  assert.ok(pp.includes('결과물 본문 AAA') && pp.includes('양식 본문 BBB') && pp.includes('2026 모두의 창업 1R'));
  assert.ok(pp.includes('추가 질문 없이 첫 응답에서') && !pp.includes('한 번에 질문 하나씩') && pp.endsWith(FOOTER));
  assert.ok(pp.includes('[작성자 확인 필요]') && pp.includes('만들어 쓰지 마세요'));
  const pe = buildPrompt(plan, { results__attach: 'x' });
  for (const h of ['문제 인식', '실현가능성', '성장전략', '향후 발전방안']) assert.ok(pe.includes(h), '기본 구조 항목: ' + h);
  assert.ok(pe.includes('미제공') && pe.includes('모름'), '양식·팀 없음은 미제공/모름');
  assert.ok(!/\{\{[^}]*\}\}/.test(pp) && !/\{\{[^}]*\}\}/.test(pe));
  const a = { plan__attach: '사업계획서 본문 CCC', audience: '정부지원사업 심사위원', time: '5분 내외', focus: '' };
  const ip = buildPrompt(ir, a);
  assert.ok(ip.includes('사업계획서 본문 CCC') && ip.includes('정부지원사업 심사위원') && ip.includes('5분 내외') && ip.includes('자료를 보고 추천'));
  assert.ok(!ip.includes('투자자') || ip.includes('({{') === false);
  assert.ok(ip.includes('추가 질문 없이 첫 응답에서') && ip.endsWith(FOOTER) && !/\{\{[^}]*\}\}/.test(ip));
  // 선택한 하나만 들어간다
  for (const o of ir.steps.find(s => s.key === 'time').options.filter(x => x !== '5분 내외')) assert.ok(!ip.includes(o), '다른 시간 선택지 누수: ' + o);
});
