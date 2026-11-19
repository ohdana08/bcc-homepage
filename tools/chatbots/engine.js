// BCC 챗봇 도구 공용 엔진 — 브라우저 안에서만 동작. 서버 전송 없음.
import { generators } from './generators.js?v=20261030';
import { valueText as vt, buildPrompt as buildPromptLib, fillTemplate, composeStatement, isFilled, attachText, buildDefinition, defValue } from './prompt-lib.js?v=20261119b';
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const botId = (params.get('bot') || '').replace(/[^a-z0-9-]/g, '');
const API = window.BCC_API_BASE || 'https://bcc-homepage.vercel.app';
let bot = null; let answers = {}; let idx = 0;
// ---- ui v2 (bot.ui === 'v2') 전용 기능: 설정이 없는 도구는 아래 분기를 전혀 타지 않는다 ----
const V2 = () => !!(bot && bot.ui === 'v2');
let restored = new Set();   // 지난번에 저장돼 있던 답의 키(수정하면 빠진다)
let legacyAnswers = null;   // 질문 형식이 바뀌기 전에 저장된 답(새 칸에 섞지 않는다)
const editing = new Set();  // 정의서에서 지금 고치는 중인 칸
const storeKey = () => 'bcc-chatbot-' + botId;

function esc(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function save(){ try { localStorage.setItem(storeKey(), JSON.stringify(V2() ? { v: 2, answers, idx, t: Date.now() } : { answers, idx, t: Date.now() })); } catch {} }
function load(){ try { const d = JSON.parse(localStorage.getItem(storeKey()) || 'null');
  if (V2()) { // 새 형식(v:2)만 읽는다. 예전 형식(질문 5개 등)은 칸이 어긋나므로 따로 보관만 한다.
    if (d && d.answers && typeof d.answers === 'object') { if (d.v === 2) { answers = sanitizeV2(d.answers); idx = Math.max(0, Math.min(d.idx || 0, bot.steps.length - 1)); } else legacyAnswers = d.answers; }
    return;
  }
  if (d && d.answers) { answers = d.answers; idx = Math.min(d.idx || 0, bot.steps.length - 1); } } catch {} }
function v2Keys(){ const k = new Set(); bot.steps.forEach(s => { if (s.fields) s.fields.forEach(f => k.add(f.key)); else k.add(s.key); if (s.choices) k.add(s.key); if (s.attach) { k.add(s.key + '__attach'); k.add(s.key + '__attach_name'); } if (s.options) k.add(s.key + '__custom'); }); return k; }
function sanitizeV2(a){ // 이 도구가 아는 칸만 남긴다(다른 형식·손상된 값 제거)
  const ok = v2Keys(); const out = {};
  for (const k of Object.keys(a)) { if (ok.has(k) && (typeof a[k] === 'string' || Array.isArray(a[k]))) out[k] = a[k]; }
  bot.steps.forEach(s => { if (s.choices && out[s.key] && !s.choices.some(c => c.label === out[s.key])) delete out[s.key]; });
  if (a.__def && typeof a.__def === 'object' && a.__defbase && typeof a.__defbase === 'object') { out.__def = {}; out.__defbase = {}; for (const k of Object.keys(a.__def)) if (typeof a.__def[k] === 'string' && typeof a.__defbase[k] === 'string' && ok.has(k)) { out.__def[k] = a.__def[k]; out.__defbase[k] = a.__defbase[k]; } }
  return out;
}
function hasSavedV2(){ return Object.keys(answers).some(k => !k.startsWith('__') && !k.endsWith('__attach_name') && String(Array.isArray(answers[k]) ? answers[k].join('') : answers[k] || '').trim()); }
function legacyText(){ const a = legacyAnswers || {}; return Object.keys(a).filter(k => !k.startsWith('__') && typeof a[k] === 'string' && a[k].trim()).map(k => `${k}: ${a[k]}`).join('\n'); }
function track(name, p){ try { if (typeof gtag === 'function') gtag('event', name, p || {}); } catch {} }
function download(text, filename){ const b = new Blob([text], { type: 'text/markdown;charset=utf-8' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
async function copy(text, btn){ try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = '복사됐어요 ✓'; setTimeout(() => btn.textContent = o, 1800); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); btn.textContent = '복사됐어요 ✓'; } }
function show(id){ ['intro-card','q-card','review-card','result-card','result2-card','lock-card'].forEach(k => $(k).hidden = (k !== id)); }

function renderHead(){
  document.title = `${bot.name} | BCC 잇툴즈`;
  $('bot-eyebrow').textContent = `잇툴즈 · ${bot.group_label || '챗봇 도구'}`;
  $('bot-title').textContent = bot.name;
  $('bot-tagline').textContent = bot.tagline || '';
  $('bot-meta').innerHTML = [`질문 ${bot.steps.length}개`, bot.audience, bot.time].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('');
  if (bot.notice) { $('bot-notice').textContent = bot.notice; $('bot-notice').hidden = false; }
  $('nav-group').href = `../../tools.html#${bot.group || 'startup'}`;
  const defHow = usesGen() ? ['질문에 하나씩 답합니다.','입력한 내용으로 만든 결과물 초안을 바로 받습니다.','더 다듬고 싶으면 완성 프롬프트를 내 AI에 붙여넣습니다.'] : ['시작 질문 몇 개에 답합니다.','완성 프롬프트를 복사해 ChatGPT·Claude·Gemini에 붙여넣습니다.','AI가 원래 챗봇처럼 질문을 이어가며 결과물을 완성해 줍니다.'];
  $('how-list').innerHTML = (bot.how || defHow).map(t => `<li>${esc(t)}</li>`).join('');
}
const usesGen = () => !bot.draft_template && !!generators[bot.id];
function step(){ return bot.steps[idx]; }
function currentValue(){ const s = step(); const v = answers[s.key]; return Array.isArray(v) ? v : (v || ''); }
function renderQuestion(){
  const s = step();
  $('progress-text').textContent = `${idx + 1} / ${bot.steps.length}`;
  $('bar').style.width = `${Math.round(((idx + (V2() ? 1 : 0)) / bot.steps.length) * 100)}%`;
  $('q-text').textContent = s.question;
  $('q-help').textContent = s.help || '';
  $('q-err').textContent = '';
  // 첫 질문 답 고정 표시(bot.pin) — 한 문제만 끝까지 다루게 한다
  const pinStep = bot.pin ? bot.steps.find(x => x.key === bot.pin) : null;
  const pinBox = $('q-pin');
  if (pinStep && idx > 0 && String(answers[pinStep.key] || '').trim()) { pinBox.hidden = false; pinBox.innerHTML = `<b>내가 선택한 문제</b><span>${esc(answers[pinStep.key])}</span><em>처음 선택한 문제와 관련된 내용만 적어 주세요.</em>`; } else { pinBox.hidden = true; pinBox.textContent = ''; }
  if (V2()) renderRecap(pinBox);
  const linkBox = $('q-links'); linkBox.innerHTML = '';
  (s.links || []).forEach(l => { const a = document.createElement('a'); a.className = 'btn ghost'; a.href = l.href; a.textContent = l.label; linkBox.append(a); });
  linkBox.hidden = !(s.links && s.links.length);
  const attBox = $('q-attach');
  if (s.attach) {
    attBox.hidden = false; $('q-attach-label').textContent = s.attach.label || '자료 파일 첨부 (.md · .txt) 또는 붙여넣기';
    $('q-attach-help').textContent = s.attach.help || '파일 내용은 이 브라우저에서만 읽습니다. 아래에 보이는 내용을 직접 고칠 수 있어요.';
    $('q-attach-text').value = answers[s.key + '__attach'] || ''; $('q-attach-file').value = ''; $('q-attach-status').textContent = answers[s.key + '__attach_name'] ? `불러온 파일: ${answers[s.key + '__attach_name']}` : '';
  } else { attBox.hidden = true; }
  attBox.classList.toggle('attach-v2', V2() && !!s.attach); $('q-attach-btn').hidden = !(V2() && s.attach); if (V2() && s.attach) checkAttach(s); else $('q-attach-check').hidden = true;
  renderStepFields(s);
  const chips = $('q-chips'); chips.innerHTML = '';
  const multi = s.type === 'multi';
  if (s.options && s.options.length) {
    s.options.forEach(opt => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = opt;
      const cur = currentValue(); const on = multi ? cur.includes(opt) : cur === opt;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (multi) { const arr = Array.isArray(answers[s.key]) ? [...answers[s.key]] : []; const i = arr.indexOf(opt); if (i >= 0) arr.splice(i, 1); else { if (s.max && arr.length >= s.max) { $('q-err').textContent = `${s.max}개까지만 고를 수 있어요. 하나를 해제하고 다시 골라주세요.`; return; } arr.push(opt); } answers[s.key] = arr; }
        else { answers[s.key] = opt; }
        save(); renderQuestion();
      });
      chips.append(b);
    });
  }
  const ta = $('q-input');
  const showText = !s.attach_only && !s.fields && !s.choices && (!s.options || (s.custom_when !== undefined ? answers[s.key] === s.custom_when : s.allow_text !== false));
  ta.hidden = !showText;
  ta.placeholder = s.placeholder || (s.options ? (s.custom_placeholder || '위에서 고르거나, 직접 적어주세요.') : '편하게 적어주세요.');
  if (s.options) { ta.value = (s.custom && answers[s.key + '__custom']) || ''; ta.rows = 2; }
  else { ta.value = typeof answers[s.key] === 'string' ? answers[s.key] : ''; ta.rows = 4; }
  $('prev-btn').disabled = idx === 0;
  $('next-btn').textContent = idx === bot.steps.length - 1 ? '확인하기 →' : '다음 →';
  const rn = $('q-restored'); rn.hidden = !(V2() && showText && restored.has(s.key) && String(answers[s.key] || '').trim());
  if (showText && !s.options) setTimeout(() => ta.focus(), 50);
  $('q-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function commit(){
  const s = step(); const ta = $('q-input');
  if (s.fields || s.choices) return commitFields(s);
  if (s.attach) { answers[s.key + '__attach'] = $('q-attach-text').value.trim(); if (!answers[s.key + '__attach']) delete answers[s.key + '__attach_name']; }
  if (s.options) {
    const t = ta.value.trim();
    if (s.choice_required) { // 단일 선택을 반드시 고르게 하고, 입력칸 글을 답으로 대신 쓰지 않는다
      const chosen = currentValue();
      if (!s.options.includes(chosen)) { $('q-err').textContent = '위 선택지 중 하나를 골라 주세요.'; return false; }
      if (s.custom_when !== undefined && chosen === s.custom_when && !t) { $('q-err').textContent = '직접 작성을 고르셨어요. 내용을 적어 주세요.'; return false; }
      if (s.custom_when !== undefined && chosen !== s.custom_when) delete answers[s.key + '__custom']; else if (t) answers[s.key + '__custom'] = t; else delete answers[s.key + '__custom'];
      save(); return true;
    }
    if (t) { answers[s.key + '__custom'] = t; if (!currentValue() || (Array.isArray(currentValue()) && !currentValue().length)) answers[s.key] = t; }
  }
  else if (!s.attach_only) { answers[s.key] = ta.value.trim(); }
  const v = answers[s.key]; const empty = (!v || (Array.isArray(v) && !v.length)) && !(s.attach && attachText(answers, s));
  if (s.required !== false && empty) { $('q-err').textContent = s.required_msg || '이 질문은 답이 있어야 다음으로 갈 수 있어요. 모르면 "모르겠어요"라고 적어도 돼요.'; return false; }
  save(); return true;
}

