export const SCHEMA = 'ai_experience_v2';
export const MAX_FILE_BYTES = 1024 * 1024;
export const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXCLUSIVE = new Set(['none', 'undecided', 'unsure']);
export function toggleChoice(values, value, max = 20) {
  const current = Array.isArray(values) ? values : [];
  if (current.includes(value)) return current.filter(item => item !== value);
  if (EXCLUSIVE.has(value)) return [value];
  const next = current.filter(item => !EXCLUSIVE.has(item));
  if (next.length >= max) throw new Error(`${max}개까지 선택할 수 있어요.`);
  return [...next, value];
}
export function validShareUrl(value) {
  if (!String(value || '').trim()) return '';
  const raw = String(value).trim();
  if (raw.length > 2000 || /[\u0000-\u0020\u007f]/.test(raw)) throw new Error('작품 링크를 확인해 주세요.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('http 또는 https로 시작하는 링크를 넣어주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('http 또는 https로 시작하는 공개 가능한 링크만 넣어주세요.');
  return url.href;
}
export function isAmbiguousSubmission(error) {
  return !error.status || error.status >= 500;
}
export function cardText(card, survey) {
  const parts = ['나의 AI 경험 카드', survey.institution_label, survey.title];
  const fields = [['experience_tasks', '해본 것'], ['creation_process', '만들어본 과정'], ['desired_work', '만들고 싶은 것'], ['support_needs', '필요한 도움']];
  for (const [id, label] of fields) parts.push(`\n${label}\n${(card[id] || []).join(' · ') || '제작 경험 질문 건너뜀'}${card.others?.[id] ? '\n' + card.others[id] : ''}`);
  if (card.tools_detail) parts.push(`\n사용해본 도구\n${card.tools_detail}`);
  if (card.support_detail) parts.push(`\n더 알고 싶은 내용 · AI로 잘 안되는 업무\n${card.support_detail}`);
  if (card.desired_detail) parts.push(`\n나의 생각\n${card.desired_detail}`);
  const shared = [card.portfolio?.file?.name, card.portfolio?.url].filter(Boolean);
  parts.push(`\n공유한 결과물\n${shared.length ? shared.join('\n') : '공유하지 않음'}`);
  parts.push('\n본인이 알려주신 경험과 관심을 정리한 카드입니다. 능력 평가나 등급은 아닙니다.');
  return parts.filter(Boolean).join('\n');
}

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (location.hostname === 'ohdana08.github.io') {
    location.replace('https://bccconsulting.kr/tools/training-needs/' + location.search + location.hash);
  } else {
    const params = new URLSearchParams(location.search);
    const state = { form: String(params.get('form') || params.get('code') || '').trim().toUpperCase(), survey: null, questions: [], answers: {schema_version:SCHEMA, others:{}}, file: null, reading: false, submitting: false, pending: null, id: crypto.randomUUID(), card: null, fileVersion: 0 };
    const api = async (action, payload = {}) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch('/api/cardnews-generate', {method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal, body:JSON.stringify({engine:'training_needs_public', action, ...payload})});
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { const error = new Error(data.error || '잠시 후 다시 시도해 주세요.'); error.status = response.status; throw error; }
        return data;
      } finally { clearTimeout(timeout); }
    };
    const visible = (id, show) => { $(id).hidden = !show; };
    const question = id => state.questions.find(q => q.id === id);
    const setError = (id, message) => { const node = $(`error-${id}`); if(node) { node.textContent = message; node.hidden = !message; } };
    function optionsHtml(q) {
      return `<div class="options" id="options-${esc(q.id)}">${(q.options || []).map(([value,label]) => `<label class="option"><input type="checkbox" name="${esc(q.id)}" value="${esc(value)}"><span>${esc(label)}</span></label>`).join('')}</div><label class="field-label" id="other-label-${esc(q.id)}" for="other-${esc(q.id)}" hidden>기타 내용을 알려주세요</label><input class="text-input" id="other-${esc(q.id)}" maxlength="240" data-other="${esc(q.id)}" aria-label="${esc(q.title)} 기타 내용" hidden>`;
    }
    function renderForm() {
      $('surveyInstitution').textContent = state.survey.institution_label;
      $('surveyTitle').textContent = state.survey.title;
      $('surveyMeta').textContent = [state.survey.audience_label, state.survey.lecture_date && `강의일 ${state.survey.lecture_date}`, state.survey.response_deadline && `응답 마감 ${state.survey.response_deadline}`].filter(Boolean).join(' · ');
      visible('sampleNotice', Boolean(state.survey.is_sample));
      document.title = `${state.survey.institution_label} · 나의 AI 경험 카드 | BCC`;
      $('questionMount').innerHTML = state.questions.map((q,index) => {
        let body = q.type === 'portfolio' ? `<div class="upload-area"><label for="portfolioFile" class="upload-label">파일 또는 화면 캡처 1개 <span class="optional">선택</span></label><input id="portfolioFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><p>JPG · PNG · WebP · PDF. 큰 이미지는 1MB 이하로 줄여 전달합니다. PDF는 최대 1MB이며, 영상은 링크로 공유해 주세요.</p><p id="fileStatus" class="file-status" role="status"></p><button id="removeFile" class="text-button" type="button" hidden>선택한 파일 빼기</button></div><label class="field-label" for="portfolioUrl">또는 작품 링크 <span class="optional">선택</span></label><input id="portfolioUrl" class="text-input" type="url" maxlength="2000" inputmode="url" placeholder="https://" aria-describedby="portfolioHelp"><p id="portfolioHelp" class="help" style="margin-top:9px">공유할 자료가 없거나 공개하기 어려우면 이 항목은 비워두세요. 파일·링크에 이름, 연락처, 얼굴, 회사 기밀이 들어 있지 않은지 확인해 주세요.</p><label id="consentLabel" class="consent-label" hidden><input id="portfolioConsent" type="checkbox"><span>이 자료를 공유할 권한이 있으며, 해당 수업 준비를 위해 관리자에게 전달하는 데 동의합니다. 자료를 공유하지 않아도 설문에 참여할 수 있습니다.</span></label>` : optionsHtml(q);
        if(q.id === 'experience_tasks') body += '<details class="optional-detail"><summary>사용해본 AI 도구도 알려주고 싶어요 <span class="optional">선택</span></summary><label class="field-label" for="toolsDetail">도구 이름과 이용 방식</label><input id="toolsDetail" class="text-input" maxlength="160" placeholder="예: ChatGPT 무료, Gemini 유료"></details>';
        if(q.id === 'creation_process') body = `<div id="processSkipped" class="skipped" hidden>아직 경험이 없어도 괜찮아요. 이 질문은 건너뛸게요.</div><div id="processChoices">${body}</div>`;
        if(q.id === 'support_needs') body += '<label class="field-label" for="supportDetail">더 알고 싶은 내용이나 AI로 잘 안되는 업무가 있나요? <span class="optional">선택</span></label><textarea id="supportDetail" class="text-input" maxlength="800" rows="3" placeholder="예: AI로 홍보 이미지를 만들 때 글자가 자꾸 틀려요. 회의록을 정리하는 방법도 배우고 싶어요."></textarea>';
        if(q.id === 'desired_work') body += '<label class="field-label" for="desiredDetail">하고 싶은 일을 한 문장으로 <span class="optional">선택</span></label><textarea id="desiredDetail" class="text-input" maxlength="400" rows="2" placeholder="예: 우리 가게를 소개하는 짧은 영상을 만들고 싶어요."></textarea>';
        return `<fieldset class="question" id="section-${esc(q.id)}"><legend><span class="number" aria-hidden="true">0${index+1}</span><span class="q-title">${esc(q.title)}${q.required === false ? '<span class="optional">선택</span>' : ''}</span></legend><p class="help">${esc(q.help || '')}</p>${body}<p id="error-${esc(q.id)}" class="question-error" role="alert" hidden></p></fieldset>`;
      }).join('');
      $('questionMount').addEventListener('change', onChange);
      $('portfolioUrl').addEventListener('input', syncConsent);
      $('removeFile').addEventListener('click', clearFile);
      visible('accessView', false); visible('surveyView', true);
    }
    function syncChoices(id) {
      const selected = state.answers[id] || [];
      document.querySelectorAll(`input[name="${id}"]`).forEach(input => { input.checked = selected.includes(input.value); });
      visible(`other-${id}`, selected.includes('other')); visible(`other-label-${id}`, selected.includes('other'));
      if (id === 'experience_tasks') {
        const skipped = selected.includes('none');
        visible('processSkipped', skipped); visible('processChoices', !skipped);
        $('processChoices').querySelectorAll('input').forEach(input => {input.disabled = skipped;});
        if (skipped) { state.answers.creation_process = []; syncChoices('creation_process'); setError('creation_process', ''); }
      }
    }
    function onChange(event) {
      const input = event.target;
      if(input.id === 'portfolioFile') { readFile(); return; }
      const q = question(input.name);
      if(!q || q.type !== 'multi') return;
      try { state.answers[q.id] = toggleChoice(state.answers[q.id],input.value,q.max); setError(q.id,''); }
      catch(error) { setError(q.id,error.message); }
      syncChoices(q.id);
    }
    function syncConsent() { const hasShare = Boolean(state.file || $('portfolioUrl').value.trim()); visible('consentLabel', hasShare); if(!hasShare) $('portfolioConsent').checked = false; }
    function clearFile() { state.fileVersion++; state.reading=false; $('submitButton').disabled=false; state.file=null; $('portfolioFile').value=''; $('fileStatus').textContent=''; visible('removeFile',false); setError('portfolio',''); syncConsent(); }
    async function fitImage(file) {
      if(file.size<=MAX_FILE_BYTES) return {file,adjusted:false};
      if(file.type==='application/pdf') throw new Error('PDF는 1MB 이하로 선택하거나 작품 링크로 공유해 주세요.');
      if(file.size>20*MAX_FILE_BYTES) throw new Error('이미지는 20MB 이하로 선택하거나 작품 링크로 공유해 주세요.');
      const source=URL.createObjectURL(file);
      try {
        const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('이미지를 읽지 못했어요. 다른 이미지나 링크를 선택해 주세요.'));img.src=source;});
        let edge=1800;
        for(let attempt=0;attempt<4;attempt++) {
          const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
          const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          const context=canvas.getContext('2d');if(!context) throw new Error('이미지를 줄이지 못했습니다. 작은 파일이나 링크로 공유해 주세요.');
          context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
          if(blob&&blob.size<=MAX_FILE_BYTES) return {file:new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}),adjusted:true};
          edge=Math.round(edge*0.7);
        }
        throw new Error('이미지를 1MB 이하로 줄이지 못했습니다. 작은 파일이나 링크로 공유해 주세요.');
      } finally {URL.revokeObjectURL(source);}
    }
    async function readFile() {
      const original=$('portfolioFile').files[0];
      const version=++state.fileVersion;
      state.file=null;setError('portfolio','');visible('removeFile',false);syncConsent();
      if(!original) {clearFile();return;}
      if(!FILE_TYPES.includes(original.type)||!original.size) {clearFile();setError('portfolio','JPG·PNG·WebP 이미지 또는 PDF 파일을 선택해 주세요.');return;}
      state.reading=true;$('submitButton').disabled=true;$('fileStatus').textContent='파일을 준비하고 있어요…';
      try {
        const {file,adjusted}=await fitImage(original);
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('파일을 읽지 못했습니다. 다시 선택해 주세요.'));reader.readAsDataURL(file);});
        if(version!==state.fileVersion)return;
        state.file={name:file.name,mime_type:file.type,data_base64:data};
        $('fileStatus').textContent=`${file.name} · ${Math.ceil(file.size/1024)}KB · ${adjusted?'큰 이미지를 JPG로 줄였습니다. ':''}제출할 때 함께 전달됩니다.`;
        visible('removeFile',true);
      } catch(error) {
        if(version!==state.fileVersion)return;
        state.file=null;$('portfolioFile').value='';$('fileStatus').textContent='';setError('portfolio',error.message);
      } finally {
        if(version===state.fileVersion){state.reading=false;$('submitButton').disabled=false;syncConsent();}
      }
    }
    function collectAnswers() {
      const answers={schema_version:SCHEMA,others:{}};
      for(const q of state.questions.filter(q=>q.type==='multi')) {
        const skipped = q.id==='creation_process' && (state.answers.experience_tasks || []).includes('none');
        const values = skipped ? [] : (state.answers[q.id] || []);
        answers[q.id]=values;
        if(values.includes('other')) answers.others[q.id]=$(`other-${q.id}`).value.trim();
      }
      answers.support_detail=$('supportDetail').value.trim();answers.tools_detail=$('toolsDetail').value.trim();answers.desired_detail=$('desiredDetail').value.trim();
      answers.portfolio={url:$('portfolioUrl').value.trim(),consent:$('portfolioConsent').checked,...(state.file ? {file:state.file} : {})};
      return answers;
    }
    function validate(answers) {
      let first=null;
      for(const q of state.questions.filter(q=>q.type==='multi')) {
        setError(q.id,'');
        if(q.id==='creation_process' && answers.experience_tasks.includes('none')) continue;
        const values=answers[q.id];
        const message=!values.length ? '해당하는 항목을 골라주세요.' : values.includes('other') && !answers.others[q.id] ? '기타 내용을 적어주세요.' : '';
        if(message) {setError(q.id,message);first ||= q.id;}
      }
      setError('portfolio','');
      try { validShareUrl(answers.portfolio.url);if((answers.portfolio.url||answers.portfolio.file)&&!answers.portfolio.consent) throw new Error('작품 공유 안내를 확인하고 동의해 주세요. 자료 없이 제출해도 괜찮아요.'); }
      catch(error) {setError('portfolio',error.message);first ||= 'portfolio';}
      if(first) {const section=$(`section-${first}`);section.scrollIntoView({block:'center'});section.querySelector('input:not([hidden]),textarea')?.focus({preventScroll:true});return false;}
      return true;
    }
    function freeze(frozen) {
      document.querySelectorAll('#experienceForm fieldset').forEach(fieldset=>{fieldset.disabled=frozen;});
      if(!frozen) syncChoices('experience_tasks');
    }
    async function submit(event) {
      event.preventDefault();if(state.submitting||state.reading||state.card) return;
      if(!state.pending) { const answers=collectAnswers();if(!validate(answers)) return;state.pending={form:state.form,schema_version:SCHEMA,answers,idempotency_key:state.id,website:$('website').value}; }
      state.submitting=true;freeze(true);$('submitButton').disabled=true;$('submitButton').textContent='전달하고 있어요…';$('submitStatus').textContent='';
      try {
        const result=await api('submit',state.pending);
        if(!result.ok || !result.card) throw new Error('저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.');
        state.card=result.card;state.pending=null;state.file=null;renderCard();
      } catch(error) {
        const retrySame=isAmbiguousSubmission(error);
        if(!retrySame) {state.pending=null;freeze(false);}
        $('submitStatus').textContent=retrySame?'전달 결과를 아직 확인하지 못했어요. 입력 내용은 유지됩니다. 아래 버튼으로 같은 내용을 다시 확인해 주세요.':error.message;
        $('submitButton').textContent=retrySame?'같은 내용으로 다시 확인하기':'수업에 전달하고 내 카드 보기 ↗';
      } finally {state.submitting=false;$('submitButton').disabled=false;}
    }
    function renderCard() {
      const card=state.card;
      const labels=[['experience_tasks','해본 것'],['creation_process','만들어본 과정'],['desired_work','만들고 싶은 것'],['support_needs','필요한 도움']];
      const items=labels.map(([id,label])=>[label,(card[id]||[]).join(' · ') || '제작 경험 질문 건너뜀',card.others?.[id]]);
      if(card.tools_detail)items.push(['사용해본 도구',card.tools_detail]);
      if(card.support_detail)items.push(['더 알고 싶은 내용 · AI로 잘 안되는 업무',card.support_detail]);
      if(card.desired_detail)items.push(['나의 생각',card.desired_detail]);
      const shared=[card.portfolio?.file?.name,card.portfolio?.url].filter(Boolean);
      items.push(['공유한 결과물',shared.join('\n')||'공유하지 않음']);
      $('experienceCard').innerHTML=`<div class="card-top"><h3>나의 AI 경험 카드</h3><span>BCC EXPERIENCE</span></div><p class="card-course">${esc(state.survey.institution_label)}<br>${esc(state.survey.title)}</p><dl>${items.map(([label,value,detail])=>`<div class="card-item"><dt>${esc(label)}</dt><dd>${esc(value)}${detail ? '\n'+esc(detail):''}</dd></div>`).join('')}</dl>`;
      visible('surveyView',false);visible('doneView',true);$('experienceForm').reset();$('questionMount').replaceChildren();state.answers={};
      $('doneView').focus();$('doneView').scrollIntoView({block:'start'});
    }
    $('experienceForm').addEventListener('submit',submit);
    $('downloadCard').addEventListener('click',()=>{if(!state.card)return;const blob=new Blob(['\ufeff'+cardText(state.card,state.survey)],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='나의-AI-경험-카드.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    $('printCard').addEventListener('click',()=>window.print());
    async function load() {
      visible('retryLoad',false);$('accessStatus').textContent='';
      if(!state.form) { $('accessTitle').textContent='담당자가 보내드린 전용 링크로 시작해 주세요.';$('accessDescription').textContent='기관과 강의마다 응답을 따로 모읍니다. 교육 담당자는 관리자에서 전용 링크를 만들 수 있어요.';visible('accessActions',true);return; }
      try {
        const data=await api('get',{form:state.form});state.survey=data.survey;state.questions=data.questions||[];
        if(!data.survey?.is_open) { $('accessTitle').textContent='수요조사가 마감되었습니다.';$('accessDescription').textContent='응답해 주셔서 감사합니다. 참여 일정은 기관 담당자에게 확인해 주세요.';return; }
        if(data.schema_version!==SCHEMA || state.questions.length!==5) throw new Error('새 설문을 준비하고 있습니다. 잠시 후 다시 열어주세요.');
        renderForm();
      } catch(error) { $('accessTitle').textContent='설문을 열지 못했어요.';$('accessDescription').textContent='담당자가 보내드린 링크와 인터넷 연결을 확인해 주세요.';$('accessStatus').textContent=error.message;visible('retryLoad',true); }
    }
    $('retryLoad').addEventListener('click',load);load();
  }
}
