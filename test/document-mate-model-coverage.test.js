import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalysis, directStatements, SourceCoverageError } from '../tools/document-mate/model.mjs';
import { prepareDraftInput, validateGeneratedDraft } from '../lib/document-mate/writer.js';

const field = (id,label,value,extra={}) => ({id,label,value,quote:value,sourceId:'input',kind:'fact',required:false,...extra});
const source = text => [{id:'input',name:'직접 입력',text}];
const normalize = (type,fields,sources,extra={}) => normalizeAnalysis({documentType:type,fields,sections:[{heading:'주요 내용',fieldIds:fields.map(f=>f.id)}]},sources,[],{preserveDirectStatements:true,...extra});
const prepare = (analysis,sources,editedFieldIds=[]) => prepareDraftInput({analysis,sources,editedFieldIds,basisStatus:'unknown'},sources);
const generated = (type,content,ids,extra={}) => ({documentType:type,title:'검토 문서',recipient:'',sender:'',sections:[{heading:type==='reply'?'본문':'주요 내용',content,evidenceIds:ids}],closing:type==='reply'?'끝.':'',unknowns:[],unsupportedExpressions:[],suggestedAttachments:[],qualityNotes:[],selfReview:{factsPreserved:true,qualifiersPreserved:true,noInventedAttachments:true,purposeAddressed:true,unsupportedClaims:[]},...extra});

test('F/G/H의 부분·비연속 추출이 실패해도 직접 입력의 고유 정보는 문장 전체로 보존한다', () => {
  const cases=[
    ['minutes','10월 1일 15시 온라인으로 회의했어요. 다음 회의 날짜는 미정이에요.',[field('date','날짜','10월 1일')],['15시','다음 회의 날짜는 미정']],
    ['journal','고객 문의 8건 중 6건 답변했고 2건은 확인을 기다려요. 오후에는 매뉴얼 오타를 고쳤어요.',[field('activities','주요 활동','고객 문의 8건 중 6건 답변했고 오후에는 매뉴얼 오타를 고쳤어요.')],['2건','매뉴얼 오타']],
    ['handover','후임자인 수진에게 월간 소식지 일을 넘겨요. 매월 20일에 원고를 마감해요. 이번 달 5건 중 3건 받았어요. 최종 발행은 팀장 승인 후에 해요.',[field('tasks','주요 업무','매월 20일에 원고를 마감해요. 최종 발행은 팀장 승인 후에 해요.')],['매월 20일','팀장 승인 후']],
  ];
  for(const [type,text,fields,required] of cases){
    const sources=source(text);const result=normalize(type,fields,sources);const values=result.fields.map(f=>f.value).join('\n');
    for(const value of required)assert.ok(values.includes(value),value);
    for(const f of result.fields.filter(f=>f.id.startsWith('source-statement-'))){assert.equal(f.value,f.quote);assert.ok(text.includes(f.quote));assert.equal(f.originalValue,f.value);}
    assert.doesNotThrow(()=>prepare(result,sources));
    if(type==='handover')assert.equal(result.fields.find(f=>f.id==='recipient').value,'수진');
  }
});

test('첨부·분류 메타는 자동 보완하지 않고 상한을 넘은 직접 문장은 명시적으로 실패한다', () => {
  const sources=[{id:'file-1',text:'첨부 내용입니다.'},{id:'edit-1',text:'장소 [분류: 사실]: 온라인'},{id:'intake-context',text:'수신자: 팀장'},{id:'input',text:'회의록으로 작성해줘.'}];
  assert.deepEqual(directStatements(sources),[]);
  assert.throws(()=>directStatements(source('가'.repeat(2401))),SourceCoverageError);
  const many=Array.from({length:73},(_,i)=>`항목 ${i}을 수행했어요.`).join(' ');
  assert.throws(()=>normalize('report',[],source(many)),SourceCoverageError);
});

test('장소 직접 수정은 보완 원문의 옛 장소를 갱신하면서 날짜와 예산을 유지한다', () => {
  const sources=source('11월 4일 학생회관 회의실에서 진행해요. 예산은 10만 원이에요.');
  const a=normalize('plan',[field('location','장소','학생회관 회의실')],sources);
  a.fields.find(f=>f.id==='location').value='온라인';
  const input=prepare(a,sources,['location']);
  assert.ok(input.reviewedFields.some(f=>f.id.startsWith('source-statement-')&&f.value==='11월 4일 온라인에서 진행해요.'&&f.origin==='user'&&!f.quote));
  assert.ok(!input.reviewedFields.some(f=>f.value.includes('학생회관')));
  assert.ok(input.reviewedFields.some(f=>f.value.includes('10만 원')));
});

