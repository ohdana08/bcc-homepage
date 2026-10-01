import { DOCUMENT_TYPES, normalizeAnalysis, createDraft, inferKind } from './model.mjs';
import { readDocument } from './files.mjs';

const $ = selector => document.querySelector(selector);
const labels = {fact:'자료에 적힌 사실',opinion:'의견·판단',prediction:'예상·기대',unknown:'미확인'};
const examples = {
  cooperation:'각 학과 사무실에 홍보물품 수령을 요청하는 공문이 필요해요. 물품을 배부하려는 계획이고 목적은 물품 수령 협조예요. 2026년 10월 8일 14:00부터 17:00까지 학생회관 1층에서 학과별 안내책자 30부를 받아가도록 요청하려고 해요. 별도 관련 공문이나 법적근거는 없어요. 붙임도 없어요.',
  reply:'학생지원과-1234(2026. 9. 25.) 「홍보물품 수요 조사」 요청에 회신하려고 해요. 우리 학과의 안내책자 신청 수량은 30부예요. 수령 담당자는 아직 정하지 않았고 정해지면 별도로 알리려고 해요. 학생지원과에 이 내용을 회신하는 공문을 써주세요. 붙임은 없어요.',
  report:'9월에 학교 홍보단 활동으로 카드뉴스 4개를 만들고 가을 축제를 홍보했어요. 학교에 결과보고서를 내야 해요. 친구들의 반응은 좋았다고 느꼈지만 설문은 하지 않았어요.',
  minutes:'콘텐츠팀 주간 회의 내용을 정리해야 해요. 10월 1일 온라인으로 회의했고 참석자는 기획 담당과 디자인 담당이에요. 다음 주 뉴스레터 주제를 논의했어요. 기획 담당이 주제 후보를 정리하고, 디자인 담당이 시안을 만든 뒤 다음 회의에서 검토하기로 했어요. 다음 회의 날짜는 아직 정하지 않았어요.',
  plan:'다음 달에 동아리 신입 회원 환영 행사를 준비하려고 해요. 운영진에게 계획을 먼저 공유해야 해요. 자기소개와 팀별 교류 시간을 넣고 싶어요. 장소와 예산은 아직 정하지 않았어요.'
};
let mode='known', files=[], sourceSerial=0, sources=[], answered=[], analysis=null, draft=null, busy=false, controller=null, generation=0;
let manual=false;
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
  mode=next;analysis=null;draft=null;sources=[];answered=[];edited.clear();manual=false;generation++;
  for(const el of document.querySelectorAll('[data-mode]')){const on=el.dataset.mode===mode;el.classList.toggle('selected',on);el.setAttribute('aria-pressed',String(on));}
  $('#known-controls').hidden=mode!=='known';$('#unsure-controls').hidden=mode!=='unsure';showNotice('');showStep('input');
}
for(const el of document.querySelectorAll('[data-mode]'))el.addEventListener('click',()=>setMode(el.dataset.mode));
$('#basis-status').addEventListener('change',()=>{$('#basis-details').hidden=$('#basis-status').value==='none';});
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
  const context=[];
  if($('#recipient').value.trim())context.push(`수신자: ${$('#recipient').value.trim()}`);
  if($('#purpose').value.trim())context.push(`문서의 목적: ${$('#purpose').value.trim()}`);
  if($('#basis-status').value==='none')context.push('관련 근거: 별도 선행 공문이나 법령 근거 없이 자체 요청·작성함.');
  else if($('#basis-text').value.trim())context.push(`관련 근거와 관계: ${$('#basis-text').value.trim()}`);
  if(context.length)all.push({id:'intake-context',name:'사용자가 입력한 수신·목적·근거',text:context.join('\n')});
  if(mode==='unsure'&&($('#stage').value||$('#goal').value)){const stageName=$('#stage').selectedOptions[0].textContent;all.push({id:'context',name:'선택한 목적과 단계',text:`업무 단계: ${stageName}\n문서 목적: ${$('#goal').value||'미정'}`});}
  return all;
}
function validateSources(all) {if(!all.length)throw new Error('상황을 입력하거나 읽을 수 있는 자료를 추가해 주세요.');if(all.length>16)throw new Error('추가 답변이 많아졌어요. 내용 확인 화면에서 직접 수정해 주세요.');if(all.some(s=>s.text.length>12000)||all.reduce((sum,s)=>sum+s.text.length,0)>24000)throw new Error('모든 상황·자료·답변은 합계 24,000자까지 분석할 수 있어요. 필요한 부분만 남겨주세요.');}
async function analyze(all, {reanalysis=false,documentType,preserveReviewed=false}={}) {
  if(busy)return false;
  if(!$('#consent').checked){showNotice('입력 내용과 추출 텍스트를 AI로 보내려면 전송 동의를 선택해 주세요.','error');($('#review-consent')||$('#consent')).focus();return false;}
  try{validateSources(all);}catch(error){showNotice(error.message,'error');return false;}
  const overrides=preserveReviewed?analysis.fields.filter(isDirectEdit).map(f=>({...f})):[];
  const reviewedEdits=reanalysis&&analysis?analysis.fields.filter(isDirectEdit).map(({id,label,value,kind,originalValue,sourceId,quote})=>({id,label,value,kind,originalValue:originalValue??'',sourceId,quote})):[];
  const token=++generation;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),65000);
  setBusy(true,'자료에서 확인한 내용과 부족한 항목을 정리하고 있어요. 잠시만 기다려 주세요.');
  try {
    const response=await fetch('/api/document-mate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({action:'analyze',consent:true,startMode:mode,documentType:documentType??(reanalysis?analysis.documentType:mode==='known'?$('#document-type').value:''),stage:$('#stage').value,goal:$('#purpose').value||$('#goal').value,basisStatus:$('#basis-status').value,sources:all,answeredFieldIds:answered,reviewedEdits})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'분석을 완료하지 못했어요. 입력은 유지되어 있습니다. 잠시 후 다시 시도해 주세요.');
    if(!data.analysis||!Array.isArray(data.analysis.fields))throw new Error('분석 결과의 형식을 확인하지 못했어요. 다시 시도해 주세요.');
    if(token!==generation)return false;sources=all;analysis=data.analysis;if(!reanalysis)draft=null;manual=false;edited.clear();
    for(const previous of overrides){let field=analysis.fields.find(f=>f.id===previous.id)||analysis.fields.find(f=>f.label.replace(/\s/g,'')===previous.label.replace(/\s/g,''));if(field){Object.assign(field,{value:previous.value,kind:previous.kind,originalValue:previous.originalValue??'',sourceId:previous.sourceId||'',quote:previous.quote||''});}else{field={...previous,id:`confirmed-${++sourceSerial}`};analysis.fields.push(field);let section=analysis.sections.find(s=>s.heading==='직접 확인한 내용');if(!section){section={heading:'직접 확인한 내용',fieldIds:[]};analysis.sections.push(section);}section.fieldIds.push(field.id);}edited.add(field.id);}
    for(const field of analysis.fields)if(field.originalValue===undefined)field.originalValue=field.value;
    for(const id of analysis.userEditedFieldIds||[])if(analysis.fields.some(field=>field.id===id))edited.add(id);
    renderReview();showStep('review');showNotice(`자료를 정리했어요. 확인한 내용을 바탕으로 다음 단계에서 AI가 문서를 작성합니다.${Number.isInteger(data.usage?.remaining)?` 오늘 이 네트워크에서 AI ${data.usage.remaining}회 남음.`:''}`);focusPanel('review');return true;
  }catch(error){if(token===generation)showNotice(error.name==='AbortError'?'분석 시간이 길어져 중단했어요. 자료는 유지되어 있습니다. 잠시 후 다시 시도해 주세요.':error.message,'error');return false;}
  finally{clearTimeout(timeout);controller=null;setBusy(false);}
}
$('#intake-form').addEventListener('submit',event=>{event.preventDefault();if(mode==='template'&&!files.length){showNotice('기존 양식을 추가해 주세요. 양식이 없다면 다른 시작 방식을 골라주세요.','error');return;}answered=[];analyze(initialSources());});
$('#manual-start').addEventListener('click',()=>{
  if(busy)return;manual=true;const type=$('#document-type').value;analysis=normalizeAnalysis({documentType:type},[]);analysis.warnings=['기본 양식에 직접 작성하는 모드입니다. AI가 문장을 작성하거나 검토하지 않습니다.'];analysis.recommendationReason=`${DOCUMENT_TYPES[type].label} 기본 양식입니다. 직접 작성하거나 AI 작성으로 이어갈 수 있습니다.`;sources=initialSources();answered=[];edited.clear();renderReview();showStep('review');showNotice('직접 작성 모드입니다. 입력한 자료는 보존되며 자동으로 문장에 반영되지 않습니다.');focusPanel('review');
});
function panelTitle(step,title) {const wrap=node('div',null,'panel-title');const div=node('div');div.append(node('p',step,'eyebrow'),node('h2',title));wrap.append(div);return wrap;}
function list(items) {const ul=node('ul',null,'checklist');for(const item of items)ul.append(node('li',item));return ul;}
function fieldInput(label, value, onChange, {rows=3,max=2400}={}) {const wrap=node('div',null,'field');const id=`edit-${++sourceSerial}`;const lab=node('label',label);lab.htmlFor=id;const input=node('textarea');input.id=id;input.rows=rows;input.maxLength=max;input.value=value;input.addEventListener('input',()=>onChange(input.value));wrap.append(lab,input);return wrap;}
function isDirectEdit(field) {return edited.has(field.id)&&!(field.derivedFromEditIds?.length&&field.value===field.derivedValue);}
function rememberOriginal(field) {if(field.originalValue===undefined)field.originalValue=field.value;delete field.derivedFromEditIds;delete field.derivedValue;edited.add(field.id);}
function structureToText() {return analysis.sections.map(s=>s.heading).join('\n');}
function updateStructure(text) {
  const headings=text.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,24);if(!headings.length)return;
  const previous=analysis.sections;const next=[];
  headings.forEach((heading,i)=>{const old=previous[i];if(old)next.push({...old,heading});else {const id=`custom-${++sourceSerial}`;analysis.fields.push({id,label:heading,value:'',kind:'unknown',sourceId:'',quote:'',required:false});next.push({heading,fieldIds:[id]});}});
  // Removed headings' data remains visible in the final section, never discarded.
  const remaining=previous.slice(headings.length).flatMap(s=>s.fieldIds);if(remaining.length)next[next.length-1].fieldIds=[...new Set([...next[next.length-1].fieldIds,...remaining])];analysis.sections=next;
}
function reviewedSources(extra='') {
  const all=[...sources];
  const corrections=analysis.fields.filter(isDirectEdit).map(f=>`${f.label} [분류: ${labels[f.kind]}${f.kind==='unknown'?' · 사실로 사용하지 말 것':''}]: ${f.value.trim()||'이전 입력을 취소함. 현재 미확인'}`);
  if(corrections.length)all.push({id:`edit-${++sourceSerial}`,name:'사용자가 확인·수정한 최신 정보 (기존 정보보다 우선)',text:corrections.join('\n')});
  if(extra)all.push({id:`answer-${++sourceSerial}`,name:'추가 자료·수정 요청',text:extra});
  return all;
}
async function writeDraft() {
  if(busy)return;
  if(!$('#consent').checked){showNotice('AI 문서 작성을 위한 전송 동의를 선택해 주세요.','error');$('#review-consent')?.focus();return;}
  const extra=$('#additional')?.value.trim()||'';
  if(manual&&sources.length){const ok=await analyze(reviewedSources(extra),{reanalysis:true,preserveReviewed:!extra});if(ok)showNotice('보관한 자료와 직접 작성한 내용을 함께 분석했어요. 확인한 뒤 AI 문서 작성을 눌러주세요.');return;}
  if(extra){const ok=await analyze(reviewedSources(extra),{reanalysis:true});if(ok)showNotice('추가 내용을 반영해 정보를 다시 정리했어요. 변경 내용을 확인한 뒤 AI 문서 작성을 눌러주세요.');return;}
  const all=sources;
  try{validateSources(all.length?all:[{text:analysis.fields.map(f=>f.value).join('\n')}]);}catch(error){showNotice(error.message,'error');return;}
  const token=++generation;controller=new AbortController();const timer=setTimeout(()=>controller?.abort(),65000);
  setBusy(true,'관련 근거와 확인한 내용을 연결하여 문서를 작성하고 있어요. 요청·회신·보고 목적에 맞게 문장과 표를 구성합니다.');
  try {
    const response=await fetch('/api/document-mate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({action:'draft',consent:true,sources:all,analysis,editedFieldIds:[...edited],basisStatus:$('#basis-status').value})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'문서를 작성하지 못했어요. 확인한 내용은 유지됩니다.');
    if(!data.draft?.sections?.length)throw new Error('작성 결과의 형식을 확인하지 못했어요. 내용은 유지되어 있습니다.');
    if(token!==generation)return;
    draft={...data.draft,reviewedFields:analysis.fields.map(f=>({...f,edited:edited.has(f.id)}))};manual=false;draft.originalText=draftText(draft);renderDraft();showStep('draft');showNotice(`AI가 문서 초안을 작성했어요. 관련 근거·요청 사항과 미확인 항목을 검토해 주세요.${Number.isInteger(data.usage?.remaining)?` 오늘 AI ${data.usage.remaining}회 남음.`:''}`);focusPanel('draft');
  }catch(error){if(token===generation)showNotice(error.name==='AbortError'?'작성 시간이 길어져 중단했어요. 확인한 내용과 이전 초안은 유지됩니다. 다시 작성할 수 있어요.':error.message,'error');}
  finally{clearTimeout(timer);controller=null;setBusy(false);}
}
function renderReview() {
  const panel=$('#review-panel');panel.replaceChildren(panelTitle('02 / 내용 확인','제가 확인한 내용이에요'));
  panel.append(node('p',analysis.recommendationReason,'review-intro'));
  if(mode!=='template')panel.append(node('p','이 문서를 작성하려면 보통 아래 항목이 필요합니다. 기관별 기준에 맞게 항목을 수정해 주세요.','field-hint'));
  const typeRow=node('div',null,'field');const typeLabel=node('label','문서 종류 확인');typeLabel.htmlFor='review-type';const select=node('select');select.id='review-type';select.className='review-type';for(const [id,type]of Object.entries(DOCUMENT_TYPES)){const option=node('option',type.label);option.value=id;select.append(option);}select.value=analysis.documentType;select.addEventListener('change',async()=>{
    const next=select.value;select.value=analysis.documentType;
    if(manual){const previous=analysis.fields.filter(f=>f.value);const fresh=normalizeAnalysis({documentType:next},[]);edited.clear();for(const f of previous){let target=fresh.fields.find(x=>x.label===f.label);if(target){Object.assign(target,{value:f.value,kind:f.kind,sourceId:'',quote:''});}else{target={...f,id:`kept-${++sourceSerial}`,sourceId:'',quote:''};fresh.fields.push(target);let kept=fresh.sections.find(x=>x.heading==='기존에 작성한 내용');if(!kept){kept={heading:'기존에 작성한 내용',fieldIds:[]};fresh.sections.push(kept);}kept.fieldIds.push(target.id);}edited.add(target.id);}analysis=fresh;analysis.recommendationReason='새 문서의 기본 양식입니다. 이전 입력은 같은 이름의 항목 또는 기존에 작성한 내용에 보존했습니다.';renderReview();showNotice('새 유형의 기본 양식을 열고 기존 내용을 보존했어요. 목적에 맞게 항목을 확인해 주세요.');return;}
    await analyze(reviewedSources(),{reanalysis:true,documentType:next,preserveReviewed:true});
  });typeRow.append(typeLabel,select);panel.append(typeRow);
  panel.append(fieldInput('문서 제목 · AI 작성 시 내용에 맞게 다듬습니다',analysis.title,v=>{analysis.title=v;},{rows:1,max:200}));
  panel.append(node('p',`관련 근거: ${{provided:'제공한 근거의 제목·번호·날짜와 관계를 본문에 연결합니다.',none:'별도 근거 없이 작성합니다. 단순 협조요청은 바로 목적과 요청으로 시작합니다.',unknown:'자료에서 확인한 근거만 사용합니다. 확인되지 않은 법령·번호는 만들지 않습니다.'}[$('#basis-status').value]}`,'basis-summary'));
  const grid=node('div',null,'review-grid');const fieldsWrap=node('div');
  for(const field of analysis.fields) {
    const card=node('div',null,'review-card');const row=node('div',null,'label-row');const label=node('label',field.label+(field.required?' · 핵심 항목':''));label.htmlFor=`field-${field.id}`;
    const kind=node('select');kind.className='kind-select';kind.setAttribute('aria-label',`${field.label} 정보 분류`);for(const [id,name]of Object.entries(labels)){const option=node('option',name);option.value=id;kind.append(option);}kind.value=field.kind;kind.addEventListener('change',()=>{rememberOriginal(field);field.kind=kind.value;});row.append(label,kind);
    const value=node('textarea');value.id=`field-${field.id}`;value.rows=2;value.maxLength=2400;value.value=field.value;value.placeholder='모르는 내용은 비워 두세요. [확인 필요]로 표시합니다.';
    value.addEventListener('input',()=>{const old=card.querySelector('.source-quote summary');if(old)old.textContent='사용자 수정 · 수정 전 원문 참고';rememberOriginal(field);field.value=value.value;field.kind=inferKind(value.value,field.kind);kind.value=field.kind;});card.append(row,value);
    if(field.quote){const source=sources.find(s=>s.id===field.sourceId);const evidence=node('details',null,'source-quote');evidence.append(node('summary',edited.has(field.id)?'사용자 수정 · 수정 전 원문 참고':`원문 확인 · ${source?.name||'입력 자료'}`),node('blockquote',field.quote));card.append(evidence);}else card.append(node('p','직접 입력하는 내용은 본인이 확인한 정보로 작성해 주세요.','field-hint'));
    fieldsWrap.append(card);
  }
  const aside=node('aside',null,'review-aside');aside.append(node('h3','검토할 때 기억해 주세요'),list(analysis.warnings));const label=node('label','문서 항목 이름 수정');label.htmlFor='structure';const structure=node('textarea');structure.id='structure';structure.className='structure-input';structure.rows=Math.min(10,analysis.sections.length+1);structure.value=structureToText();structure.addEventListener('change',()=>updateStructure(structure.value));aside.append(label,node('p','한 줄에 항목 하나. 이름만 수정합니다. AI는 확인한 내용을 목적에 맞게 재구성합니다.','field-hint'),structure);grid.append(fieldsWrap,aside);panel.append(grid);
  const questions=analysis.questions.filter(q=>!answered.includes(q.fieldId));
  if(questions.length){const box=node('div',null,'question-card');box.append(node('h3',`초안을 위해 ${questions.length}가지만 더 확인할게요`),node('p','답하기 어려운 항목은 건너뛰어도 괜찮아요. 빈칸은 [확인 필요]로 남깁니다.'));
    for(const q of questions){const wrap=fieldInput(q.question,'',()=>{}, {rows:2,max:1200});wrap.querySelector('textarea').dataset.questionId=q.fieldId;box.append(wrap);}
    const actions=node('div',null,'actions');actions.append(button('답변 반영하기',async()=>{
      if(busy)return;
      const inputs=[...box.querySelectorAll('[data-question-id]')];const answeredNow=inputs.filter(el=>el.value.trim());
      if(!answeredNow.length){showNotice('추가 답변을 입력하거나, 아래에서 현재 내용으로 초안을 만들어 주세요.');return;}
      // Direct answers update their reviewed fields, then optional AI reanalysis
      // can reorganize new evidence without losing the user's work.
      for(const el of answeredNow){const f=analysis.fields.find(f=>f.id===el.dataset.questionId);if(f){rememberOriginal(f);f.value=el.value.trim();f.kind=inferKind(f.value);}answered.push(el.dataset.questionId);}
      analysis.questions=analysis.questions.filter(q=>!answered.includes(q.fieldId));renderReview();showNotice('답변을 반영했어요. 사실·의견·예상 분류를 확인한 뒤 초안을 만들어 주세요.');
    },'button primary'),button('질문 건너뛰기',()=>{answered.push(...questions.map(q=>q.fieldId));analysis.questions=[];renderReview();showNotice('비어 있는 항목은 초안에 [확인 필요]로 남겨둘게요.');}));box.append(actions);panel.append(box);
  }
  const addition=fieldInput('새 자료·수정 요청을 더 알려주기 (선택)','',()=>{}, {rows:2,max:4000});addition.querySelector('textarea').id='additional';addition.querySelector('label').htmlFor='additional';addition.querySelector('textarea').placeholder='예: 참석자는 20명으로 정정해 주세요. 개선방안에는 행사 안내를 일주일 앞당길 계획을 추가해 주세요.';panel.append(addition);
  const consentLabel=node('label',null,'consent');const consent=node('input');consent.type='checkbox';consent.id='review-consent';consent.checked=$('#consent').checked;consent.addEventListener('change',()=>{$('#consent').checked=consent.checked;});consentLabel.append(consent,node('span','AI 분석·문서 작성 시 자료와 확인·수정한 정보를 BCC 서버를 거쳐 Anthropic으로 전송하는 데 동의합니다.'));panel.append(consentLabel);
  const actions=node('div',null,'actions');actions.append(button('자료로 돌아가기',()=>{showStep('input');showNotice('상황과 파일을 고쳐 다시 분석할 수 있어요. 다시 분석하면 현재 확인 화면을 대체합니다.');focusPanel('input');}),button('추가 내용 AI로 재분석',async()=>{
    const extra=$('#additional').value.trim();if(!extra){showNotice('추가할 자료나 수정할 내용을 입력해 주세요.','error');return;}
    await analyze(reviewedSources(extra),{reanalysis:true});
  }),button('내용 확인했고, AI 문서 작성 →',()=>{updateStructure($('#structure').value);writeDraft();},'button primary'));
  if(manual)actions.append(button('AI 없이 작성한 내용 그대로 보기',()=>{updateStructure($('#structure').value);draft={...createDraft(analysis),documentType:analysis.documentType,qualityNotes:['직접 작성한 양식입니다. AI 문장 작성·검토를 거치지 않았습니다.'],reviewedFields:analysis.fields.map(f=>({...f,edited:edited.has(f.id)}))};draft.originalText=draftText(draft);renderDraft();showStep('draft');showNotice('직접 작성한 내용을 표시합니다. AI 작성 결과가 아닙니다.');focusPanel('draft');}));
  if(draft)actions.append(button('이전 초안 보기·다운로드',()=>{renderDraft();showStep('draft');showNotice('이전에 작성하고 수정한 초안입니다. 현재 확인 화면의 변경사항은 새로 작성해야 반영됩니다.');focusPanel('draft');}));panel.append(actions);
}
function draftText(current) {
  return [current.title,current.recipient,current.sender,...current.sections.flatMap(s=>[s.heading,s.content,...(s.table?.headers||[]),...(s.table?.rows||[]).flat()]),current.closing].filter(Boolean).join('\n');
}
function currentDraft() {
  if(!draft)return null;
  const text=draftText(draft);
  const placeholders=[...new Set(text.match(/\[(?:확인 필요|미확인|협의 필요|자료 없음)[^\]]*\]/g)||[])];
  const changed=draft.originalText&&draft.originalText!==text;
  const expressions=changed?text.split('\n').filter(line=>inferKind(line)==='opinion').map(line=>`${line} — 의견·평가의 근거를 확인해 주세요.`):(draft.unsupportedExpressions||[]);
  return {...draft,unknowns:placeholders,unsupportedExpressions:expressions,suggestedAttachments:draft.suggestedAttachments||[],qualityNotes:draft.qualityNotes||[]};
}
function saveBlob(blob,extension) {const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=`${(draft.title||'문서초안').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,70)}_검토용.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function exportDraft(kind) {
  if(busy)return;setBusy(true);
  try{const {draftMarkdown,draftPlainText,draftDocx}=await import('./vendor/export.js');const current=currentDraft();const options={includeReview:$('#include-review')?.checked===true};if(kind==='copy'){await navigator.clipboard.writeText(draftPlainText(current,options));showNotice('현재 문서 본문을 복사했어요.');}else if(kind==='md'){saveBlob(new Blob([draftMarkdown(current,options)],{type:'text/markdown;charset=utf-8'}),'md');showNotice('현재 초안의 Markdown 다운로드를 시작했어요.');}else {saveBlob(await draftDocx(current,options),'docx');showNotice('현재 초안의 Word 다운로드를 시작했어요.');}}
  catch(error){showNotice(kind==='copy'?'복사 권한을 얻지 못했어요. Markdown 또는 Word로 내려받아 주세요.':'문서 다운로드를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.','error');}finally{setBusy(false);}
}
function fit(input){input.style.height='auto';input.style.height=`${Math.max(42,input.scrollHeight+3)}px`;}
function documentEdit(label,value,onChange,{max=12000,title=false}={}){
  const input=node('textarea');input.value=value||'';input.rows=title?1:2;input.maxLength=max;input.className=title?'document-title':'document-text';input.setAttribute('aria-label',label);
  input.addEventListener('input',()=>{onChange(input.value);fit(input);updateChecklist();});return input;
}
function renderDraft() {
  const panel=$('#draft-panel');panel.replaceChildren(panelTitle('03 / 초안과 검토',draft.mode==='manual'?'직접 작성한 문서':'근거와 목적을 담은 문서 초안'));
  panel.append(node('p','본문·표를 눌러 직접 수정할 수 있어요. 수정한 내용 그대로 복사하거나 Word로 내려받습니다. [확인 필요]는 제출 전에 채워주세요.','draft-disclaimer'));
  const toolbar=node('div',null,'export-toolbar');toolbar.append(button('본문 복사',()=>exportDraft('copy')),button('Markdown',()=>exportDraft('md')),button('Word 내려받기 ↓',()=>exportDraft('docx'),'button primary'));panel.append(toolbar);
  const reviewOption=node('label',null,'consent compact');const include=node('input');include.type='checkbox';include.id='include-review';reviewOption.append(include,node('span','내려받을 문서 끝에 검토 메모를 별도 페이지로 포함'));panel.append(reviewOption);
  const layout=node('div',null,'draft-layout');const page=node('article',null,'draft-page');page.setAttribute('aria-label','편집 가능한 문서 본문');
  if(draft.recipient||['cooperation','reply'].includes(draft.documentType)){
    page.append(documentEdit('수신',draft.recipient||'[확인 필요: 수신자]',v=>draft.recipient=v,{max:300}));
  }
  page.append(documentEdit('초안 제목',draft.title,v=>draft.title=v,{max:200,title:true}));
  for(const [i,section]of draft.sections.entries()){
    const block=node('section',null,'document-section');
    if(section.heading&&section.heading!=='본문')block.append(node('h3',section.heading));
    if(section.content){const text=documentEdit(`${section.heading||'본문'} 내용`,section.content,v=>section.content=v);text.dataset.draftSection=String(i);block.append(text);}
    if(section.table?.headers?.length){
      const wrap=node('div',null,'document-table-wrap');const table=node('table',null,'document-table');
      const head=node('thead');const hr=node('tr');section.table.headers.forEach((label,j)=>{const th=node('th');th.scope='col';th.append(documentEdit(`${section.heading} 표 열 ${j+1}`,label,v=>section.table.headers[j]=v,{max:120}));hr.append(th);});head.append(hr);table.append(head);
      const body=node('tbody');section.table.rows.forEach((row,r)=>{const tr=node('tr');section.table.headers.forEach((_,c)=>{const td=node('td');td.append(documentEdit(`${section.heading} ${r+1}행 ${c+1}열`,row[c]||'',v=>{section.table.rows[r][c]=v;},{max:1200}));tr.append(td);});body.append(tr);});table.append(body);wrap.append(table);block.append(wrap);
    }
    page.append(block);
  }
  if(draft.closing)page.append(documentEdit('붙임 및 끝 표시',draft.closing,v=>draft.closing=v,{max:2400}));
  if(draft.sender)page.append(documentEdit('발신 기관',draft.sender,v=>draft.sender=v,{max:300}));
  const aside=node('aside',null,'review-aside');aside.id='draft-checklist';layout.append(page,aside);panel.append(layout);updateChecklist();
  requestAnimationFrame(()=>{for(const input of page.querySelectorAll('textarea'))fit(input);});
  const actions=node('div',null,'actions');actions.append(button('확인한 정보로 돌아가기',()=>{renderReview();showStep('review');showNotice('현재 초안은 유지됩니다. AI 문서 작성을 다시 실행하면 새 초안으로 바뀝니다.');focusPanel('review');}),button('새 문서 시작',()=>{if(!confirm('현재 작성 내용과 파일을 모두 비우고 새로 시작할까요? 다운로드한 파일은 유지됩니다.'))return;generation++;controller?.abort();files=[];sources=[];answered=[];analysis=null;draft=null;edited.clear();$('#intake-form').reset();$('#basis-details').hidden=false;$('#situation').dispatchEvent(new Event('input'));renderFiles();mode='known';setMode('known');showNotice('새 문서를 시작할 준비가 되었어요.');focusPanel('input');}));panel.append(actions);
}
function updateChecklist() {
  const aside=$('#draft-checklist');if(!aside)return;const current=currentDraft();
  aside.replaceChildren(node('h3','제출 전에 채울 내용'),list(current.unknowns.length?current.unknowns:['[확인 필요]로 남은 빈칸은 없습니다. 기재한 사실과 미정 상태를 원자료와 대조해 주세요.']));
  if(current.unsupportedExpressions.length)aside.append(node('h3','근거를 확인할 표현'),list(current.unsupportedExpressions));
  if(current.qualityNotes.length)aside.append(node('h3','작성·검토 메모'),list(current.qualityNotes));
  if(current.suggestedAttachments.length)aside.append(node('h3','준비를 검토할 자료'),list(current.suggestedAttachments),node('p','추천 자료는 실제 붙임으로 자동 기재하지 않습니다.','field-hint'));
  const evidence=node('details',null,'source-quote');evidence.append(node('summary','작성에 사용한 근거 확인'));
  for(const field of (draft.reviewedFields||analysis.fields).filter(f=>f.value))evidence.append(node('p',`${field.label}${field.edited?' · 사용자 확인':''}: ${field.value}`));
  aside.append(evidence,node('p','관련 근거의 정확한 제목·번호·날짜, 요청과 처리의 관계, 실제 붙임과 기관 양식을 확인하세요.','draft-disclaimer'));
}
window.addEventListener('beforeunload',event=>{if(analysis||files.length||$('#situation').value.trim()){event.preventDefault();event.returnValue='';}});
