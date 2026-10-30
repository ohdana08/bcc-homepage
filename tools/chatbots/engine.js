// BCC 챗봇 도구 공용 엔진 — 브라우저 안에서만 동작. 서버 전송 없음.
import { generators } from './generators.js?v=20261030';
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const botId = (params.get('bot') || '').replace(/[^a-z0-9-]/g, '');
const API = window.BCC_API_BASE || 'https://bcc-homepage.vercel.app';
let bot = null; let answers = {}; let idx = 0;
const storeKey = () => 'bcc-chatbot-' + botId;

function esc(s){ return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function save(){ try { localStorage.setItem(storeKey(), JSON.stringify({ answers, idx, t: Date.now() })); } catch {} }
function load(){ try { const d = JSON.parse(localStorage.getItem(storeKey()) || 'null'); if (d && d.answers) { answers = d.answers; idx = Math.min(d.idx || 0, bot.steps.length - 1); } } catch {} }
function track(name, p){ try { if (typeof gtag === 'function') gtag('event', name, p || {}); } catch {} }
function download(text, filename){ const b = new Blob([text], { type: 'text/markdown;charset=utf-8' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
async function copy(text, btn){ try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = '복사됐어요 ✓'; setTimeout(() => btn.textContent = o, 1800); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); btn.textContent = '복사됐어요 ✓'; } }
function show(id){ ['intro-card','q-card','review-card','result-card','lock-card'].forEach(k => $(k).hidden = (k !== id)); }

function renderHead(){
  document.title = `${bot.name} | BCC 잇툴즈`;
  $('bot-eyebrow').textContent = `잇툴즈 · ${bot.group_label || '챗봇 도구'}`;
  $('bot-title').textContent = bot.name;
  $('bot-tagline').textContent = bot.tagline || '';
  $('bot-meta').innerHTML = [`질문 ${bot.steps.length}개`, bot.audience, bot.time].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('');
  if (bot.notice) { $('bot-notice').textContent = bot.notice; $('bot-notice').hidden = false; }
  $('nav-group').href = `../../tools.html#${bot.group || 'startup'}`;
  const defHow = generators[bot.id] ? ['질문에 하나씩 답합니다.','입력한 내용으로 만든 결과물 초안을 바로 받습니다.','더 다듬고 싶으면 완성 프롬프트를 내 AI에 붙여넣습니다.'] : ['시작 질문 몇 개에 답합니다.','완성 프롬프트를 복사해 ChatGPT·Claude·Gemini에 붙여넣습니다.','AI가 원래 챗봇처럼 질문을 이어가며 결과물을 완성해 줍니다.'];
  $('how-list').innerHTML = (bot.how || defHow).map(t => `<li>${esc(t)}</li>`).join('');
}
function step(){ return bot.steps[idx]; }
function currentValue(){ const s = step(); const v = answers[s.key]; return Array.isArray(v) ? v : (v || ''); }
function renderQuestion(){
  const s = step();
  $('progress-text').textContent = `${idx + 1} / ${bot.steps.length}`;
  $('bar').style.width = `${Math.round(((idx) / bot.steps.length) * 100)}%`;
  $('q-text').textContent = s.question;
  $('q-help').textContent = s.help || '';
  $('q-err').textContent = '';
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
  const showText = !s.options || s.allow_text !== false;
  ta.hidden = !showText;
  ta.placeholder = s.placeholder || (s.options ? '위에서 고르거나, 직접 적어주세요.' : '편하게 적어주세요.');
  if (s.options) { ta.value = (s.custom && answers[s.key + '__custom']) || ''; ta.rows = 2; }
  else { ta.value = typeof answers[s.key] === 'string' ? answers[s.key] : ''; ta.rows = 4; }
  $('prev-btn').disabled = idx === 0;
  $('next-btn').textContent = idx === bot.steps.length - 1 ? '확인하기 →' : '다음 →';
  if (showText && !s.options) setTimeout(() => ta.focus(), 50);
  $('q-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function commit(){
  const s = step(); const ta = $('q-input');
  if (s.options) { const t = ta.value.trim(); if (t) { answers[s.key + '__custom'] = t; if (!currentValue() || (Array.isArray(currentValue()) && !currentValue().length)) answers[s.key] = t; } }
  else { answers[s.key] = ta.value.trim(); }
  const v = answers[s.key]; const empty = !v || (Array.isArray(v) && !v.length);
  if (s.required !== false && empty) { $('q-err').textContent = s.required_msg || '이 질문은 답이 있어야 다음으로 갈 수 있어요. 모르면 "모르겠어요"라고 적어도 돼요.'; return false; }
  save(); return true;
}
function valueText(s){ const v = answers[s.key]; const c = answers[s.key + '__custom']; let t = Array.isArray(v) ? v.join(', ') : (v || ''); if (s.options && c && c !== t && !t.includes(c)) t = t ? `${t} (직접 입력: ${c})` : c; return t || '(비움)'; }
function renderReview(){ $('review-list').innerHTML = bot.steps.map(s => `<div><dt>${esc(s.label || s.question)}</dt><dd>${esc(valueText(s))}</dd></div>`).join(''); show('review-card'); window.scrollTo({ top: $('review-card').offsetTop - 80, behavior: 'smooth' }); }
function fill(tpl){ return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => { const s = bot.steps.find(x => x.key === k); return s ? valueText(s) : (answers[k] || ''); }); }
function buildDraft(){
  const head = `# ${bot.name} — 정리본\n작성일: ${new Date().toLocaleDateString('ko-KR')}\n\n`;
  const gen = generators[bot.id];
  const a = {}; bot.steps.forEach(s => { a[s.key] = valueText(s) === '(비움)' ? '' : valueText(s); a[s.key + '_raw'] = answers[s.key]; });
  const body = gen ? gen(a) : (bot.draft_template ? fill(bot.draft_template) : bot.steps.map(s => `## ${s.label || s.question}\n${valueText(s)}\n`).join('\n'));
  return head + body + `\n\n---\n이 정리본은 비즈니스커리어컨설팅 잇툴즈 「${bot.name}」에서 만들었습니다. https://bccconsulting.kr/tools/chatbots/?bot=${bot.id}`;
}
function buildPrompt(){
  const inputs = bot.steps.map(s => `- ${s.label || s.question}: ${valueText(s)}`).join('\n');
  return `${bot.prompt_header}\n\n---\n[사용자가 미리 적어둔 입력]\n${inputs}\n\n[진행 방법]\n위 입력을 이미 받은 것으로 보고, 지침의 다음 단계부터 바로 시작하세요. 한 번에 질문 하나씩, 사용자가 답하면 다음으로 넘어가세요. 입력에 없는 내용은 지어내지 말고 물어보세요.\n\n[출력 규칙]\n모든 응답의 맨 마지막에 아래 문구를 그대로 붙이세요.\n---\n🔒 본 챗봇은 **비즈니스커리어컨설팅**(대표: 오예림)이 제작한 콘텐츠입니다. 무단 복제·재배포·상업적 활용을 금지합니다. 문의: https://pf.kakao.com/_xbrxjxkxj/chat`;
}
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
function renderResult(){
  const d = buildDraft(), p = buildPrompt();
  $('draft-out').innerHTML = mdToHtml(d); $('prompt-out').textContent = p;
  $('copy-draft').onclick = (e) => copy(d, e.currentTarget); $('copy-prompt').onclick = (e) => copy(p, e.currentTarget);
  $('dl-draft').onclick = () => download(d, `${bot.name}_정리본.md`); $('dl-prompt').onclick = () => download(p, `${bot.name}_프롬프트.md`);
  const handoff = !generators[bot.id];
  $('result-card').classList.toggle('is-handoff', handoff);
  $('h-draft').textContent = handoff ? '2. 내가 적은 입력 정리' : '1. 정리된 초안';
  $('h-prompt').textContent = handoff ? '1. 이 프롬프트를 내 AI에 붙여넣으면 대화가 시작됩니다' : '2. 내 AI에 붙여넣는 완성 프롬프트';
  $('p-draft').textContent = handoff ? '위 프롬프트에 이미 들어가 있는 내용입니다. 따로 보관하고 싶을 때 복사하세요.' : '입력한 내용을 이 도구의 순서대로 정리했습니다. 그대로 복사해 쓰거나, 아래 2번으로 AI에게 완성시키세요.';
  $('p-prompt').textContent = handoff ? '아래 전체를 복사해서 ChatGPT·Claude·Gemini 새 대화에 붙여넣으세요. 원래 챗봇처럼 질문을 주고받으며 끝까지 완성해 줍니다. 무료 계정도 됩니다.' : '아래 전체를 복사해서 ChatGPT·Claude·Gemini 새 대화에 붙여넣으면, 이 챗봇이 하던 대화를 그대로 이어서 합니다. 무료 계정도 됩니다.';
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
  try { bot = await fetch(`./bots/${botId}.json?v=20261030`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  catch { $('bot-title').textContent = '이 도구를 찾을 수 없어요'; $('bot-tagline').innerHTML = '<a href="../../tools.html">잇툴즈 목록</a>에서 다시 골라주세요.'; $('intro-card').hidden = true; return; }
  renderHead();
  if (bot.admin_only) { const ok = await isAdmin(); if (!ok) { show('lock-card'); return; } }
  load();
  $('start-btn').onclick = () => { show('q-card'); renderQuestion(); track('chatbot_start', { bot: bot.id }); };
  $('next-btn').onclick = () => { if (!commit()) return; if (idx < bot.steps.length - 1) { idx++; save(); renderQuestion(); } else renderReview(); };
  $('prev-btn').onclick = () => { commit(); if (idx > 0) { idx--; save(); renderQuestion(); } };
  $('reset-btn').onclick = () => { if (!confirm('지금까지 적은 답을 지우고 처음부터 할까요?')) return; answers = {}; idx = 0; save(); renderQuestion(); };
  $('edit-btn').onclick = () => { idx = 0; show('q-card'); renderQuestion(); };
  $('make-btn').onclick = renderResult;
  $('again-btn').onclick = () => { show('q-card'); renderQuestion(); };
  $('q-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('next-btn').click(); });
  if (Object.keys(answers).length) { show('q-card'); renderQuestion(); }
}
init();