// ===== ui v2 helpers =====
function renderRecap(box){ // 앞에서 쓴 답을 모두 보여준다
  const rows = [];
  for (let j = 0; j < idx; j++) {
    const st = bot.steps[j];
    if (st.choices) { const v = String(answers[st.key] || '').trim(); if (v) rows.push([st.recap || '출발점', v]); }
    if (st.fields) st.fields.forEach(f => { const v = String(answers[f.key] || '').trim(); if (v) rows.push([f.recap || f.label, v]); });
    else if (!st.choices) { const v = String(answers[st.key] || '').trim(); if (v) rows.push([st.recap || st.label || st.question, v]); }
  }
  const note = step().recap_note;
  if (!rows.length) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false; box.className = 'pin recap';
  box.innerHTML = `<b>앞에서 쓴 답</b><ul>${rows.map(([k, v]) => `<li><b>${esc(k)}</b>${esc(v)}</li>`).join('')}</ul>${note ? `<em>${esc(note)}</em>` : ''}`;
}
function renderStepFields(s){
  const sw = $('q-start'), fb = $('q-fields');
  sw.hidden = true; sw.innerHTML = ''; fb.hidden = true; fb.innerHTML = '';
  if (!V2() || !(s.choices || s.fields)) return;
  let chosen = null;
  if (s.choices) {
    chosen = s.choices.find(c => c.label === answers[s.key]) || null;
    sw.hidden = false;
    sw.innerHTML = `<div class="start-btns" role="group" aria-label="${esc(s.question)}">${s.choices.map(c => `<button type="button" aria-pressed="${c.label === answers[s.key] ? 'true' : 'false'}">${esc(c.label)}</button>`).join('')}</div>` +
      `<p class="start-hint" ${chosen ? 'hidden' : ''}>위에서 하나를 고르면 질문이 나타납니다.</p><span class="restored-note" ${restored.has(s.key) && chosen ? '' : 'hidden'}>지난번에 쓴 답입니다</span>`;
    [...sw.querySelectorAll('.start-btns button')].forEach((b, i) => b.addEventListener('click', () => { answers[s.key] = s.choices[i].label; restored.delete(s.key); save(); renderStepFields(s); const f0 = $('q-fields').querySelector('textarea'); if (f0) f0.focus(); }));
  }
  if (s.fields && (!s.choices || chosen)) {
    fb.hidden = false;
    s.fields.forEach((f, i) => {
      const label = (i === 0 && chosen) ? chosen.question : f.label; const ph = (i === 0 && chosen && chosen.placeholder) || f.placeholder || '';
      const wrap = document.createElement('div'); wrap.className = 'fld';
      const id = 'fld-' + f.key;
      wrap.innerHTML = `${label !== s.question ? `<label for="${id}">${esc(label)}</label>` : `<label class="sr" for="${id}" style="position:absolute;left:-9999px">${esc(label)}</label>`}${f.help ? `<p class="help">${esc(f.help)}</p>` : ''}<textarea id="${id}" rows="3" maxlength="2000" placeholder="${esc(ph)}"></textarea><span class="restored-note" hidden>지난번에 쓴 답입니다</span>`;
      const ta = wrap.querySelector('textarea'); const rn = wrap.querySelector('.restored-note');
      ta.value = String(answers[f.key] || ''); rn.hidden = !(restored.has(f.key) && ta.value.trim());
      ta.addEventListener('input', () => { answers[f.key] = ta.value; restored.delete(f.key); rn.hidden = true; save(); });
      fb.append(wrap);
    });
  }
}
function commitFields(s){
  const err = $('q-err');
  if (s.choices && !s.choices.some(c => c.label === answers[s.key])) { err.textContent = s.choice_required_msg || '위 버튼 중 하나를 골라 주세요.'; return false; }
  for (const f of (s.fields || [])) { answers[f.key] = String(answers[f.key] || '').trim(); }
  for (const f of (s.fields || [])) { if (f.required !== false && !answers[f.key]) { err.textContent = `「${f.recap || f.label}」 칸에 답을 적어 주세요. 모르면 "모르겠음"이라고 적어도 돼요.`; return false; } }
  save(); return true;
}
function checkAttach(s){ // 붙여넣은 내용 확인(.attach.detect: 정해진 형식이 보이는지, .attach.warn_len: 너무 긴 글)
  const box = $('q-attach-check'); const t = $('q-attach-text').value.trim(); const a = s.attach || {};
  if (!t) { box.hidden = true; return; }
  let msg = '', cls = 'ok';
  if (a.warn_len && t.length > a.warn_len.limit) { msg = a.warn_len.msg; cls = 'warn'; }
  else if (a.detect) { let hit = false; try { hit = new RegExp(a.detect.pattern).test(t); } catch {} msg = hit ? a.detect.ok : a.detect.miss; cls = hit ? 'ok' : 'warn'; }
  if (!msg) { box.hidden = true; return; }
  box.hidden = false; box.className = 'attach-check ' + cls; box.textContent = msg;
}
const dateStr = () => new Date().toLocaleDateString('sv-SE');
function syncDef(){ // 정의서 칸을 고친 뒤 원래 답이 바뀌었으면 옛 수정은 버린다
  const d = answers.__def, b = answers.__defbase; if (!d || !b) { delete answers.__def; delete answers.__defbase; return; }
  for (const k of Object.keys(d)) if (String(answers[k] || '').trim() !== b[k]) { delete d[k]; delete b[k]; }
  if (!Object.keys(d).length) { delete answers.__def; delete answers.__defbase; }
}
function setDef(key, value){ answers.__def = answers.__def || {}; answers.__defbase = answers.__defbase || {}; if (!(key in answers.__defbase)) answers.__defbase[key] = String(answers[key] || '').trim(); answers.__def[key] = value; save(); }
function resetDef(key){ if (answers.__def) delete answers.__def[key]; if (answers.__defbase) delete answers.__defbase[key]; syncDef(); save(); }
function isEdited(key){ return !!(answers.__def && typeof answers.__def[key] === 'string' && answers.__def[key].trim() !== String(answers[key] || '').trim()); }
function drawCell(f, cell){
  const ed = editing.has(f.key); const val = defValue(bot, answers, f.key);
  cell.innerHTML = `<div class="def-h"><span><b>${esc(f.heading)}</b>${isEdited(f.key) ? '<span class="def-edited">고친 내용</span>' : ''}</span><span>${isEdited(f.key) ? '<button type="button" class="btn text" data-act="reset">원래 답으로</button>' : ''}<button type="button" class="btn text" data-act="edit">${ed ? '완료' : '고치기'}</button></span></div>` +
    (ed ? `<textarea rows="3" maxlength="2000" aria-label="${esc(f.heading)}"></textarea>` : `<p class="def-v">${esc(val || '(비어 있음)')}</p>`);
  if (ed) { const ta = cell.querySelector('textarea'); ta.value = val; ta.addEventListener('input', () => { setDef(f.key, ta.value); refreshOut2(); }); setTimeout(() => ta.focus(), 30); }
  cell.querySelector('[data-act=edit]').onclick = () => { if (ed) editing.delete(f.key); else editing.add(f.key); drawCell(f, cell); };
  const rs = cell.querySelector('[data-act=reset]'); if (rs) rs.onclick = () => { resetDef(f.key); editing.delete(f.key); drawCell(f, cell); refreshOut2(); };
}
function refreshOut2(){
  const d = buildDefinition(bot, answers, { date: dateStr() }), p = buildPromptLib(bot, answers, { today: todayStr() });
  $('r2-prompt-out').textContent = p;
  $('r2-copy-def').onclick = (e) => copy(d, e.currentTarget); $('r2-dl-def').onclick = () => download(d, bot.definition.filename || '정의서.md');
  $('r2-copy-prompt').onclick = (e) => copy(p, e.currentTarget); $('r2-dl-prompt').onclick = () => download(p, `${bot.name}_프롬프트.md`);
}
function renderResult2(){
  syncDef(); editing.clear(); save();
  const rc = bot.result_v2 || {}; const df = bot.definition;
  $('r2-h-def').textContent = rc.h_def || df.title; $('r2-lead').textContent = rc.lead || '';
  $('r2-origin').textContent = df.origin ? `${df.origin.label}: ${answers[df.origin.key] || '미선택'}` : '';
  const grid = $('r2-def'); grid.innerHTML = '';
  df.fields.forEach(f => { const cell = document.createElement('div'); cell.className = 'def-cell'; grid.append(cell); drawCell(f, cell); });
  $('r2-next-h').textContent = rc.next_h || '다음 단계'; $('r2-next-text').textContent = rc.next_text || '';
  const nb = $('r2-next-btn'); nb.textContent = rc.next_btn || '다음 도구로 가기'; nb.href = rc.next_href || '../../tools.html'; $('r2-next-hint').textContent = rc.next_hint || '';
  $('r2-ai-summary').textContent = rc.ai_summary || '내 AI로 먼저 살펴보기 (선택)'; $('r2-ai-text').textContent = rc.ai_text || '';
  $('r2-ai-note').hidden = !rc.ai_note; $('r2-ai-note').textContent = rc.ai_note || '';
  $('r2-ai').open = false; refreshOut2();
  show('result2-card'); window.scrollTo({ top: $('result2-card').offsetTop - 80, behavior: 'smooth' });
  track('chatbot_result', { bot: bot.id, mode: 'definition' });
}
function startFresh(){ answers = {}; idx = 0; restored = new Set(); legacyAnswers = null; try { localStorage.removeItem(storeKey()); } catch {} save(); }
function setupResume(){ // 시작 화면: 저장된 답이 있으면 이어서/새로 시작을 묻는다
  const box = $('resume-box'); const legacy = legacyAnswers && legacyText();
  if (legacy) {
    $('resume-title').textContent = '이전 버전에서 쓰던 답이 있습니다.';
    $('resume-desc').textContent = '질문이 바뀌어서 이전 답을 그대로 이어갈 수는 없어요. 필요하면 아래에서 확인해 복사해 두고, 새로 시작해 주세요.';
    $('legacy-old').hidden = false; $('legacy-old-text').textContent = legacy; $('resume-continue').hidden = true;
  } else if (hasSavedV2()) {
    $('resume-title').textContent = '지난번에 쓰던 내용이 있습니다.';
    $('resume-desc').textContent = '이어서 하거나, 지우고 새로 시작할 수 있어요. 새로 시작하면 이 도구에 저장된 답이 모두 지워집니다.';
    $('legacy-old').hidden = true; $('resume-continue').hidden = false;
  } else { box.hidden = true; $('start-row').hidden = false; return; }
  box.hidden = false; $('start-row').hidden = true;
  $('resume-continue').onclick = () => { restored = new Set(Object.keys(answers).filter(k => !k.startsWith('__') && String(answers[k] || '').trim())); show('q-card'); renderQuestion(); track('chatbot_resume', { bot: bot.id }); };
  $('resume-new').onclick = () => { startFresh(); box.hidden = true; show('q-card'); renderQuestion(); track('chatbot_start', { bot: bot.id, fresh: 1 }); };
}
function valueText(s){ return vt(bot, answers, s); }
function reviewText(s){ const a = attachText(answers, s); const base = valueText(s); if (!a) return base; const name = answers[s.key + '__attach_name']; const note = `[첨부 자료${name ? ' · ' + name : ''} · ${a.length.toLocaleString('ko-KR')}자]`; return base === '(비움)' ? note : `${base}\n${note}`; }
function renderReview(){
  if (bot.require_any) { const miss = bot.require_any.every(k => { const s = bot.steps.find(x => x.key === k); return s && !isFilled(answers, s); }); if (miss) { idx = bot.steps.findIndex(x => x.key === bot.require_any[0]); show('q-card'); renderQuestion(); $('q-err').textContent = bot.require_any_msg || '필요한 자료를 하나 이상 넣어 주세요.'; return; } }
  $('review-list').innerHTML = bot.steps.map(s => `<div><dt>${esc(s.label || s.question)}</dt><dd style="white-space:pre-wrap">${esc(reviewText(s))}</dd></div>`).join(''); show('review-card'); window.scrollTo({ top: $('review-card').offsetTop - 80, behavior: 'smooth' }); }