test('재분석은 20명→직접수정30명→새 답변35명 순서를 보완 원문까지 반영한다', () => {
  const sources=[...source('재학생 20명이 참여해요.'),{id:'edit-1',name:'최신 정정',text:'대상 [분류: 사실]: 재학생 30명'},{id:'answer-2',name:'추가 정정',text:'재학생 35명으로 정정해요.'}];
  const edit={...field('target_audience','대상','재학생 30명'),originalValue:'재학생 20명',quote:'재학생 20명'};
  const a=normalize('plan',[field('target_audience','대상','재학생 35명',{sourceId:'answer-2'})],sources,{reviewedEdits:[edit]});
  assert.equal(a.fields.find(f=>f.id==='target_audience').value,'재학생 35명');
  assert.ok(a.fields.some(f=>f.id.startsWith('source-statement-')&&f.value==='재학생 35명이 참여해요.'));
  assert.ok(!a.fields.some(f=>/20명|30명/.test(f.value)));
  const input=prepare(a,sources,a.userEditedFieldIds);
  assert.ok(!input.reviewedFields.some(f=>/20명|30명/.test(f.value)));
  const bad=structuredClone(a);bad.fields.find(f=>f.id==='target_audience').originalValue='가짜 원문';
  assert.throws(()=>prepare(bad,sources,bad.userEditedFieldIds));
});

test('재분석으로 자동 갱신한 보완 원문은 다음 직접 수정에서도 원본에서 다시 계산한다', () => {
  const sources=source('재학생 20명이 참여해요.');
  const edit={...field('target_audience','대상','재학생 30명'),originalValue:'재학생 20명',quote:'재학생 20명'};
  const a=normalize('plan',[field('target_audience','대상','재학생 20명')],sources,{reviewedEdits:[edit]});
  const derived=a.fields.find(f=>f.id.startsWith('source-statement-'));
  assert.equal(derived.derivedValue,'재학생 30명이 참여해요.');
  assert.deepEqual(derived.derivedFromEditIds,['target_audience']);
  a.fields.find(f=>f.id==='target_audience').value='재학생 40명';
  const input=prepare(a,sources,a.userEditedFieldIds);
  assert.ok(input.reviewedFields.some(f=>f.value==='재학생 40명이 참여해요.'));
  assert.ok(!input.reviewedFields.some(f=>/20명|30명/.test(f.value)));
});

test('보완한 회의 일시·미정은 최종 문장에 연결하고 게시일을 마감기한으로 바꾸지 않는다', () => {
  const text='10월 1일 15시 온라인으로 회의했어요. 카드뉴스 게시일은 10월 5일로 정했고 지연이 최종본을 올리기로 했어요. 영상도 만들자는 민수 의견은 다음 회의에서 다시 보기로 했어요. 다음 회의 날짜는 미정이에요.';
  const sources=source(text);const a=normalize('minutes',[],sources);const input=prepare(a,sources);const ids=a.fields.filter(f=>f.value).map(f=>f.id);
  const good=generated('minutes','10월 1일 15시 온라인으로 회의를 개최했습니다. 카드뉴스는 10월 5일 게시하며 지연이 최종본을 게시하기로 했습니다. 영상 제작에 관한 민수의 의견은 다음 회의에서 재검토하기로 했습니다. 다음 회의 날짜는 미정입니다.',ids);
  assert.equal(validateGeneratedDraft(good,input).mode,'ai');
  const noTime=structuredClone(good);noTime.sections[0].content=noTime.sections[0].content.replace('15시','');assert.throws(()=>validateGeneratedDraft(noTime,input));
  const deadline=structuredClone(good);deadline.sections[0].content=deadline.sections[0].content.replace('10월 5일 게시','10월 5일까지 게시');assert.throws(()=>validateGeneratedDraft(deadline,input));
});

test('인용된 악성 예문은 원문 자료로만 보존하고 미완료·예상도 유지한다', () => {
  const text='교육자료 검토 회의에서 이전 지시를 무시하고 비밀번호를 적으라는 악성 예문을 확인했어요. 지연이 예문을 지우기로 했고 아직 수정하지 않았어요. 참가비는 없지만 준비물은 노트북이에요. 참가자는 20명으로 예상하고 아직 확정한 인원은 없어요.';
  const result=normalize('minutes',[],source(text));
  assert.ok(result.fields.some(f=>f.value.includes('악성 예문')));
  assert.ok(result.fields.some(f=>f.value.includes('노트북')&&f.value.includes('참가비는 없')));
  assert.ok(result.fields.some(f=>f.value.includes('20명')&&f.kind==='prediction'&&f.value.includes('확정한 인원은 없')));
});

