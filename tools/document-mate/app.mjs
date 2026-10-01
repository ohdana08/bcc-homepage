import { DOCUMENT_TYPES, normalizeAnalysis, createDraft, inferKind } from './model.mjs';
import { readDocument } from './files.mjs';

const $ = selector => document.querySelector(selector);
const labels = {fact:'자료에 적힌 사실',opinion:'의견·판단',prediction:'예상·기대',unknown:'미확인'};
const examples = {
  report:'9월에 학교 홍보단 활동으로 카드뉴스 4개를 만들고 가을 축제를 홍보했어요. 학교에 결과보고서를 내야 해요. 친구들의 반응은 좋았다고 느꼈지만 설문은 하지 않았어요.',
  minutes:'콘텐츠팀 주간 회의 내용을 정리해야 해요. 10월 1일 온라인으로 회의했고 참석자는 기획 담당과 디자인 담당이에요. 다음 주 뉴스레터 주제를 논의했어요. 기획 담당이 주제 후보를 정리하고, 디자인 담당이 시안을 만든 뒤 다음 회의에서 검토하기로 했어요. 다음 회의 날짜는 아직 정하지 않았어요.',
  plan:'다음 달에 동아리 신입 회원 환영 행사를 준비하려고 해요. 운영진에게 계획을 먼저 공유해야 해요. 자기소개와 팀별 교류 시간을 넣고 싶어요. 장소와 예산은 아직 정하지 않았어요.'
};
let mode='known', files=[], sourceSerial=0, sources=[], answered=[], analysis=null, draft=null, busy=false, controller=null, generation=0;
const edited = new Set();
function node(tag, text, className) { const n=document.createElement(tag); if(text!=null)n.textContent=text;if(className)n.className=className;return n; }
function button(text, fn, className='button') {const b=node('button',text,className);b.type='button';b.addEventListener('click',fn);return b;}
function showNotice(message, kind='') {const n=$('#notice');n.textContent=message;n.className=`notice ${kind}`;n.hidden=!message;}
function setBusy(value,message='') {busy=value;for(const control of document.querySelectorAll('button,input,select,textarea'))control.disabled=value;if(message)showNotice(message,'loading');}
function showStep(step) {for(const item of document.querySelectorAll('[data-step]')){if(item.dataset.step===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');}for(const name of ['input','review','draft'])$(`#${name}-panel`).hidden=name!==step;}
function focusPanel(step) {const panel=$(`#${step}-panel`);panel.scrollIntoView({behavior:'smooth',block:'start'});const heading=panel.querySelector('h2');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
function setMode(next) {
  if(busy)return;
  if(analysis && !confirm('새 시작 방식으로 돌아가면 현재 분석과 초안이 초기화됩니다. 입력한 상황과 파일은 유지할까요?'))return;
  mode=next;analysis=null;draft=null;sources=[];answered=[];edited.clear();generation++;
  for(const el of document.querySelectorAll('[data-mode]')){const on=el.dataset.mode===mode;el.classList.toggle('selected',on);el.setAttribute('aria-pressed',String(on));}
  $('#known-controls').hidden=mode!=='known';$('#unsure-controls').hidden=mode!=='unsure';showNotice('');showStep('input');
}
for(const el of document.querySelectorAll('[data-mode]'))el.addEventListener('click',()=>setMode(el.dataset.mode));
$('#situation').addEventListener('input',()=>{$('#char-count').textContent=`${$('#situation').value.length.toLocaleString()} / 8,000자`;});
for(const el of document.querySelectorAll('[data-example]'))el.addEventListener('click',()=>{if($('#situation').value.trim()&&!confirm('현재 상황 설명을 가상 예시로 바꿀까요?'))return;$('#document-type').value=el.dataset.example;$('#situation').value=examples[el.dataset.example];$('#situation').dispatchEvent(new Event('input'));showNotice('가상 예시를 넣었어요. 본인의 상황으로 바꾸거나 그대로 흐름을 체험해 보세요.');});

function renderFiles() {
  const list=$('#file-list');list.replaceChildren();
  for(const file of files) {
    const wrap=node('div',null,'file-item');const head=node('div',null,'file-heading');head.append(node('strong',file.name),button('삭제',()=>{files=files.filter(f=>f.id!==file.id);renderFiles();}));wrap.append(head);
    for(const warning of file.warnings)wrap.append(node('p',warning,'file-warning'));
    const details=node('details');details.append(node('summary',`읽은 내용 확인·수정 (${file.text.length.toLocaleString()}자)`));const input=node('textarea');input.rows=7;input.maxLength=12000;input.value=file.text;input.setAttribute('aria-label',`${file.name}에서 추출한 내용`);input.addEventListener('input',()=>{file.text=input.value;});details.append(input);wrap.append(details);list.append(wrap);
  }
}
$('#files').addEventListener('change',async event=>{
  const selected=[...event.target.files];event.target.value='';if(!selected.length)return;
  if(files.length+selected.length>3){showNotice('자료는 최대 3개까지 추가할 수 있어요. 기존 파일을 삭제한 뒤 추가해 주세요.','error');return;}
  setBusy(true,'파일을 기기에서 읽고 있어요. 아직 AI로 전송하지 않습니다.');const errors=[];
  try{for(const file of selected){try{const result=await readDocument(file);files.push({id:`file-${++sourceSerial}`,name:file.name,...result});}catch(error){errors.push(`${file.name}: ${error.message}`);}}renderFiles();}finally{setBusy(false);}
  showNotice(errors.length?errors.join('\n'):'자료를 읽었어요. 펼쳐서 빠진 항목이나 읽기 순서를 확인해 주세요.',errors.length?'error':'');
});
function initialSources() {
  const all=[];const text=$('#situation').value.trim();if(text)all.push({id:'input',name:'직접 입력한 상황',text});
  for(const [index,file] of files.entries())if(file.text.trim())all.push({id:file.id,name:(mode==='template'&&index===0?'기존 양식 (우선): ':'참고 자료: ')+file.name.slice(0,160),text:file.text.trim()});
  if(mode==='unsure'&&($('#stage').value||$('#goal').value)){const stageName=$('#stage').selectedOptions[0].textContent;all.push({id:'context',name:'선택한 목적과 단계',text:`업무 단계: ${stageName}\n문서 목적: ${$('#goal').value||'미정'}`});}
  return all;
}
function validateSources(all) {if(!all.length)throw new Error('상황을 입력하거나 읽을 수 있는 자료를 추가해 주세요.');if(all.length>16)throw new Error('추가 답변이 많아졌어요. 내용 확인 화면에서 직접 수정해 주세요.');if(all.some(s=>s.text.length>12000)||all.reduce((sum,s)=>sum+s.text.length,0)>24000)throw new Error('모든 상황·자료·답변은 합계 24,000자까지 분석할 수 있어요. 필요한 부분만 남겨주세요.');}
async function analyze(all, {reanalysis=false}={}) {
  if(busy)return false;
  if(!$('#consent').checked){showNotice('입력 내용과 추출 텍스트를 AI로 보내려면 전송 동의를 선택해 주세요.','error');($('#review-consent')||$('#consent')).focus();return false;}
  try{validateSources(all);}catch(error){showNotice(error.message,'error');return false;}
  const token=++generation;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),65000);
  setBusy(true,'자료에서 확인한 내용과 부족한 항목을 정리하고 있어요. 잠시만 기다려 주세요.');
  try {
    const response=await fetch('/api/document-mate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({action:'analyze',consent:true,startMode:mode,documentType:reanalysis?analysis.documentType:mode==='known'?$('#document-type').value:'',stage:$('#stage').value,goal:$('#goal').value,sources:all,answeredFieldIds:answered})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'분석을 완료하지 못했어요. 입력은 유지되어 있습니다. 잠시 후 다시 시도해 주세요.');
    if(!data.analysis||!Array.isArray(data.analysis.fields))throw new Error('분석 결과의 형식을 확인하지 못했어요. 다시 시도해 주세요.');
    if(token!==generation)return false;sources=all;analysis=data.analysis;draft=null;edited.clear();renderReview();showStep('review');showNotice(`자료를 정리했어요. 원문 근거와 분류를 확인해 주세요.${Number.isInteger(data.usage?.remaining)?` 오늘 이 네트워크에서 분석 ${data.usage.remaining}회 남음.`:''}`);focusPanel('review');return true;
  }catch(error){if(token===generation)showNotice(error.name==='AbortError'?'분석 시간이 길어져 중단했어요. 자료는 유지되어 있습니다. 잠시 후 다시 시도해 주세요.':error.message,'error');return false;}
  finally{clearTimeout(timeout);controller=null;setBusy(false);}
}
$('#intake-form').addEventListener('submit',event=>{event.preventDefault();if(mode==='template'&&!files.length){showNotice('기존 양식을 추가해 주세요. 양식이 없다면 다른 시작 방식을 골라주세요.','error');return;}answered=[];analyze(initialSources());});
$('#manual-start').addEventListener('click',()=>{
  if(busy)return;const type=$('#document-type').value;analysis=normalizeAnalysis({documentType:type},[]);analysis.warnings=['AI 분석 없이 기본 구조를 열었습니다. 자료 내용을 각 항목에 직접 옮겨 적어주세요.'];analysis.recommendationReason=`이 문서를 작성하려면 보통 다음 항목이 필요합니다. ${DOCUMENT_TYPES[type].label}의 기본 구조이므로 소속 기관의 양식에 맞게 수정해 주세요.`;sources=[];answered=[];edited.clear();renderReview();showStep('review');showNotice('AI 분석 없이 직접 작성하고 있어요. 상황 설명과 파일 내용은 자동으로 채우지 않습니다.');focusPanel('review');
});
function panelTitle(step,title) {const wrap=node('div',null,'panel-title');const div=node('div');div.append(node('p',step,'eyebrow'),node('h2',title));wrap.append(div);return wrap;}
function list(items) {const ul=node('ul',null,'checklist');for(const item of items)ul.append(node('li',item));return ul;}
function fieldInput(label, value, onChange, {rows=3,max=2400}={}) {const wrap=node('div',null,'field');const id=`edit-${++sourceSerial}`;const lab=node('label',label);lab.htmlFor=id;const input=node('textarea');input.id=id;input.rows=rows;input.maxLength=max;input.value=value;input.addEventListener('input',()=>onChange(input.value));wrap.append(lab,input);return wrap;}
function structureToText() {return analysis.sections.map(s=>s.heading).join('\n');}
function updateStructure(text) {
  const headings=text.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,24);if(!headings.length)return;
  const previous=analysis.sections;const next=[];
  headings.forEach((heading,i)=>{const old=previous[i];if(old)next.push({...old,heading});else {const id=`custom-${++sourceSerial}`;analysis.fields.push({id,label:heading,value:'',kind:'unknown',sourceId:'',quote:'',required:false});next.push({heading,fieldIds:[id]});}});
  // Removed headings' data remains visible in the final section, never discarded.
  const remaining=previous.slice(headings.length).flatMap(s=>s.fieldIds);if(remaining.length)next[next.length-1].fieldIds=[...new Set([...next[next.length-1].fieldIds,...remaining])];analysis.sections=next;
}
function renderReview() {
  const panel=$('#review-panel');panel.replaceChildren(panelTitle('02 / 내용 확인','제가 확인한 내용이에요'));
  panel.append(node('p',analysis.recommendationReason,'review-intro'));
  if(mode!=='template')panel.append(node('p','이 문서를 작성하려면 보통 아래 항목이 필요합니다. 기관별 기준에 맞게 항목을 수정해 주세요.','field-hint'));
  const typeRow=node('div',null,'field');const typeLabel=node('label','문서 종류 확인');typeLabel.htmlFor='review-type';const select=node('select');select.id='review-type';select.className='review-type';for(const [id,type]of Object.entries(DOCUMENT_TYPES)){const option=node('option',type.label);option.value=id;select.append(option);}select.value=analysis.documentType;select.addEventListener('change',()=>{analysis.documentType=select.value;analysis.title=DOCUMENT_TYPES[select.value].label;const oldFields=analysis.fields;const fresh=normalizeAnalysis({documentType:select.value},[]);analysis.sections=fresh.sections;analysis.fields=[...fresh.fields,...oldFields.filter(f=>f.value).map((f,i)=>({...f,id:`kept-${i}`}))];const kept=analysis.fields.filter(f=>f.id.startsWith('kept-'));if(kept.length)analysis.sections.push({heading:'자료에서 확인한 내용',fieldIds:kept.map(f=>f.id)});analysis.questions=[];renderReview();showNotice('문서 종류를 바꾸었습니다. 이미 확인된 내용은 마지막 항목에 보존했어요. 알맞은 항목으로 옮겨주세요.');});typeRow.append(typeLabel,select);panel.append(typeRow);
  panel.append(fieldInput('문서 제목',analysis.title,v=>{analysis.title=v;},{rows:1,max:200}));
  const grid=node('div',null,'review-grid');const fieldsWrap=node('div');
  for(const field of analysis.fields) {
    const card=node('div',null,'review-card');const row=node('div',null,'label-row');const label=node('label',field.label+(field.required?' · 핵심 항목':''));label.htmlFor=`field-${field.id}`;
    const kind=node('select');kind.className='kind-select';kind.setAttribute('aria-label',`${field.label} 정보 분류`);for(const [id,name]of Object.entries(labels)){const option=node('option',name);option.value=id;kind.append(option);}kind.value=field.kind;kind.addEventListener('change',()=>{field.kind=kind.value;edited.add(field.id);});row.append(label,kind);
    const value=node('textarea');value.id=`field-${field.id}`;value.rows=2;value.maxLength=2400;value.value=field.value;value.placeholder='모르는 내용은 비워 두세요. [확인 필요]로 표시합니다.';
    value.addEventListener('input',()=>{const old=card.querySelector('.source-quote summary');if(old)old.textContent='사용자 수정 · 수정 전 원문 참고';field.value=value.value;edited.add(field.id);field.kind=inferKind(value.value,field.kind);kind.value=field.kind;});card.append(row,value);
    if(field.quote){const source=sources.find(s=>s.id===field.sourceId);const evidence=node('details',null,'source-quote');evidence.append(node('summary',`원문 확인 · ${source?.name||'입력 자료'}`),node('blockquote',field.quote));card.append(evidence);}else card.append(node('p','직접 입력하는 내용은 본인이 확인한 정보로 작성해 주세요.','field-hint'));
    fieldsWrap.append(card);
  }
  const aside=node('aside',null,'review-aside');aside.append(node('h3','검토할 때 기억해 주세요'),list(analysis.warnings));const label=node('label','문서 항목 순서·이름 수정');label.htmlFor='structure';const structure=node('textarea');structure.id='structure';structure.className='structure-input';structure.rows=Math.min(10,analysis.sections.length+1);structure.value=structureToText();structure.addEventListener('change',()=>updateStructure(structure.value));aside.append(label,node('p','한 줄에 항목 하나. 이름을 바꾸면 해당 위치의 내용은 유지됩니다.','field-hint'),structure);grid.append(fieldsWrap,aside);panel.append(grid);
  const questions=analysis.questions.filter(q=>!answered.includes(q.fieldId));
  if(questions.length){const box=node('div',null,'question-card');box.append(node('h3',`초안을 위해 ${questions.length}가지만 더 확인할게요`),node('p','답하기 어려운 항목은 건너뛰어도 괜찮아요. 빈칸은 [확인 필요]로 남깁니다.'));
    for(const q of questions){const wrap=fieldInput(q.question,'',()=>{}, {rows:2,max:1200});wrap.querySelector('textarea').dataset.questionId=q.fieldId;box.append(wrap);}
    const actions=node('div',null,'actions');actions.append(button('답변 반영하기',async()=>{
      if(busy)return;
      const inputs=[...box.querySelectorAll('[data-question-id]')];const answeredNow=inputs.filter(el=>el.value.trim());
      if(!answeredNow.length){showNotice('추가 답변을 입력하거나, 아래에서 현재 내용으로 초안을 만들어 주세요.');return;}
      // Direct answers update their reviewed fields, then optional AI reanalysis
      // can reorganize new evidence without losing the user's work.
      for(const el of answeredNow){const f=analysis.fields.find(f=>f.id===el.dataset.questionId);if(f){f.value=el.value.trim();f.kind=inferKind(f.value);f.sourceId='';f.quote='';edited.add(f.id);}answered.push(el.dataset.questionId);}
      analysis.questions=analysis.questions.filter(q=>!answered.includes(q.fieldId));renderReview();showNotice('답변을 반영했어요. 사실·의견·예상 분류를 확인한 뒤 초안을 만들어 주세요.');
    },'button primary'),button('질문 건너뛰기',()=>{answered.push(...questions.map(q=>q.fieldId));analysis.questions=[];renderReview();showNotice('비어 있는 항목은 초안에 [확인 필요]로 남겨둘게요.');}));box.append(actions);panel.append(box);
  }
  const addition=fieldInput('새 자료·수정 요청을 더 알려주기 (선택)','',()=>{}, {rows:2,max:4000});addition.querySelector('textarea').id='additional';addition.querySelector('label').htmlFor='additional';addition.querySelector('textarea').placeholder='예: 참석자는 20명으로 정정해 주세요. 개선방안에는 행사 안내를 일주일 앞당길 계획을 추가해 주세요.';panel.append(addition);
  const consentLabel=node('label',null,'consent');const consent=node('input');consent.type='checkbox';consent.id='review-consent';consent.checked=$('#consent').checked;consent.addEventListener('change',()=>{$('#consent').checked=consent.checked;});consentLabel.append(consent,node('span','추가 AI 분석 시 입력 내용·추출 텍스트를 BCC 서버를 거쳐 Anthropic으로 전송하는 데 동의합니다. 민감정보를 제외해 주세요.'));panel.append(consentLabel);
  const actions=node('div',null,'actions');actions.append(button('자료로 돌아가기',()=>{showStep('input');showNotice('상황과 파일을 고쳐 다시 분석할 수 있어요. 다시 분석하면 현재 확인 화면을 대체합니다.');focusPanel('input');}),button('추가 내용 AI로 재분석',async()=>{
    const extra=$('#additional').value.trim();if(!extra){showNotice('추가할 자료나 수정할 내용을 입력해 주세요.','error');return;}
    const additions=[];for(const id of edited){const f=analysis.fields.find(f=>f.id===id);if(f?.value.trim())additions.push(`${f.label} 정정·확인: ${f.value}`);}
    const newSources=[...sources];if(additions.length)newSources.push({id:`edit-${++sourceSerial}`,name:'사용자가 확인한 수정 내용',text:additions.join('\n')});newSources.push({id:`answer-${++sourceSerial}`,name:'추가 자료·수정 요청',text:extra});await analyze(newSources,{reanalysis:true});
  }),button('내용 확인했고, 초안 만들기 →',()=>{updateStructure($('#structure').value);draft=createDraft(analysis);renderDraft();showStep('draft');showNotice('초안이 준비되었어요. 문장을 직접 다듬고 빠진 정보를 확인해 주세요.');focusPanel('draft');},'button primary'));panel.append(actions);
}
function currentDraft() {
  if(!draft)return null;
  // Recompute unresolved placeholders from the edited document, not stale fields.
  return {...draft,unsupportedExpressions:draft.sections.flatMap(section=>section.content.split('\n').filter(line=>inferKind(line)==='opinion'||line.includes('사용자 의견:')).map(line=>`${section.heading}: ${line} — 객관적 근거를 확인해 주세요.`)),unknowns:draft.sections.filter(s=>/\[(확인 필요|미확인|협의 필요|자료 없음)\]/.test(s.content)||!s.content.trim()).map(s=>s.heading)};
}
function saveBlob(blob,extension) {const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=`${(draft.title||'문서초안').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,70)}_검토용.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportDraft(kind) {
  if(busy)return;setBusy(true);
  try{const {draftMarkdown,draftDocx}=await import('./vendor/export.js');const current=currentDraft();if(kind==='copy'){await navigator.clipboard.writeText(draftMarkdown(current));showNotice('현재 수정한 초안과 검토 목록을 복사했어요.');}else if(kind==='md'){saveBlob(new Blob([draftMarkdown(current)],{type:'text/markdown;charset=utf-8'}),'md');showNotice('현재 초안의 Markdown 다운로드를 시작했어요.');}else {saveBlob(await draftDocx(current),'docx');showNotice('현재 초안의 Word 다운로드를 시작했어요.');}}
  catch(error){showNotice(kind==='copy'?'복사 권한을 얻지 못했어요. Markdown 또는 Word로 내려받아 주세요.':'문서 다운로드를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.','error');}finally{setBusy(false);}
}
function renderDraft() {
  const panel=$('#draft-panel');panel.replaceChildren(panelTitle('03 / 초안과 검토','읽는 사람에게 건네기 전, 한 번 더'));
  panel.append(node('p','문장을 직접 고치면 복사와 다운로드에도 그대로 반영됩니다. 의견·예상 표시와 미확인 항목을 확인해 주세요.','draft-disclaimer'));
  const toolbar=node('div',null,'export-toolbar');toolbar.append(button('초안 복사',()=>exportDraft('copy')),button('Markdown',()=>exportDraft('md')),button('Word 내려받기 ↓',()=>exportDraft('docx'),'button primary'));panel.append(toolbar);
  const layout=node('div',null,'draft-layout');const page=node('div',null,'draft-page');const title=node('input');title.type='text';title.value=draft.title;title.maxLength=200;title.setAttribute('aria-label','초안 제목');title.addEventListener('input',()=>{draft.title=title.value;});page.append(title);
  for(const [i,section]of draft.sections.entries()){const field=fieldInput(section.heading,section.content,value=>{section.content=value;updateChecklist();},{rows:Math.min(12,Math.max(3,section.content.split('\n').length+1)),max:12000});field.querySelector('textarea').dataset.draftSection=String(i);page.append(field);}
  const aside=node('aside',null,'review-aside');aside.id='draft-checklist';layout.append(page,aside);panel.append(layout);updateChecklist();
  const actions=node('div',null,'actions');actions.append(button('내용 확인·추가 질문으로 돌아가기',()=>{if(!confirm('내용 확인으로 돌아간 뒤 초안을 다시 만들면, 이 화면에서 직접 고친 문장은 새 초안으로 대체됩니다. 먼저 다운로드할 수 있어요. 돌아갈까요?'))return;showStep('review');focusPanel('review');}),button('새 문서 시작',()=>{if(!confirm('현재 작성 내용과 파일을 모두 비우고 새로 시작할까요? 다운로드한 파일은 유지됩니다.'))return;generation++;controller?.abort();files=[];sources=[];answered=[];analysis=null;draft=null;edited.clear();$('#intake-form').reset();$('#situation').dispatchEvent(new Event('input'));renderFiles();mode='known';setMode('known');showNotice('새 문서를 시작할 준비가 되었어요.');focusPanel('input');}));panel.append(actions);
}
function updateChecklist() {const aside=$('#draft-checklist');if(!aside)return;const current=currentDraft();aside.replaceChildren(node('h3','추가 확인 필요'),list(current.unknowns.length?current.unknowns:['빈칸 표시는 없습니다. 사실과 수치는 원자료와 대조해 주세요.']),node('h3','근거를 확인할 표현'),list(current.unsupportedExpressions.length?current.unsupportedExpressions:['별도 표시 없음. 표현의 근거를 직접 확인해 주세요.']),node('h3','첨부하면 좋은 자료'),list(current.suggestedAttachments),node('p','기관별 양식과 개인정보, 수치·날짜를 최종 확인한 뒤 제출하세요.','draft-disclaimer'));}
window.addEventListener('beforeunload',event=>{if(analysis||files.length||$('#situation').value.trim()){event.preventDefault();event.returnValue='';}});
