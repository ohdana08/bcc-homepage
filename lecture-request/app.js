(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('requestForm');
  const steps = [...document.querySelectorAll('.step')];
  const stepNames = ['기관·담당자', '교육대상·목표', '일정·환경', '예산·요청 사항', '확인·제출'];
  const groups = [
    ['기관·담당자', ['institution_name', 'project_name', 'contact_name', 'contact_email', 'contact_phone']],
    ['교육대상·목표', ['audience', 'age_range', 'audience_size', 'ai_experience', 'ai_tools', 'purpose', 'learner_expectations', 'organizer_expectations', 'desired_outputs']],
    ['일정·환경', ['lecture_date', 'date_notes', 'time', 'duration_hours', 'location', 'desk_layout', 'equipment', 'computer_access', 'tool_access']],
    ['예산·요청 사항', ['total_budget_range', 'total_budget', 'lecturer_fee_range', 'lecturer_fee', 'required_documents', 'deadline_notes', 'parking', 'special_notes']],
  ];
  const labels = { institution_name: '기관·회사명', project_name: '담당 사업명·교육명', contact_name: '담당자 성함', contact_email: '담당자 이메일', contact_phone: '담당자 연락처', audience: '교육대상', age_range: '연령대', audience_size: '예상 인원', ai_experience: 'AI 활용 경험', ai_tools: '사용 중인 AI 도구', purpose: '교육 목적', learner_expectations: '교육생이 바라는 기대효과', organizer_expectations: '교육담당자가 바라는 기대효과', desired_outputs: '만들고 싶은 결과물', lecture_date: '희망 강의 날짜', date_notes: '일정 메모', time: '강의 시간대', duration_hours: '총 강의 시간', location: '장소·주소', desk_layout: '책상 배열', equipment: '사용 가능한 장비', computer_access: '컴퓨터 사용', tool_access: 'AI 도구 이용 환경', total_budget: '총 교육 예산', lecturer_fee: '책정 강사료', required_documents: '필요한 서류', deadline_notes: '회신·제출 기한', parking: '주차·출입 안내', special_notes: '특이사항' };
  const numeric = new Set(['audience_size', 'duration_hours', 'total_budget', 'lecturer_fee']);
  labels.total_budget_range = '총 교육 예산 범위';
  labels.lecturer_fee_range = '책정 강사료 범위';
  const choiceGroups = new Map();
  const customLabel = '기타 · 직접 입력';
  const choices = {
    audience: { required: true, options: ['공공기관·행정 실무자', '기업 임직원', '창업자·소상공인', '취업준비생', '학생·청소년', '일반 시민·시니어', '아직 미정'], custom: true },
    purpose: { required: true, multiple: true, options: ['AI 기초 이해', '업무 시간 절약', '보고서·문서 작성', '홍보 콘텐츠 제작', '데이터 분석', '교육·강의 준비', '업무 자동화', '추천받고 싶어요'], exclusive: ['추천받고 싶어요'], custom: true },
    age_range: { multiple: true, options: ['10대', '20대', '30대', '40대', '50대', '60대 이상', '다양한 연령', '아직 확인하지 못했어요'], exclusive: ['아직 확인하지 못했어요'], custom: true },
    audience_size: { numeric: true, options: ['10', '20', '30', '50', '100', '미정'], suffix: '명', custom: true },
    ai_experience: { options: ['처음 사용해요', '가끔 사용해요', '업무에 자주 사용해요', '수준이 다양해요', '아직 확인하지 못했어요'], custom: true },
    ai_tools: { multiple: true, options: ['ChatGPT', 'Gemini', 'Claude', 'Copilot', 'NotebookLM', 'Canva', '아직 사용하지 않아요', '잘 모르겠어요'], exclusive: ['아직 사용하지 않아요', '잘 모르겠어요'], custom: true },
    learner_expectations: { multiple: true, options: ['AI를 처음부터 쉽게 배우기', '수업에서 직접 결과물 만들기', '배운 내용을 업무에 바로 쓰기', 'AI 결과를 확인·수정하는 법 배우기', '아직 의견을 듣지 못했어요'], exclusive: ['아직 의견을 듣지 못했어요'], custom: true },
    organizer_expectations: { multiple: true, options: ['교육생의 AI 활용 자신감', '반복 업무 시간 줄이기', '실무에 쓸 결과물 완성', '안전한 AI 활용 기준 익히기', '교육 이후에도 계속 활용하기', '추천받고 싶어요'], exclusive: ['추천받고 싶어요'], custom: true },
    desired_outputs: { multiple: true, options: ['보고서·회의록', '제안서·사업계획서', '홍보글·블로그', '홍보 이미지·카드뉴스', '짧은 영상·숏폼', '데이터 분석 결과', '업무 자동화 도구', '강의안·교육자료', '추천받고 싶어요'], exclusive: ['추천받고 싶어요'], custom: true },
    time: { options: ['오전', '오후', '저녁', '협의 가능'], custom: true },
    duration_hours: { numeric: true, options: ['1', '2', '3', '4', '6', '8', '미정'], suffix: '시간', custom: true },
    desk_layout: { options: ['학교식 (앞을 보는 배열)', '모둠식 (조별 배열)', '회의식', '온라인 교육', '미정·확인 필요'], custom: true },
    computer_access: { options: ['기관 컴퓨터 제공', '개인 노트북 지참', '일부만 사용 가능', '스마트폰만 사용', '실습 기기 없음', '미정·확인 필요'], custom: true },
    tool_access: { options: ['무료 도구만 사용', '유료 도구 사용 가능', '무료·유료 혼합', '기관 보안정책 확인 필요', '미정·확인 필요'], custom: true },
    total_budget: { numeric: true, rangeField: 'total_budget_range', options: ['미정·협의', '50만원 미만', '50~100만원', '100~200만원', '200~300만원', '300만원 이상'], custom: true },
    lecturer_fee: { numeric: true, rangeField: 'lecturer_fee_range', options: ['미정·협의', '50만원 미만', '50~100만원', '100~200만원', '200~300만원', '300만원 이상'], custom: true },
    required_documents: { multiple: true, options: ['강사 프로필', '강의계획서', '견적서', '사업자등록증', '통장사본', '추후 안내'], exclusive: ['추후 안내'], custom: true },
  };
  const storageKey = 'bcc-lecture-request-pending-v1';
  let step = 0;
  let busy = false;
  let dirty = false;
  let pending = null;
  let edit = null;
  let receipt = null;
  let submittedPayload = null;
  let changedRetryDraft = null;

  const hide = (id, value = true) => $(id).classList.toggle('hidden', value);
  function message(text, target = 'formError') { $(target).textContent = text; hide(target, !text); }
  function status(text) { $('status').textContent = text; }
  function payload() {
    const data = new FormData(form);
    const result = {};
    for (const key of Object.keys(labels)) {
      if (key === 'equipment') result[key] = data.getAll(key);
      else if (numeric.has(key)) result[key] = data.get(key) === '' ? null : Number(data.get(key));
      else result[key] = String(data.get(key) || '').trim();
    }
    for (const [key, group] of choiceGroups) {
      const selected = group.inputs.filter((input) => input.checked).map((input) => input.value);
      const custom = selected.includes('__custom') ? group.original.value.trim() : '';
      const predefined = selected.filter((value) => value !== '__custom');
      if (group.config.rangeField) {
        result[group.config.rangeField] = selected.includes('__custom') ? '직접 입력' : (predefined[0] || '');
        result[key] = custom ? Number(custom) : null;
      } else if (group.config.numeric) {
        const value = custom || predefined.find((item) => /^\d+(?:\.\d+)?$/.test(item));
        result[key] = value ? Number(value) : null;
      } else result[key] = [...predefined, ...(custom ? [custom] : [])].join('\n');
    }
    return result;
  }
  function restore(data) {
    for (const key of Object.keys(labels)) {
      if (key === 'equipment') {
        form.querySelectorAll('[name="equipment"]').forEach((input) => { input.checked = Array.isArray(data[key]) && data[key].includes(input.value); });
      } else {
        const input = form.elements.namedItem(key);
        if (input) {
          // Preserve older/unknown selection values when revisiting a saved request.
          if (input.tagName === 'SELECT' && data[key] && ![...input.options].some((option) => option.value === String(data[key]))) input.add(new Option(String(data[key]), String(data[key])));
          input.value = data[key] ?? '';
        }
      }
    }
    restoreChoices(data);
  }
  function syncChoice(group) {
    const custom = group.inputs.some((input) => input.value === '__custom' && input.checked);
    group.customArea.classList.toggle('hidden', !custom);
    group.original.disabled = !custom;
    group.original.required = false;
  }
  function restoreChoices(data) {
    for (const [key, group] of choiceGroups) {
      group.inputs.forEach((input) => { input.checked = false; });
      const raw = data[key];
      let selected = [];
      let custom = '';
      if (group.config.rangeField) {
        const range = data[group.config.rangeField] || '';
        if (raw !== null && raw !== undefined && raw !== '') { selected = ['__custom']; custom = String(raw); }
        else if (range && group.config.options.includes(range)) selected = [range];
        else if (range) { selected = ['__custom']; }
      } else if (group.config.numeric) {
        if (raw !== null && raw !== undefined && raw !== '') {
          if (group.config.options.includes(String(raw))) selected = [String(raw)];
          else { selected = ['__custom']; custom = String(raw); }
        }
      } else {
        const values = String(raw || '').split('\n').filter(Boolean);
        selected = values.filter((value) => group.config.options.includes(value));
        const remaining = values.filter((value) => !group.config.options.includes(value));
        if (remaining.length) { custom = remaining.join('\n'); selected.push('__custom'); }
        if (!group.config.multiple && selected.length > 1) { custom = String(raw || ''); selected = ['__custom']; }
      }
      group.inputs.forEach((input) => { input.checked = selected.includes(input.value); });
      group.original.value = custom;
      syncChoice(group);
    }
  }
  function buildChoices() {
    for (const [key, config] of Object.entries(choices)) {
      let original = form.elements.namedItem(key);
      const field = original.closest('.field');
      const oldLabel = field.querySelector('label');
      field.classList.add('full', 'has-choices');
      const fieldset = document.createElement('fieldset'); fieldset.className = 'choice-picker';
      const legend = document.createElement('legend'); legend.innerHTML = oldLabel.innerHTML;
      oldLabel.remove(); fieldset.append(legend);
      if (config.multiple) { const help = document.createElement('p'); help.className = 'choice-hint'; help.textContent = '여러 개를 선택할 수 있어요.'; fieldset.append(help); }
      const options = document.createElement('div'); options.className = 'choice-grid';
      const inputs = [];
      for (const [index, value] of [...config.options, ...(config.custom ? ['__custom'] : [])].entries()) {
        const label = document.createElement('label'); label.className = 'choice-option';
        const input = document.createElement('input'); input.type = config.multiple ? 'checkbox' : 'radio'; input.name = 'choice_' + key; input.value = value; input.id = 'choice_' + key + '_' + index;
        const text = document.createElement('span'); text.textContent = value === '__custom' ? (config.numeric ? '직접 입력' : customLabel) : config.suffix && /^\d/.test(value) ? value + config.suffix : value;
        label.append(input, text); options.append(label); inputs.push(input);
      }
      fieldset.append(options);
      // Keep the original API field as an optional custom answer, not a second required question.
      if (original.tagName === 'SELECT') {
        const replacement = document.createElement('textarea'); replacement.id = original.id; replacement.name = original.name; replacement.maxLength = ({ai_experience:500,desk_layout:200,computer_access:300,tool_access:300})[key] || 300; replacement.rows = 2;
        original.replaceWith(replacement); original = replacement;
      } else if (original.tagName === 'INPUT' && !config.numeric) {
        const replacement = document.createElement('textarea'); replacement.id = original.id; replacement.name = original.name; replacement.maxLength = original.maxLength > 0 ? original.maxLength : 500; replacement.rows = 2;
        original.replaceWith(replacement); original = replacement;
      }
      original.required = false;
      original.placeholder = config.numeric ? '정확한 숫자를 알고 계시면 입력해 주세요' : '추가로 알려주실 내용을 자유롭게 적어주세요';
      const customArea = document.createElement('div'); customArea.className = 'choice-custom hidden';
      const customLabelElement = document.createElement('label'); customLabelElement.htmlFor = key; customLabelElement.textContent = config.numeric ? '정확한 값 직접 입력' : '직접 입력할 내용';
      const oldUnit = original.closest('.input-unit');
      customArea.append(customLabelElement, oldUnit || original);
      field.prepend(fieldset); field.append(customArea);
      const group = {config,original,inputs,fieldset,customArea}; choiceGroups.set(key,group);
      inputs.forEach((input) => input.addEventListener('change', () => {
        if (input.checked && config.multiple) {
          if (config.exclusive?.includes(input.value)) inputs.forEach((other) => { if (other !== input) other.checked = false; });
          else inputs.forEach((other) => { if (config.exclusive?.includes(other.value)) other.checked = false; });
        }
        syncChoice(group); if (input.checked && input.value === '__custom') original.focus();
      }));
      syncChoice(group);
    }
    // The two decisions needed for a useful first conversation stay visible.
    // Optional planning detail can be opened without blocking an unplanned inquiry.
    const audienceField = $('audience').closest('.field');
    const purposeField = $('purpose').closest('.field');
    const sectionFields = audienceField.parentElement;
    audienceField.insertAdjacentElement('afterend', purposeField);
    const optional = document.createElement('details'); optional.className = 'optional-planning field full';
    const summary = document.createElement('summary'); summary.textContent = '교육생 수준·기대효과도 선택할게요 (선택)';
    const body = document.createElement('div'); body.className = 'fields';
    [...sectionFields.children].filter((field) => field !== audienceField && field !== purposeField).forEach((field) => body.append(field));
    optional.append(summary,body); sectionFields.append(optional);
  }
  function displayValue(key, value) {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '미정·미입력';
    if (key === 'total_budget' || key === 'lecturer_fee') return Number(value).toLocaleString('ko-KR') + '원';
    if (key === 'audience_size') return value + '명';
    if (key === 'duration_hours') return value + '시간';
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  function renderReview() {
    const data = payload();
    const container = $('reviewSummary');
    container.replaceChildren();
    groups.forEach(([title, keys], index) => {
      const details = document.createElement('details');
      details.className = 'review-group';
      details.open = index === 0;
      const summary = document.createElement('summary');
      summary.textContent = title;
      const list = document.createElement('dl');
      keys.forEach((key) => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const value = document.createElement('dd');
        term.textContent = labels[key];
        value.textContent = displayValue(key, data[key]);
        if (value.textContent === '미정·미입력') value.className = 'empty-value';
        row.append(term, value);
        list.append(row);
      });
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'review-edit';
      button.textContent = title + ' 수정';
      button.addEventListener('click', () => showStep(index));
      details.append(summary, list, button);
      container.append(details);
    });
  }
  function showStep(index, focus = true) {
    step = Math.max(0, Math.min(steps.length - 1, index));
    message('');
    steps.forEach((section, i) => section.classList.toggle('hidden', i !== step));
    $('stepCount').textContent = String(step + 1).padStart(2, '0') + ' / 05';
    $('stepName').textContent = stepNames[step];
    $('progressFill').style.width = ((step + 1) / steps.length * 100) + '%';
    hide('backBtn', step === 0);
    hide('nextBtn', step === steps.length - 1);
    hide('submitBtn', step !== steps.length - 1);
    $('optionalNote').textContent = step === 0 ? '필수 정보부터 시작해요' : step === 4 ? '내용 확인 후 제출해 주세요' : '미정인 항목은 비워두세요';
    if (step === 4) renderReview();
    if (focus) $(`step${step}Title`).focus({ preventScroll: false });
  }
  function validate(index) {
    for (const group of choiceGroups.values()) {
      if (!steps[index].contains(group.fieldset) || !group.config.required) continue;
      const checked = group.inputs.filter((input) => input.checked);
      const hasAnswer = checked.some((input) => input.value !== '__custom') || (checked.some((input) => input.value === '__custom') && group.original.value.trim());
      if (!hasAnswer) {
        showStep(index); message('교육대상과 교육 목적을 하나 이상 선택해 주세요. 미정·추천 선택도 괜찮습니다.');
        group.inputs[0].focus(); return false;
      }
    }
    for (const input of steps[index].querySelectorAll('input,textarea,select')) {
      if (input.disabled) continue;
      input.removeAttribute('aria-invalid');
      if (input.required && input.type !== 'checkbox' && !input.value.trim()) input.setCustomValidity('이 항목을 입력해 주세요.');
      else input.setCustomValidity('');
      if (!input.checkValidity()) {
        showStep(index);
        input.setAttribute('aria-invalid', 'true');
        message(input.type === 'checkbox' ? '접수를 위해 두 항목에 동의해 주세요.' : '필수 항목과 입력 형식을 확인해 주세요.');
        input.reportValidity();
        input.focus();
        return false;
      }
    }
    return true;
  }
  async function api(body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/lecture-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || '접수를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('서버 응답을 확인하지 못했습니다. 입력 내용은 이 화면에 남아 있습니다. 다시 보내면 중복 접수되지 않습니다.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function newIdentity() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return { key: btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), idempotency_key: crypto.randomUUID() };
  }
  function identity() {
    if (pending) return pending;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved.key) && /^[0-9a-f-]{36}$/i.test(saved.idempotency_key)) pending = saved;
    } catch { /* Storage can be unavailable in a privacy-restricted browser. */ }
    if (!pending) pending = newIdentity();
    try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* In-memory identity still protects retry in this tab. */ }
    return pending;
  }
  function privateUrl(item) {
    const url = new URL('./', location.href);
    url.search = '';
    url.hash = new URLSearchParams({ receipt: item.receipt, key: item.key }).toString();
    return url.href;
  }
  function showSuccess(data, key, currentPayload, isUpdate) {
    receipt = { receipt: data.receipt, key, revision: data.revision || 1 };
    submittedPayload = currentPayload;
    $('receiptNumber').textContent = receipt.receipt;
    $('privateLink').value = privateUrl(receipt);
    $('successTitle').textContent = isUpdate ? '의뢰 내용이 수정되었습니다.' : data.duplicate ? '이미 접수된 의뢰를 확인했습니다.' : '강의 의뢰가 접수되었습니다.';
    hide('formShell'); hide('editNotice'); hide('success', false);
    hide('reviewRetryBtn', !changedRetryDraft);
    message(changedRetryDraft ? '이전 제출이 이미 저장되어 있습니다. 다시 보내면서 바꾼 내용은 아직 반영되지 않았습니다. 아래 버튼에서 변경한 내용을 확인하고 저장해 주세요.' : '', 'duplicateNotice');
    $('successTitle').focus();
    dirty = false;
    try { sessionStorage.removeItem(storageKey); } catch { /* No persistent payload is stored. */ }
    pending = null;
  }
  async function loadEdit(item) {
    hide('loading', false); hide('formShell'); hide('success'); message('', 'pageError');
    try {
      const data = await api({ action: 'get', receipt: item.receipt, key: item.key });
      edit = { receipt: item.receipt, key: item.key, revision: data.revision };
      restore(data.payload || {});
      $('consent').checked = false;
      $('overseas_consent').checked = false;
      $('submitBtn').textContent = '수정 내용 저장하기';
      $('editNotice').textContent = `접수된 의뢰를 수정하고 있습니다. ${data.editable_until ? '수정 가능 기한: ' + new Date(data.editable_until).toLocaleDateString('ko-KR') + '.' : '수정 링크는 최초 접수일부터 90일 동안 유효합니다.'}`;
      hide('editNotice', false); hide('formShell', false);
      dirty = false;
      showStep(0, false);
      return true;
    } catch (error) {
      message(error.message + ' 링크가 없거나 만료되었다면 010-9321-0093으로 문의해 주세요.', 'pageError');
      return false;
    } finally { hide('loading'); }
  }
  form.addEventListener('input', (event) => { dirty = true; if (event.target.setCustomValidity) { event.target.setCustomValidity(''); event.target.removeAttribute('aria-invalid'); } });
  $('nextBtn').addEventListener('click', () => { if (!busy && validate(step)) showStep(step + 1); });
  $('backBtn').addEventListener('click', () => { if (!busy) showStep(step - 1); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (step !== 4) { if (validate(step)) showStep(step + 1); return; }
    for (let i = 0; i < steps.length; i++) if (!validate(i)) return;
    busy = true;
    form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const originalLabel = $('submitBtn').textContent;
    $('submitBtn').textContent = '저장하는 중…';
    message('');
    let currentPayload = payload();
    try {
      const identifiers = edit || identity();
      const data = await api({ action: edit ? 'update' : 'submit', ...identifiers, expected_revision: edit?.revision, payload: currentPayload, consent: $('consent').checked, overseas_consent: $('overseas_consent').checked, consent_version: '2026-10-21-v1', website: form.elements.website.value });
      if (!data.receipt) throw new Error('접수 확인번호가 없습니다. 다시 시도하거나 전화로 문의해 주세요.');
      // A retry after an interrupted response refers to the original stored payload.
      if (data.duplicate) {
        const saved = await api({ action: 'get', receipt: data.receipt, key: identifiers.key });
        const differs = Object.keys(labels).some((key) => JSON.stringify(currentPayload[key] ?? '') !== JSON.stringify(saved.payload?.[key] ?? ''));
        changedRetryDraft = differs ? currentPayload : null;
        currentPayload = saved.payload;
        data.revision = saved.revision;
      } else changedRetryDraft = null;
      showSuccess(data, identifiers.key, currentPayload, Boolean(edit));
    } catch (error) {
      message(error.message);
      if (error.status === 409 && edit) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button secondary';
        button.textContent = '현재 입력 대신 최신 저장 내용 불러오기';
        button.addEventListener('click', () => loadEdit(edit));
        $('formError').append(button);
      }
    } finally {
      busy = false;
      form.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      $('submitBtn').textContent = originalLabel;
    }
  });
  $('copyLinkBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('privateLink').value); status('수정 링크를 복사했습니다. 본인만 볼 수 있는 곳에 보관해 주세요.'); }
    catch { $('privateLink').focus(); $('privateLink').select(); status('자동 복사가 지원되지 않습니다. 선택된 링크를 직접 복사해 주세요.'); }
  });
  $('downloadBtn').addEventListener('click', () => {
    if (!receipt) return;
    const lines = ['BCC 강의 의뢰 접수 확인서', '', '접수번호: ' + receipt.receipt, '개인 수정 링크: ' + privateUrl(receipt), '', '이 링크를 가진 사람은 의뢰 내용을 볼 수 있습니다. 본인만 보관하세요.', '수정 링크는 최초 접수일부터 90일 동안 유효합니다.', '접수는 강의 일정·비용의 확정을 의미하지 않습니다.', '문의: 010-9321-0093', '', ...groups.flatMap(([title, keys]) => ['[' + title + ']', ...keys.map((key) => labels[key] + ': ' + displayValue(key, submittedPayload?.[key])), ''])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'BCC_강의의뢰_접수확인서.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('접수 확인서에는 개인정보와 수정 링크가 들어 있습니다. 안전하게 보관해 주세요.');
  });
  $('continueEditBtn').addEventListener('click', () => { if (receipt) { history.replaceState(null, '', privateUrl(receipt)); loadEdit(receipt); } });
  const retryNotice = document.createElement('div'); retryNotice.id = 'duplicateNotice'; retryNotice.className = 'notice hidden'; retryNotice.setAttribute('role', 'status');
  $('successTitle').insertAdjacentElement('afterend', retryNotice);
  const retryButton = document.createElement('button'); retryButton.id = 'reviewRetryBtn'; retryButton.type = 'button'; retryButton.className = 'button primary hidden'; retryButton.textContent = '다시 작성한 내용 확인·저장하기';
  retryNotice.insertAdjacentElement('afterend', retryButton);
  retryButton.addEventListener('click', async () => {
    if (!receipt || !changedRetryDraft) return;
    const draft = changedRetryDraft;
    if (await loadEdit(receipt)) {
      restore(draft); changedRetryDraft = null; dirty = true; showStep(4);
      $('editNotice').textContent = '다시 작성한 내용을 불러왔습니다. 기존 접수에 반영할 내용을 확인하고 동의한 뒤 저장해 주세요.';
    }
  });
  window.addEventListener('beforeunload', (event) => { if (dirty && !busy) { event.preventDefault(); event.returnValue = ''; } });
  const hash = new URLSearchParams(location.hash.slice(1));
  buildChoices();
  if (hash.has('receipt') || hash.has('key')) {
    const ref = hash.get('receipt') || ''; const key = hash.get('key') || '';
    if (/^[0-9a-f-]{36}$/i.test(ref) && /^[A-Za-z0-9_-]{43}$/.test(key)) loadEdit({ receipt: ref, key });
    else { hide('formShell'); message('수정 링크가 올바르지 않습니다. 접수 확인서의 링크 전체를 다시 열어주세요.', 'pageError'); }
  } else showStep(0, false);
})();