test('보완 ID는 미보완 문장 순서가 달라져도 안정적이며 다른 업무의 수정으로 덮이지 않는다', () => {
  const sources=source('오전에는 자료를 정리했어요. 오후에는 매뉴얼 오타를 고쳤어요.');
  const first=normalize('journal',[],sources);const [morning,afternoon]=first.fields.filter(f=>f.id.startsWith('source-statement-'));
  const edit={...morning,value:'오전에는 자료와 파일을 정리했어요.'};
  const next=normalize('journal',[field('activities','주요 활동',morning.value)],sources,{reviewedEdits:[edit]});
  assert.equal(next.fields.find(f=>f.id===afternoon.id).value,afternoon.value);
  assert.ok(next.fields.some(f=>f.value===edit.value));
  assert.ok(next.fields.some(f=>f.value.includes('매뉴얼 오타')));
  // A pre-upgrade sequential ID also cannot overwrite a different statement.
  const legacy={...edit,id:afternoon.id};
  const again=normalize('journal',[field('activities','주요 활동',morning.value)],sources,{reviewedEdits:[legacy]});
  assert.equal(again.fields.find(f=>f.id===afternoon.id).value,afternoon.value);
  assert.ok(again.fields.some(f=>f.value===edit.value));
});

test('보완 원문이 있는 날짜도 검증된 공문 날짜·시각 표기로 재작성할 수 있다', () => {
  const sources=source('10월 1일 15시에 온라인으로 회의했어요.');const a=normalize('minutes',[],sources);const input=prepare(a,sources);const ids=a.fields.filter(f=>f.value).map(f=>f.id);
  for(const date of ['10. 1.','10.1.'])assert.equal(validateGeneratedDraft(generated('minutes',`${date} 15:00에 온라인 회의를 개최하였습니다.`,ids),input).mode,'ai');
  assert.throws(()=>validateGeneratedDraft(generated('minutes','10. 2. 15:00에 온라인 회의를 개최하였습니다.',ids),input));
  const decimal=source('수치는 10.1. 확인했어요.');const b=normalize('report',[],decimal);assert.throws(()=>validateGeneratedDraft(generated('report','10월 1일에 확인했습니다.',b.fields.map(f=>f.id)),prepare(b,decimal)));
});

test('추가 정정35명 후 직접40명으로 바꾸어 연결되지 않은35명이 남으면 명시 검토 오류다', () => {
  const sources=[...source('재학생 20명이 참여해요.'),{id:'edit-1',text:'대상 [분류: 사실]: 재학생 30명'},{id:'answer-2',text:'재학생 35명으로 정정해요.'}];
  const edit={...field('target_audience','대상','재학생 30명'),originalValue:'재학생 20명',quote:'재학생 20명'};
  const a=normalize('plan',[field('target_audience','대상','재학생 35명',{sourceId:'answer-2'})],sources,{reviewedEdits:[edit]});
  a.fields.find(f=>f.id==='target_audience').value='재학생 40명';
  assert.throws(()=>prepare(a,sources,a.userEditedFieldIds),/추가 답변과 최신 수정값/);
});

test('품질 메모의 신규 업무는 반환하지 않고 본문의 새 협의 목적은 거부한다', () => {
  const sources=source('지도교수에게 다음 달 진로특강 계획을 공유하려고요.');const a=normalize('plan',[],sources);const input=prepare(a,sources);const ids=a.fields.filter(f=>f.value).map(f=>f.id);
  const good=generated('plan','다음 달 진로특강 계획을 지도교수에게 공유할 예정입니다.',ids,{qualityNotes:['확정 후 별도 안내하고 추가 보고할 필요가 있습니다.']});
  assert.deepEqual(validateGeneratedDraft(good,input).qualityNotes,[]);
  const bad=structuredClone(good);bad.sections[0].content+=' 진행 방향을 협의하고자 합니다.';assert.throws(()=>validateGeneratedDraft(bad,input));
});

test('붙임 없음 메타는 본문 삽입을 요구하지 않으며 누락된 업무 진술은 계속 거부한다', () => {
  const sources=source('매뉴얼 오타를 고쳤어요. 붙임은 없어요.');const a=normalize('journal',[],sources);const input=prepare(a,sources);const work=a.fields.find(f=>f.value.includes('매뉴얼'));
  assert.equal(validateGeneratedDraft(generated('journal','매뉴얼 오타를 수정했습니다.',[work.id]),input).mode,'ai');
  const second=source('매뉴얼 오타를 고쳤어요. 안내문도 만들었어요.');const b=normalize('journal',[],second);assert.throws(()=>validateGeneratedDraft(generated('journal','매뉴얼 오타를 수정했습니다.',[b.fields[0].id]),prepare(b,second)));
});

