import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';
import { renderUsageView } from './project-instruction-usage-view.js';
const $ = id => document.getElementById(id);
const API = '/api/project-instruction';
const state = { client: null, session: null, classes: [], page: 1, data: null, detail: null, loadSequence: 0, detailSequence: 0, busy: false };
const date = value => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '—';
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearPrivateView() { state.data = null; state.detail = null; state.classes = []; state.loadSequence++; state.detailSequence++; $('workspace').hidden = true; $('sign-out').hidden = true; $('rows').replaceChildren(); $('class-list').replaceChildren(); $('original-text').textContent = ''; $('case-draft').value = ''; $('usage-overview').replaceChildren(); $('detail-usage').replaceChildren(); if ($('detail').open) $('detail').close(); }
async function request(action, payload = {}, method = 'POST', retried = false) {
  const usage = action.startsWith('usage-');
  const url = new URL(usage ? '/api/project-instruction-usage' : API, location.href);
  url.searchParams.set('action', usage ? action.slice(6) : action);
  if (method === 'GET') Object.entries(payload).forEach(([key, value]) => { if (value !== '' && value !== undefined) url.searchParams.set(key, String(value)); });
  const response = await fetch(url, { method, cache: 'no-store', headers: { Authorization: 'Bearer ' + (state.session?.access_token || ''), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: JSON.stringify({ action, ...payload }) } : {}) });
  if (response.status === 401 && !retried && state.client) {
    const { data, error } = await state.client.auth.refreshSession();
    if (!error && data?.session) { state.session = data.session; return request(action, payload, method, true); }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) { clearPrivateView(); $('auth-panel').hidden = false; }
    const error = new Error(data.error || '요청을 완료하지 못했습니다.'); error.status = response.status; throw error;
  }
  return data;
}
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function button(text, action, className = 'secondary') { const el = element('button', text, className); el.type = 'button'; el.addEventListener('click', action); return el; }
async function mutate(buttonEl, operation) { if (state.busy) return; state.busy = true; buttonEl.disabled = true; try { await operation(); } catch (error) { status(error.message, true); } finally { state.busy = false; buttonEl.disabled = buttonEl.id === 'save-case' && !state.detail?.consent.caseStudy; } }
function classUrl(item) { return new URL('/tools/project-instruction/?class=' + encodeURIComponent(item.code), location.origin).href; }
async function copyLink(item) { try { await navigator.clipboard.writeText(classUrl(item)); status('강의 링크를 복사했습니다.'); } catch { window.prompt('강의 링크를 복사하세요.', classUrl(item)); } }
function renderClasses() {
  const selected = $('class-filter').value;
  $('class-filter').replaceChildren(element('option', '전체 제출')); $('class-filter').firstChild.value = '';
  $('class-list').replaceChildren();
  state.classes.forEach(item => {
    const option = element('option', [item.institution, item.course, item.session].join(' · ')); option.value = item.id; $('class-filter').append(option);
    const row = element('div', undefined, 'class-row'), text = element('div');
    text.append(element('strong', item.course), element('small', item.institution + ' · ' + item.session + ' · ' + (item.isOpen ? '접수 중' : '접수 마감')));
    const controls = element('div', undefined, 'class-actions');
    const toggle = button(item.isOpen ? '접수 마감' : '다시 열기', () => mutate(toggle, async () => {
      if (!window.confirm(item.course + ' / ' + item.session + '의 접수를 ' + (item.isOpen ? '마감' : '다시 시작') + '할까요?')) return;
      await request('admin-set-class', { id: item.id, isOpen: !item.isOpen }); await loadList();
    }));
    controls.append(button('링크 복사', () => copyLink(item)), toggle); row.append(text, controls); $('class-list').append(row);
  });
  if (state.classes.some(item => item.id === selected)) $('class-filter').value = selected;
  if (!state.classes.length) $('class-list').append(element('p', '아직 강의 링크가 없습니다. 개인 사용 제출도 전체 목록에서 확인할 수 있습니다.', 'hint'));
  $('class-limit').hidden = !state.data.classesTruncated;
}
function renderList() {
  const data = state.data, stats = data.stats;
  $('total-stat').textContent = stats.total + '건'; $('case-stat').textContent = stats.caseStudy + ' / ' + stats.total + '건';
  $('age-stat').textContent = stats.ageAnswered + ' / ' + stats.total + '건'; $('experience-stat').textContent = stats.aiExperienceAnswered + ' / ' + stats.total + '건';
  $('distributions').replaceChildren();
  [['ageRange','연령대','ageAnswered'],['gender','성별','genderAnswered'],['occupation','하는 일','occupationAnswered'],['aiExperience','AI 사용 경험','aiExperienceAnswered']].forEach(([key,label,countKey]) => {
    const block=element('section',undefined,'distribution'), answered=stats[countKey] || 0;
    block.append(element('h3',label),element('p','응답 '+answered+'건 / 전체 '+stats.total+'건 · 미응답 '+(stats.total-answered)+'건'));
    const list=element('ul');
    for(const item of (stats.distributions?.[key] || [])) list.append(element('li',item.value+': '+item.count+' / '+answered+'건 ('+(answered ? (item.count/answered*100).toFixed(1) : '0')+'%)'+(item.count<5?' · 소수 집계':'')));
    if(!answered)block.append(element('p','선택 응답이 없습니다.'));else block.append(list);
    $('distributions').append(block);
  });
  const retention=data.retention, stale=!retention?.lastSuccessAt || Date.now()-Date.parse(retention.lastSuccessAt)>2*60*60*1000;
  $('retention-warning').hidden=!stale && !retention?.expiredCount;
  $('retention-warning').textContent='보관 기간 정리 확인: 마지막 성공 '+date(retention?.lastSuccessAt)+' · 만료 후 정리 대기 '+(retention?.expiredCount||0)+'건. '+(stale?'정리 작업이 2시간 이내 성공했는지 확인해 주세요.':'다음 정기 정리 후 남은 건수를 확인해 주세요.');
  $('rows').replaceChildren(); $('empty').hidden = data.submissions.length > 0;
  data.submissions.forEach(item => {
    const row = element('tr'), p = item.participation || {};
    const title = element('td'); title.append(element('strong', item.title), element('small', '업무지시서 작성 단계'));
    const course = element('td', p.institution || '강의 외 개인 사용'); course.append(element('small', [p.course, p.session].filter(Boolean).join(' · ') || '강의 정보 없음'));
    const answers = element('td'); answers.append(element('span', [p.ageRange, p.gender].filter(Boolean).join(' · ') || '연령·성별 미응답'), element('small', [p.occupation, p.aiExperience].filter(Boolean).join(' · ') || '직무·경험 미응답'));
    const consent = element('td', '내부 보관·국외 처리 동의'); consent.append(element('small', '사례 사용 ' + (item.consent.caseStudy ? '동의' : '미동의·철회') + (item.caseUpdatedAt ? ' · 편집본 있음' : '')));
    const dates = element('td', date(item.submittedAt)); dates.append(element('small', '보관 ~ ' + date(item.expiresAt)));
    const action = element('td'); action.append(button('원문·사용 기록', () => openDetail(item.id)));
    row.append(title, course, answers, consent, dates, action); $('rows').append(row);
  });
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize)); $('page-label').textContent = data.page + ' / ' + pages + '쪽 · ' + data.total + '건';
  $('previous').disabled = data.page <= 1; $('next').disabled = data.page >= pages;
}
async function loadList() {
  const sequence = ++state.loadSequence; const scope = { classId: $('class-filter').value, q: $('search').value.trim(), page: state.page }; status('제출 자료를 불러오고 있습니다.');
  try {
    const data = await request('admin-list', scope, 'GET');
    if (sequence !== state.loadSequence) return;
    state.data = data; state.classes = data.classes; renderClasses(); renderList();
    $('workspace').hidden = false; $('auth-panel').hidden = true; $('sign-out').hidden = false; status('보관 기간 내 실제 제출 ' + data.total + '건을 확인했습니다.');
    const usage = await request('usage-admin-summary', { classId: scope.classId, q: scope.q }, 'GET').catch(() => null);
    if (sequence === state.loadSequence) renderUsageView($('usage-overview'), usage, { summary: true });
  } catch (error) { if (sequence === state.loadSequence) status(error.message, true); }
}
function changePane(casePane) {
  $('original-pane').hidden = casePane; $('case-pane').hidden = !casePane;
  $('original-tab').setAttribute('aria-pressed', String(!casePane)); $('case-tab').setAttribute('aria-pressed', String(casePane));
  $('original-tab').classList.toggle('secondary', casePane); $('case-tab').classList.toggle('secondary', !casePane);
}
async function openDetail(id) {
  const sequence = ++state.detailSequence;
  try {
    const { submission } = await request('admin-detail', { id }, 'GET');
    if (sequence !== state.detailSequence) return;
    state.detail = submission; $('detail-title').textContent = submission.title;
    const p = submission.participation || {};
    $('detail-meta').textContent = [p.institution || '개인 사용', p.course, p.session, '제출 ' + date(submission.submittedAt), '보관 기한 ' + date(submission.expiresAt)].filter(Boolean).join(' · ');
    $('original-text').textContent = submission.document; $('case-draft').value = submission.caseDraft;
    $('case-draft').disabled = !submission.consent.caseStudy; $('save-case').disabled = !submission.consent.caseStudy;
    $('case-status').textContent = submission.consent.caseStudy ? '사례 사용 동의 확인됨 · 실제 공개 전 내용과 사용 범위를 별도로 검토해 주세요.' : '사례 사용 미동의 또는 철회됨 · 사례 편집본을 저장할 수 없습니다.';
    changePane(false); if (!$('detail').open) $('detail').showModal();
    $('detail-usage').textContent = '사용 기록을 확인하고 있습니다…';
    const usage = await request('usage-admin-detail', { id }, 'GET').catch(() => null);
    if (sequence === state.detailSequence && state.detail?.id === id) renderUsageView($('detail-usage'), usage);
  } catch (error) { status(error.message, true); }
}
function canCloseDetail() { if (state.busy) return false; return !state.detail || $('case-draft').value === state.detail.caseDraft || window.confirm('저장하지 않은 사례 편집 내용이 있습니다. 닫을까요?'); }
$('close-detail').addEventListener('click', () => { if (canCloseDetail()) $('detail').close(); });
$('detail').addEventListener('cancel', event => { if (!canCloseDetail()) event.preventDefault(); });
$('original-tab').addEventListener('click', () => changePane(false)); $('case-tab').addEventListener('click', () => changePane(true));
$('save-case').addEventListener('click', () => mutate($('save-case'), async () => {
  if (!state.detail?.consent.caseStudy) return;
  const draft = $('case-draft').value, id = state.detail.id;
  try { await request('admin-save-case', { id, caseDraft: draft }); if (state.detail?.id !== id) return; state.detail.caseDraft = draft; $('case-status').textContent = '원문과 별도로 편집본을 저장했습니다. 외부에 공개하지 않았습니다.'; await loadList(); }
  catch (error) { if (error.status === 409 && state.detail?.id === id) { state.detail.consent.caseStudy = false; $('case-draft').disabled = true; $('case-status').textContent = error.message; } throw error; }
}));
$('delete-submission').addEventListener('click', () => mutate($('delete-submission'), async () => {
  if (!state.detail || !window.confirm('「' + state.detail.title + '」의 원문·참여 정보·사례 편집본과 사용 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
  await request('admin-delete', { id: state.detail.id }); state.detail = null; $('detail').close(); $('original-text').textContent = ''; $('case-draft').value = ''; await loadList(); status('제출 자료를 삭제했습니다.');
}));
$('download-original').addEventListener('click', () => { if (!state.detail) return; const url = URL.createObjectURL(new Blob([state.detail.document], { type: 'text/markdown;charset=utf-8' })); const a = element('a'); a.href = url; a.download = 'AI_업무지시서.md'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('create-class').addEventListener('submit', event => { event.preventDefault(); const submit = event.currentTarget.querySelector('button[type=submit]'); mutate(submit, async () => { const payload = Object.fromEntries(new FormData($('create-class'))); const data = await request('admin-create-class', payload); $('create-class').reset(); await loadList(); await copyLink(data.class); }); });
$('filter-form').addEventListener('submit', event => { event.preventDefault(); state.page = 1; loadList(); }); $('refresh').addEventListener('click', () => loadList());
$('previous').addEventListener('click', () => { if (state.page > 1) { state.page--; loadList(); } }); $('next').addEventListener('click', () => { state.page++; loadList(); });
$('sign-out').addEventListener('click', async () => { if (state.client) await state.client.auth.signOut(); state.session = null; clearPrivateView(); $('auth-panel').hidden = false; status('로그아웃했습니다.'); });
async function initialize() {
  status('관리자 권한을 확인하고 있습니다.');
  try {
    if (!state.client) { const response = await fetch('/api/config', { cache: 'no-store' }); const config = await response.json(); if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) throw new Error('로그인 설정을 불러오지 못했습니다.'); state.client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } }); }
    const { data } = await state.client.auth.getSession(); state.session = data.session;
    if (!state.session) { clearPrivateView(); $('auth-panel').hidden = false; status('관리자 계정으로 로그인해 주세요.'); return; }
    await loadList();
  } catch (error) { clearPrivateView(); $('auth-panel').hidden = false; status(error.message, true); }
}
$('retry-auth').addEventListener('click', initialize);
initialize();
