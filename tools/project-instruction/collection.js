// Collection is opt-in. The generator never calls the submission API itself.
const API = '/api/project-instruction';
const VERSION = '2026-10-01-v1';
const PENDING_KEY = 'bcc-pi-submission-v1';
const FIELDS = { institution: '교육 기관', course: '강의 이름', session: '회차·수업일', ageRange: '연령대', gender: '성별', occupation: '주로 하는 일', aiExperience: 'AI 사용 경험' };
const $ = id => document.getElementById(id);

async function api(action, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'), { status: response.status, code: result.code });
    if (action === 'submit' && (!/^[0-9a-f-]{36}$/i.test(result.id || '') || !Number.isFinite(Date.parse(result.submittedAt)) || !Number.isFinite(Date.parse(result.expiresAt)) || typeof result.replayed !== 'boolean')) throw new Error('제출 확인 응답을 받지 못했습니다. 같은 내용으로 다시 제출해 확인해 주세요.');
    if (action.startsWith('receipt-') && result.ok !== true) throw new Error('처리 결과를 확인하지 못했습니다. 확인번호로 다시 요청해 주세요.');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('연결이 끊겼습니다. 입력은 유지됩니다. 같은 내용으로 다시 제출하면 중복 저장되지 않습니다.');
    throw error;
  } finally { clearTimeout(timer); }
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initCollection() {
  let participation = {};
  let classCode = '';
  let source = '';
  let busy = false;
  let admitted = false;
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)); } catch { /* in-memory retry remains possible */ }
  if (!pending || typeof pending !== 'object' || !pending.payload || !/^[a-f0-9]{64}$/.test(pending.payload.receiptToken || '')) pending = null;

  function savePending() {
    try { if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); else sessionStorage.removeItem(PENDING_KEY); } catch { /* retain in current tab */ }
  }
  function updateButton() {
    $('submit-instruction').disabled = busy || !admitted || !!pending?.result || !$('consent-internal').checked || !$('consent-overseas').checked || !$('submission-document').value.trim();
    $('submission-document').readOnly = busy || !!pending?.result;
    for (const id of ['consent-internal', 'consent-overseas', 'consent-case', 'edit-participation']) $(id).disabled = busy || !!pending?.result;
  }
  function clearConsent() {
    for (const name of ['internal', 'overseas', 'case']) $('consent-' + name).checked = false;
    $('submission-status').textContent = '전송할 내용이 바뀌었습니다. 사본과 참여 정보를 다시 확인하고 동의해 주세요.';
  }
  function reviewParticipation() {
    const list = $('participation-review'); list.replaceChildren();
    for (const [key, label] of Object.entries(FIELDS)) {
      const row = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = participation[key] || '응답하지 않음';
      row.append(dt, dd); list.append(row);
    }
    $('participation-summary').textContent = [participation.institution, participation.course, participation.session].filter(Boolean).join(' · ') || '수업 정보 없이 이용 중';
  }
  function receiptText() {
    if (!pending?.result) return '';
    const r = pending.result;
    return `BCC AI 업무지시서 제출 확인서\n\n확인번호: ${r.id}\n관리키: ${pending.payload.receiptToken}\n제출일: ${new Date(r.submittedAt).toLocaleString('ko-KR')}\n보관 만료일: ${new Date(r.expiresAt).toLocaleString('ko-KR')}\n\n삭제·사례 동의 철회: https://bccconsulting.kr/tools/project-instruction/#receipt-management\n문의: https://open.kakao.com/o/gmPptFti\n관리키를 다른 사람과 공유하지 마세요.`;
  }
  function showReceipt() {
    if (!pending?.result) return;
    $('submission-status').textContent = '제출되었습니다. 확인서를 받아 보관해 주세요. 자료는 자동 공개되지 않습니다.';
    $('submission-receipt').hidden = false;
    $('receipt-details').textContent = `확인번호: ${pending.result.id}\n보관 만료일: ${new Date(pending.result.expiresAt).toLocaleString('ko-KR')}`;
    $('receipt-id').value = pending.result.id;
    $('receipt-token').value = pending.payload.receiptToken;
    updateButton();
  }
  function resumePending() {
    if (!pending) return;
    participation = { ...pending.payload.participation };
    classCode = pending.payload.classCode || '';
    for (const key of Object.keys(FIELDS)) $('pi-' + key).value = participation[key] || '';
    if (classCode) {
      for (const key of ['institution', 'course', 'session']) $('pi-' + key).disabled = true;
      $('linked-class').hidden = false;
      $('linked-class').textContent = '이전 제출의 강의 연결 정보입니다. 제출 확인이 끝날 때까지 기존 내용을 유지합니다.';
      $('unlink-class').hidden = false;
    }
    $('submission-document').value = pending.payload.document;
    // A failed request may be retried only after consciously checking consent again.
    $('consent-internal').checked = !!pending.result;
    $('consent-overseas').checked = !!pending.result;
    $('consent-case').checked = !!pending.result && pending.payload.consent.caseStudy === true;
    if (pending.result) showReceipt();
    else $('submission-status').textContent = '이전 제출의 응답을 확인하지 못했습니다. 내용을 확인하고 동의 후 다시 제출해 주세요. 동일한 요청은 한 번만 저장됩니다.';
  }
  resumePending();

  $('participation-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('age-confirm').checked || busy) return;
    const nextParticipation = Object.fromEntries(Object.keys(FIELDS).map(key => [key, $('pi-' + key).value.trim()]));
    if (JSON.stringify(participation) !== JSON.stringify(nextParticipation) && !pending?.result) clearConsent();
    participation = nextParticipation;
    admitted = true;
    $('participation-section').hidden = true;
    $('generator-area').hidden = false;
    reviewParticipation(); updateButton();
    $('generator-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('edit-participation').addEventListener('click', () => {
    if (busy || pending?.result) return;
    $('participation-section').hidden = false;
    $('generator-area').hidden = true;
    $('participation-section').scrollIntoView({ behavior: 'smooth' });
  });
  $('unlink-class').addEventListener('click', () => {
    classCode = '';
    for (const key of ['institution', 'course', 'session']) { $('pi-' + key).disabled = false; $('pi-' + key).value = ''; }
    $('linked-class').textContent = '수업 정보를 직접 적거나 비워두세요.';
    $('unlink-class').hidden = true;
  });
  for (const id of ['consent-internal', 'consent-overseas', 'consent-case']) $(id).addEventListener('change', updateButton);
  $('submission-document').addEventListener('input', () => { clearConsent(); updateButton(); });
  $('refresh-submission-copy').addEventListener('click', () => {
    if (pending || busy) return;
    if (!window.confirm('수정해 둔 제출 사본을 최신 작성 내용으로 바꿀까요? 지웠던 개인정보가 다시 포함될 수 있으니 전체 내용을 확인해 주세요.')) return;
    $('submission-document').value = source;
    $('refresh-submission-copy').hidden = true;
    $('submission-copy-notice').textContent = '최신 내용으로 바꿨습니다. 제출할 사본을 다시 확인해 주세요.';
    clearConsent(); updateButton();
  });

  $('submit-instruction').addEventListener('click', async () => {
    if (busy || !admitted || pending?.result || !$('age-confirm').checked || !$('consent-internal').checked || !$('consent-overseas').checked) return;
    const data = { classCode, participation, document: $('submission-document').value, consent: { version: VERSION, age14: true, internal: true, overseas: true, caseStudy: $('consent-case').checked } };
    if (!data.document.trim()) return;
    const fingerprint = JSON.stringify(data);
    if (pending && pending.fingerprint !== fingerprint) {
      // Never create another document while a previous response may have been lost.
      $('submission-status').textContent = '이전 제출 결과가 확인되지 않았습니다. 먼저 기존 내용으로 제출 결과를 확인한 뒤, 확인서로 삭제하고 새로 제출해 주세요.';
      participation = { ...pending.payload.participation }; classCode = pending.payload.classCode || '';
      for (const key of Object.keys(FIELDS)) $('pi-' + key).value = participation[key] || '';
      $('submission-document').value = pending.payload.document;
      $('consent-case').checked = pending.payload.consent.caseStudy;
      reviewParticipation(); updateButton(); return;
    }
    if (!pending) {
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
      pending = { fingerprint, source, payload: { ...data, idempotencyKey: crypto.randomUUID(), receiptToken: token } };
      savePending();
    }
    busy = true; updateButton(); $('submission-status').textContent = '제출 중입니다…';
    try { pending.result = await api('submit', pending.payload); savePending(); showReceipt(); }
    catch (error) {
      // A definitive rejection has not written anything. It is safe to edit and
      // create a new request; unknown network/5xx outcomes retain their key.
      if ([400, 404, 413, 415, 429].includes(error.status) || error.code === 'class_closed' || error.code === 'conflict') { pending = null; savePending(); }
      $('submission-status').textContent = error.message;
    }
    finally { busy = false; updateButton(); }
  });
  $('download-receipt').addEventListener('click', () => download(receiptText(), 'BCC_업무지시서_제출확인서.txt'));

  async function manage(action) {
    if (busy) return;
    const id = $('receipt-id').value.trim(); const receiptToken = $('receipt-token').value.trim();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{64}$/i.test(receiptToken)) { $('receipt-status').textContent = '제출 확인서에 적힌 확인번호와 관리키를 확인해 주세요.'; return; }
    const deleting = action === 'receipt-delete';
    if (!window.confirm(deleting ? '서버에 제출한 원문·참여 정보·사례 편집본을 삭제할까요? 이 기기의 작성 기록은 유지됩니다.' : '사례 활용 동의를 철회하고 서버의 사례 편집본을 지울까요? 원문은 내부 보관됩니다.')) return;
    busy = true; updateButton(); $('receipt-status').textContent = '처리 중입니다…';
    try {
      await api(action, { id, receiptToken });
      $('receipt-status').textContent = deleting ? '서버의 제출 자료를 삭제했습니다.' : '사례 활용 동의를 철회했습니다. 이미 사용된 외부 사례의 제거는 BCC에도 문의해 주세요.';
      if (pending?.result?.id === id) {
        if (deleting) { pending = null; savePending(); $('submission-receipt').hidden = true; $('submission-status').textContent = '제출 자료가 삭제되었습니다. 다시 동의한 뒤 새로 제출할 수 있습니다.'; for (const name of ['internal', 'overseas', 'case']) $('consent-' + name).checked = false; }
        else { pending.payload.consent.caseStudy = false; $('consent-case').checked = false; savePending(); }
      }
    } catch (error) { $('receipt-status').textContent = error.message; }
    finally { busy = false; updateButton(); }
  }
  $('withdraw-case').addEventListener('click', () => manage('receipt-withdraw'));
  $('delete-submission').addEventListener('click', () => manage('receipt-delete'));

  const code = new URLSearchParams(location.search).get('class') || '';
  if (code && !pending) {
    $('linked-class').hidden = false; $('linked-class').textContent = '수업 정보를 확인하고 있습니다…';
    $('participation-form').querySelector('button[type="submit"]').disabled = true;
    const classController = new AbortController();
    const classTimer = setTimeout(() => classController.abort(), 8000);
    fetch(`${API}?action=class&code=${encodeURIComponent(code)}`, { cache: 'no-store', signal: classController.signal }).then(async response => {
      const result = await response.json(); if (!response.ok || !result.class) throw new Error('연결된 수업을 확인할 수 없습니다. 수업 정보를 직접 적거나 비워두고 이용하세요.');
      classCode = result.class.code;
      for (const key of ['institution', 'course', 'session']) { $('pi-' + key).value = result.class[key] || ''; $('pi-' + key).disabled = true; }
      $('linked-class').textContent = result.class.isOpen ? '강의 링크로 연결되었습니다. 수업이 맞는지 확인해 주세요.' : '이 수업의 제출은 마감되었습니다. 작성·다운로드는 계속 이용할 수 있어요.'; $('unlink-class').hidden = false;
    }).catch(() => { $('linked-class').textContent = '수업 연결을 확인하지 못했습니다. 직접 적거나 비워두고 이용할 수 있습니다.'; }).finally(() => { clearTimeout(classTimer); $('participation-form').querySelector('button[type="submit"]').disabled = false; });
  }

  return {
    setDocument(markdown) {
      $('collection-section').hidden = !markdown;
      if (!markdown) return;
      if (source !== markdown && !pending) {
        if (!source) $('submission-document').value = markdown;
        else {
          $('submission-copy-notice').textContent = '내 업무지시서가 새로 만들어졌습니다. 직접 수정한 제출 사본은 보존했습니다. 필요하면 최신 내용으로 바꿔주세요.';
          $('refresh-submission-copy').hidden = false;
          clearConsent();
        }
        source = markdown;
      }
      if (pending) source = pending.source || markdown;
      reviewParticipation(); updateButton();
    },
    reset() {
      // Keep downloaded receipts valid; a new local worksheet must not delete server data.
      if (pending && !pending.result) { $('submission-status').textContent = '확인되지 않은 이전 제출이 남아 있습니다. 완성 후 제출 결과를 먼저 확인해 주세요.'; return; }
      pending = null; source = ''; savePending();
      $('submission-copy-notice').textContent = ''; $('refresh-submission-copy').hidden = true;
      $('collection-section').hidden = true; $('submission-receipt').hidden = true;
      for (const name of ['internal', 'overseas', 'case']) $('consent-' + name).checked = false;
      $('submission-status').textContent = '수집·국외 처리 동의 후 제출할 수 있습니다.'; updateButton();
    },
  };
}