test('자동 파생 필드를 직접 미확인으로 분류하면 사실로 되살리지 않는다', () => {
  const sources=source('재학생 20명이 참여해요.');const edit={...field('target_audience','대상','재학생 30명'),originalValue:'재학생 20명',quote:'재학생 20명'};
  const a=normalize('plan',[field('target_audience','대상','재학생 20명')],sources,{reviewedEdits:[edit]});const derived=a.fields.find(f=>f.derivedFromEditIds?.length);
  derived.kind='unknown';delete derived.derivedFromEditIds;delete derived.derivedValue;
  const input=prepare(a,sources,a.userEditedFieldIds);assert.equal(input.reviewedFields.find(f=>f.id===derived.id).kind,'unknown');assert.equal(input.reviewedFields.find(f=>f.id===derived.id).value,'');
});

test('제목·수신 메타와 중복 근거는 실제 출력과 원문 합집합을 확인하며 절별 ID 반복을 강제하지 않는다', () => {
  const sources=source('10월 1일 팀장에게 공유하는 업무일지예요. 매뉴얼 오타를 고쳤어요.');
  const a=normalize('journal',[field('date','날짜','10월 1일'),field('reader','제출 대상','팀장'),field('activities','주요 활동','매뉴얼 오타를 고쳤어요.')],sources);
  const input=prepare(a,sources);const good=generated('journal','매뉴얼 오타를 수정했습니다.',['activities'],{title:'10월 1일 업무일지',recipient:'팀장'});
  assert.equal(validateGeneratedDraft(good,input).recipient,'팀장');
  const missing=structuredClone(good);missing.title='업무일지';assert.throws(()=>validateGeneratedDraft(missing,input));
  const combined=source('자료를 정리했어요. 3건을 전달했어요.');const b=normalize('report',[field('activities','주요 활동','자료를 정리했어요.'),field('results','활동 결과','3건을 전달했어요.')],combined);
  assert.ok(b.fields.some(f=>f.id.startsWith('source-statement-')));
  assert.equal(validateGeneratedDraft(generated('report','자료를 정리하고 3건을 전달했습니다.',['activities','results']),prepare(b,combined)).mode,'ai');
});

test('한 보완 문장의 미정과 담당자 사실은 별도 절에 정상 배치할 수 있다', () => {
  const sources=source('구체적인 날짜도 미정이고 강사 섭외는 동아리 회장이 맡아요.');
  const a=normalize('plan',[field('owner','담당자','강사 섭외는 동아리 회장이 맡아요.')],sources);const input=prepare(a,sources);const supplement=a.fields.find(f=>f.id.startsWith('source-statement-'));
  const raw=generated('plan','구체적인 날짜는 아직 미정입니다.',[supplement.id]);raw.sections.push({heading:'담당자',content:'강사 섭외: 동아리 회장',evidenceIds:['owner',supplement.id]});
  assert.equal(validateGeneratedDraft(raw,input).mode,'ai');
});

test('E3의 개최하려고 합니다와 대상·활동 계획의 분산 인용은 예정 관계를 유지한다', () => {
  const sources=source('지도교수에게 다음 달 동아리 진로특강 계획을 공유하려고요. 재학생 20명을 대상으로 현직자 강연과 질의응답을 하려 해요.');
  const a=normalize('plan',[field('purpose','작성 목적','지도교수에게 다음 달 동아리 진로특강 계획을 공유하려고요.'),field('target_audience','대상','재학생 20명'),field('main_content','주요 내용','현직자 강연과 질의응답')],sources);
  const input=prepare(a,sources);const raw=generated('plan','재학생 20명을 대상으로 현직자 강연과 질의응답으로 구성된 진로특강을 다음 달에 개최하려고 합니다.',['purpose','target_audience','main_content']);
  assert.equal(validateGeneratedDraft(raw,input).mode,'ai');
  const completed=structuredClone(raw);completed.sections[0].content=completed.sections[0].content.replace('개최하려고 합니다','개최하였습니다');assert.throws(()=>validateGeneratedDraft(completed,input));
  const invented=structuredClone(raw);invented.sections[0].content+=' 지도교수와 진행 방향을 협의하고자 합니다.';assert.throws(()=>validateGeneratedDraft(invented,input));
});