function fill(tpl){ return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => { const s = bot.steps.find(x => x.key === k); return s ? valueText(s) : (answers[k] || ''); }); }
const todayStr = () => new Date().toLocaleDateString('ko-KR');
function buildDraft(){
  const head = `# ${bot.name} — 정리본\n작성일: ${new Date().toLocaleDateString('ko-KR')}\n\n`;
  const gen = usesGen() ? generators[bot.id] : null;
  const a = {}; bot.steps.forEach(s => { a[s.key] = valueText(s) === '(비움)' ? '' : valueText(s); a[s.key + '_raw'] = answers[s.key]; });
  const body = gen ? gen(a) : (bot.draft_template ? fillTemplate(bot, answers, bot.draft_template, { today: todayStr() }) : bot.steps.map(s => `## ${s.label || s.question}\n${valueText(s)}\n`).join('\n'));
  return head + body + `\n\n---\n이 정리본은 비즈니스커리어컨설팅 잇툴즈 「${bot.name}」에서 만들었습니다. https://bccconsulting.kr/tools/chatbots/?bot=${bot.id}`;
}
function buildPrompt(){ return buildPromptLib(bot, answers, { today: todayStr() }); }
function mdToHtml(md){
  const lines = md.split('\n'); let out = ''; let inTable = false; let inList = false;
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\|/.test(l)) { const cells = l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()); if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; if (!inTable) { out += '<table>'; inTable = true; } const isHead = i + 1 < lines.length && /^\|\s*-/.test(lines[i + 1]); out += '<tr>' + cells.map(c => isHead ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('') + '</tr>'; continue; }
    if (inTable) { out += '</table>'; inTable = false; }
    if (/^\s*[-•]\s+/.test(l)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(l.replace(/^\s*[-•]\s+/, ''))}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (/^#{1,3}\s/.test(l)) { const n = l.match(/^(#+)/)[1].length; out += `<h${n + 2}>${inline(l.replace(/^#+\s/, ''))}</h${n + 2}>`; continue; }
    if (/^---+$/.test(l.trim())) { out += '<hr>'; continue; }
    if (!l.trim()) { out += '<br>'; continue; }
    out += `<p>${inline(l)}</p>`;
  }
  if (inTable) out += '</table>'; if (inList) out += '</ul>';
  return out;
}
function renderStmt(){
  const box = $('stmt-box');
  if (!bot.statement_template) { box.hidden = true; return; }
  box.hidden = false;
  const auto = composeStatement(bot, answers);
  $('stmt-edit').value = (answers.__stmt && answers.__stmt.trim()) ? answers.__stmt : auto;
  $('cause-edit').value = answers.__cause || '';
  $('stmt-edit').oninput = () => { answers.__stmt = $('stmt-edit').value; save(); refreshOut(); };
  $('cause-edit').oninput = () => { answers.__cause = $('cause-edit').value; save(); refreshOut(); };
  $('stmt-reset').onclick = () => { delete answers.__stmt; save(); $('stmt-edit').value = composeStatement(bot, answers); refreshOut(); };
}
function refreshOut(){
  const d = buildDraft(), p = buildPrompt();
  $('draft-out').innerHTML = mdToHtml(d); $('prompt-out').textContent = p;
  $('copy-draft').onclick = (e) => copy(d, e.currentTarget); $('copy-prompt').onclick = (e) => copy(p, e.currentTarget);
  $('dl-draft').onclick = () => download(d, `${bot.name}_정리본.md`); $('dl-prompt').onclick = () => download(p, `${bot.name}_프롬프트.md`);
}
function renderResult(){
  renderStmt();
  const d = buildDraft(), p = buildPrompt();
  $('draft-out').innerHTML = mdToHtml(d); $('prompt-out').textContent = p;
  $('copy-draft').onclick = (e) => copy(d, e.currentTarget); $('copy-prompt').onclick = (e) => copy(p, e.currentTarget);
  $('dl-draft').onclick = () => download(d, `${bot.name}_정리본.md`); $('dl-prompt').onclick = () => download(p, `${bot.name}_프롬프트.md`);
  const handoff = !usesGen() && !bot.draft_template;
  $('result-card').classList.toggle('is-handoff', handoff);
  $('h-draft').textContent = handoff ? '2. 내가 적은 입력 정리' : '1. 정리된 초안';
  $('h-prompt').textContent = handoff ? '1. 이 프롬프트를 내 AI에 붙여넣으면 대화가 시작됩니다' : '2. 내 AI에 붙여넣는 완성 프롬프트';
  $('p-draft').textContent = handoff ? '위 프롬프트에 이미 들어가 있는 내용입니다. 따로 보관하고 싶을 때 복사하세요.' : '입력한 내용을 이 도구의 순서대로 정리했습니다. 그대로 복사해 쓰거나, 아래 2번으로 AI에게 완성시키세요.';
  const rc = bot.result_copy || {};
  $('p-prompt').textContent = handoff ? '아래 전체를 복사해서 ChatGPT·Claude·Gemini 새 대화에 붙여넣으세요. 원래 챗봇처럼 질문을 주고받으며 끝까지 완성해 줍니다. 무료 계정도 됩니다.' : '아래 전체를 복사해서 ChatGPT·Claude·Gemini 새 대화에 붙여넣으면, 이 챗봇이 하던 대화를 그대로 이어서 합니다. 무료 계정도 됩니다.';
  if (rc.h_draft) $('h-draft').textContent = rc.h_draft; if (rc.p_draft) $('p-draft').textContent = rc.p_draft; if (rc.h_prompt) $('h-prompt').textContent = rc.h_prompt; if (rc.p_prompt) $('p-prompt').textContent = rc.p_prompt;
  $('ai-note').hidden = !rc.ai_note; $('ai-note').textContent = rc.ai_note || '';
  // 1번(초안)을 먼저 보여 주고, 완성 프롬프트(2번)는 1번을 마친 뒤 버튼으로 연다. 프롬프트가 먼저인 도구(handoff)는 바로 보인다.
  $('res-prompt').hidden = !handoff; $('to-prompt-row').hidden = handoff;
  $('to-prompt-btn').onclick = () => { $('res-prompt').hidden = false; $('to-prompt-row').hidden = true; $('res-prompt').scrollIntoView({ behavior: 'smooth', block: 'start' }); track('chatbot_next_step', { bot: bot.id }); };
  show('result-card'); window.scrollTo({ top: $('result-card').offsetTop - 80, behavior: 'smooth' }); track('chatbot_result', { bot: bot.id, mode: handoff ? 'handoff' : 'draft' });
}
async function isAdmin(){
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const c = await fetch(API + '/api/config').then(r => r.json()); if (!c.supabaseUrl) return false;
    const sb = createClient(c.supabaseUrl, c.supabaseAnonKey);
    const { data: { session } } = await sb.auth.getSession(); if (!session) return false;
    const r = await fetch(API + '/api/my-enrollments', { headers: { Authorization: 'Bearer ' + session.access_token } }); if (!r.ok) return false;
    const d = await r.json(); return !!(d.profile && d.profile.is_admin);
  } catch { return false; }
}
async function init(){
  if (!botId) { $('bot-title').textContent = '어떤 도구를 열지 알 수 없어요'; $('bot-tagline').innerHTML = '<a href="../../tools.html">잇툴즈 목록</a>에서 도구를 골라주세요.'; $('intro-card').hidden = true; return; }
  try { bot = await fetch(`./bots/${botId}.json?v=20261118`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  catch { $('bot-title').textContent = '이 도구를 찾을 수 없어요'; $('bot-tagline').innerHTML = '<a href="../../tools.html">잇툴즈 목록</a>에서 다시 골라주세요.'; $('intro-card').hidden = true; return; }
  renderHead();
  if (bot.admin_only) { const ok = await isAdmin(); if (!ok) { show('lock-card'); return; } }
  load();
  $('start-btn').onclick = () => { show('q-card'); renderQuestion(); track('chatbot_start', { bot: bot.id }); };
  $('next-btn').onclick = () => { if (!commit()) return; if (idx < bot.steps.length - 1) { idx++; save(); renderQuestion(); } else if (V2()) renderResult2(); else renderReview(); };
  $('prev-btn').onclick = () => { commit(); if (idx > 0) { idx--; save(); renderQuestion(); } };
  $('reset-btn').onclick = () => { if (!confirm('지금까지 적은 답을 지우고 처음부터 할까요?')) return; if (V2()) { startFresh(); } else { answers = {}; idx = 0; save(); } renderQuestion(); };
  $('edit-btn').onclick = () => { idx = 0; show('q-card'); renderQuestion(); };
  $('make-btn').onclick = renderResult;
  $('q-attach-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; const st = $('q-attach-status'); if (!f) return;
    if (!/\.(md|txt)$/i.test(f.name) && !/^text\//.test(f.type)) { st.textContent = '지원하는 파일은 .md · .txt 입니다. 아래 칸에 내용을 붙여넣어도 됩니다.'; e.target.value = ''; return; }
    if (f.size > 300 * 1024) { st.textContent = '파일이 너무 커요(300KB 이하). 필요한 부분만 아래 칸에 붙여넣어 주세요.'; e.target.value = ''; return; }
    if ($('q-attach-text').value.trim() && !confirm('이미 들어 있는 자료가 있어요. 새 파일 내용으로 바꿀까요?')) { e.target.value = ''; return; }
    try { const text = await f.text(); $('q-attach-text').value = text.replace(/\u0000/g, '').slice(0, 20000); answers[step().key + '__attach_name'] = f.name; st.textContent = `불러온 파일: ${f.name} (${f.size.toLocaleString('ko-KR')}바이트). 아래 내용을 확인하고 필요하면 고쳐 주세요.${text.length > 20000 ? ' 앞 20,000자만 사용합니다.' : ''}`; save(); if (V2()) checkAttach(step()); }
    catch { st.textContent = '파일을 읽지 못했어요. 아래 칸에 내용을 붙여넣어 주세요.'; }
  });
  $('again-btn').onclick = () => { show('q-card'); renderQuestion(); };
  $('r2-again').onclick = () => { idx = 0; save(); show('q-card'); renderQuestion(); };
  $('q-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('next-btn').click(); });
  if (V2()) {
    $('q-input').addEventListener('input', () => { restored.delete(step().key); $('q-restored').hidden = true; });
    $('q-attach-text').addEventListener('input', () => checkAttach(step()));
    const ab = $('q-attach');
    ab.addEventListener('dragover', (e) => { if (!V2() || !step().attach) return; e.preventDefault(); ab.classList.add('is-drag'); });
    ab.addEventListener('dragleave', () => ab.classList.remove('is-drag'));
    ab.addEventListener('drop', (e) => { ab.classList.remove('is-drag'); if (!step().attach) return; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); try { $('q-attach-file').files = e.dataTransfer.files; } catch {} $('q-attach-file').dispatchEvent(new Event('change')); });
    setupResume(); return;
  }
  if (Object.keys(answers).length) { show('q-card'); renderQuestion(); }
}
init();
