import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDraftInput, validateGeneratedDraft, WRITER_PROMPT } from '../lib/document-mate/writer.js';
import { createDocumentMateHandler, validateRequest } from '../lib/document-mate/handler.js';

const sourceText = '홍보물품을 참여 기관에 나눠 주려고 해요. 기관별로 받아가도록 협조를 요청하려는 계획이야.';
const field = (id, label, value, extra = {}) => ({ id, label, value, quote: value, sourceId: 'input', kind: 'fact', required: false, ...extra });
const request = (extra = {}) => ({ action: 'draft', consent: true, sources: [{ id: 'input', name: '직접 입력', text: sourceText }], analysis: { documentType: 'cooperation', fields: [field('purpose', '작성 목적', sourceText)], sections: [{ heading: '협조 목적', fieldIds: ['purpose'] }] }, editedFieldIds: [], basisStatus: 'none', ...extra });
const generated = (extra = {}) => ({ documentType: 'cooperation', title: '홍보물품 수령 협조 요청', recipient: '', sender: '', sections: [{ heading: '본문', content: '홍보물품을 참여 기관에 배부할 계획이오니 기관별 물품 수령에 협조하여 주시기 바랍니다.\n수령 일시: [확인 필요: 수령 일시]\n수령 장소: [확인 필요: 수령 장소]', evidenceIds: ['purpose'] }], closing: '끝.', unknowns: ['수령 일시', '수령 장소'], unsupportedExpressions: [], suggestedAttachments: [], qualityNotes: ['수령 일시와 장소를 확인한 후 제출해 주세요.'], selfReview: { factsPreserved: true, qualifiersPreserved: true, noInventedAttachments: true, purposeAddressed: true, unsupportedClaims: [] }, ...extra });
const prepare = (body = request()) => prepareDraftInput(body, body.sources);
function backend(options = {}) {
  const calls = [];
  const handler = createDocumentMateHandler({ env: { ANTHROPIC_API_KEY: 'test-secret', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-secret', VERCEL: '1' }, getDatabase: () => ({ rpc() { calls.push('quota'); return { async abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return options.quota || { data: { allowed: true, remaining: 10 }, error: null }; } }; } }), makeClient: (config) => { assert.equal(config.maxRetries, 0); assert.equal(config.timeout, 45000); return { messages: { async create(input, settings) { calls.push('writer'); assert.equal(settings.maxRetries, 0); assert.equal(settings.timeout, 45000); assert.ok(settings.signal instanceof AbortSignal); assert.equal(input.tool_choice.name, 'write_reviewable_document'); assert.equal(input.system, WRITER_PROMPT); if (options.error) throw options.error; return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'write_reviewable_document', input: options.raw ?? generated() }] }; } } }; } });
  return { calls, async run(body = request()) { const result = {}; const res = { setHeader() {}, status(code) { result.status = code; return this; }, json(data) { result.body = data; return this; } }; await handler({ method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.5' }, body }, res); return result; } };
}

test('draft 액션은 별도 작성 모델을 한 번 호출하고 구어체와 다른 실제 문안을 반환한다', async () => {
  const mock = backend();
  const result = await mock.run();
  assert.equal(result.status, 200);
  assert.deepEqual(mock.calls, ['quota', 'writer']);
  assert.equal(result.body.draft.mode, 'ai');
  assert.match(result.body.draft.sections[0].content, /협조하여 주시기 바랍니다/);
  assert.ok(!result.body.draft.sections[0].content.includes('계획이야'));
  assert.deepEqual(result.body.draft.sections[0].evidenceIds, ['purpose']);
  assert.ok(result.body.draft.unknowns.includes('수신 기관'));
  assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('클라이언트가 조작한 값·출처·인용은 작성 호출과 한도 차감 전에 거부한다', async () => {
  for (const forged of [
    field('purpose', '작성 목적', '시청 승인을 받았습니다.', { quote: sourceText }),
    field('purpose', '작성 목적', sourceText, { sourceId: 'other' }),
    field('purpose', '작성 목적', '120명', { quote: '120명' }),
  ]) {
    const mock = backend();
    const body = request(); body.analysis.fields = [forged];
    assert.equal((await mock.run(body)).status, 400);
    assert.deepEqual(mock.calls, []);
  }
});

test('직접 수정한 사실은 원문 인용을 위조하지 않고 사용자 확인값으로 전달한다', () => {
  const body = request({ sources: [], editedFieldIds: ['purpose'] });
  body.analysis.fields[0] = field('purpose', '작성 목적', '20개를 배부할 예정입니다.', { sourceId: 'forged', quote: '원문에는 999개' });
  const prepared = validateRequest(body);
  assert.deepEqual(prepared.reviewedFields[0], { id: 'purpose', label: '작성 목적', value: '20개를 배부할 예정입니다.', kind: 'prediction', required: false, origin: 'user', sourceId: '', quote: '' });
  assert.ok(!JSON.stringify(prepared).includes('999'));
  assert.throws(() => prepare(request({ sources: [] })));
});

test('사용자가 명시적으로 미확인 분류한 값은 숫자가 남아 있어도 사실로 승격하지 않는다', () => {
  for (const editedFieldIds of [[], ['quantity']]) {
    const body = request({ editedFieldIds });
    body.sources[0].text += '\n20명';
    body.analysis.fields.push(field('quantity', '수량', '20명', { kind: 'unknown' }));
    const item = prepare(body).reviewedFields.find((field) => field.id === 'quantity');
    assert.equal(item.kind, 'unknown');
    assert.equal(item.value, '');
    assert.equal(item.quote, '');
  }
});

test('관련 근거 없는 자체 협조는 정상이며 근거 선택란을 필수 누락으로 만들지 않는다', () => {
  const body = request();
  body.analysis.fields.push(field('basis', '관련 근거', '', { kind: 'unknown', required: true }));
  const prepared = prepare(body);
  assert.ok(!prepared.reviewedFields.some((item) => item.id === 'basis'));
  const draft = validateGeneratedDraft(generated(), prepared);
  assert.equal(draft.closing, '끝.');
  assert.ok(!draft.unknowns.some((text) => /근거|법령/.test(text)));
  const invalid = generated(); invalid.sections[0].content += '\n관련 법령에 따라 요청합니다.';
  assert.throws(() => validateGeneratedDraft(invalid, prepared));
});

test('관련 공문번호·제목·날짜는 문장 재작성 후에도 정확히 유지해야 한다', () => {
  const body = request({ basisStatus: 'provided' });
  body.sources.push({ id: 'basis', name: '관련 근거', text: '교육지원과-1234\n2026. 9. 25.\n물품 수요 조사' });
  for (const [id, label, value] of [['basis_number', '관련 공문번호', '교육지원과-1234'], ['basis_date', '근거 문서 날짜', '2026. 9. 25.'], ['basis_title', '근거 문서 제목', '물품 수요 조사']]) body.analysis.fields.push(field(id, label, value, { sourceId: 'basis' }));
  const prepared = prepare(body);
  const raw = generated(); raw.sections[0].content = '1. 관련: 교육지원과-1234(2026. 9. 25.) 「물품 수요 조사」\n2. ' + raw.sections[0].content; raw.sections[0].evidenceIds.push('basis_number', 'basis_date', 'basis_title');
  assert.equal(validateGeneratedDraft(raw, prepared).documentType, 'cooperation');
  raw.sections[0].content = raw.sections[0].content.replace('교육지원과-1234', '교육지원과-1235');
  assert.throws(() => validateGeneratedDraft(raw, prepared));
});

test('근거 제목 필드에 참조와 구어체 문장이 함께 있어도 식별자만 정확히 보존하면 된다', () => {
  const reference = '가온학교 행정실-33(2026. 9. 29., 교육장 사용 협조 요청)에 답해야 해요.';
  const reply = '요청한 10월 16일 오전은 이미 대관이 잡혀서 제공할 수 없어요.';
  const body = request({ basisStatus: 'provided', sources: [{ id: 'input', name: '회신 내용', text: `${reference}\n${reply}` }] });
  body.analysis.documentType = 'reply';
  body.analysis.fields = [field('basis_title', '근거 문서 제목', reference), field('reply_content', '회신 내용', reply)];
  body.analysis.sections = [{ heading: '회신 내용', fieldIds: ['basis_title', 'reply_content'] }];
  const prepared = prepare(body);
  assert.deepEqual(prepared.basisIdentifiers.map(({kind,value})=>({kind,value})), [
    { kind: 'title', value: '교육장 사용 협조 요청' }, { kind: 'number', value: '행정실-33' }, { kind: 'date', value: '2026. 9. 29.' },
  ]);
  const raw = generated({ documentType: 'reply', title: '교육장 사용 협조 요청에 대한 회신', sections: [{ heading: '본문', content: '1. 관련: 가온학교 행정실-33(2026. 9. 29.) 「교육장 사용 협조 요청」\n2. 요청하신 10월 16일 오전은 기존 대관으로 교육장을 제공할 수 없습니다.', evidenceIds: ['basis_title', 'reply_content'] }] });
  assert.equal(validateGeneratedDraft(raw, prepared).mode, 'ai');
  assert.ok(!raw.sections[0].content.includes('답해야 해요'));
  for (const [before, after] of [['행정실-33', '행정실-34'], ['교육장 사용 협조 요청', '체육관 대여 요청'], ['2026. 9. 29.', '2026. 9. 28.']]) {
    const changed = structuredClone(raw); changed.sections[0].content = changed.sections[0].content.replace(before, after);
    assert.throws(() => validateGeneratedDraft(changed, prepared));
  }
});

test('편집한 제목은 titleHint로 전달하되 새 사실·숫자의 근거로 쓰지 않는다', () => {
  const body = request(); body.analysis.title = '참여 기관 홍보물품 수령 안내';
  const prepared = prepare(body);
  assert.equal(prepared.titleHint, body.analysis.title);
  assert.equal(prepared.reviewedFields.length, 1);
  body.analysis.title = '2099년 999개 홍보물품 수령 안내';
  const unsupported = prepare(body);
  assert.equal(unsupported.titleHint, body.analysis.title);
  assert.throws(() => validateGeneratedDraft(generated({title:body.analysis.title}), unsupported));
  assert.equal(validateGeneratedDraft(generated(), unsupported).mode, 'ai');
});

test('같은 일시의 표기 변환은 허용하고 날짜 조합이나 분을 새로 만들지 않는다', () => {
  const body = request({ sources: [], editedFieldIds: ['purpose'] });
  body.analysis.documentType = 'minutes'; body.analysis.fields[0].value = '10월 1일 15시 온라인으로 회의했어요. 다음 회의는 11월 2일입니다.';
  const prepared = prepare(body);
  for (const content of ['회의 일시: 10월 1일 15:00', '10.1. 회의를 진행하였습니다.', '회의 일시: 10. 1. 15:00']) {
    const raw = generated({documentType:'minutes',title:'회의록',closing:'',sections:[{heading:'회의 개요',content,evidenceIds:['purpose']}]});
    assert.equal(validateGeneratedDraft(raw, prepared).mode, 'ai');
  }
  for (const content of ['회의 일시: 10월 2일 15시', '회의 일시: 10월 1일 15:01']) {
    const raw = generated({documentType:'minutes',title:'회의록',closing:'',sections:[{heading:'회의 개요',content,evidenceIds:['purpose']}]});
    assert.throws(()=>validateGeneratedDraft(raw, prepared));
  }
  body.analysis.fields[0].value = '측정값은 10.1.';
  const decimal = generated({documentType:'minutes',title:'회의록',closing:'',sections:[{heading:'회의 개요',content:'회의 일시: 10월 1일',evidenceIds:['purpose']}]});
  assert.throws(()=>validateGeneratedDraft(decimal,prepare(body)));
});

test('수신 문구는 모델이 기관명이나 각 표현을 붙여도 검토한 명칭을 그대로 사용한다', () => {
  for (const recipient of ['동아리 대표들', '학교장']) {
    const body = request({ editedFieldIds: ['recipient'] }); body.analysis.fields.push(field('recipient','수신',recipient));
    const raw = generated({recipient:recipient==='학교장'?'가온학교장':'각 동아리 대표'});
    assert.equal(validateGeneratedDraft(raw,prepare(body)).recipient,recipient);
  }
});

test('실제 C-1의 역할 반전·미정의 협의 약속은 거부하고 정상 회신문은 허용한다', () => {
  const text='가온학교 행정실-33(2026. 9. 29., 교육장 사용 협조 요청)에 답해야 해요. 요청한 10월 16일 오전은 이미 대관이 잡혀서 제공할 수 없어요. 대체 일정은 아직 정하지 않았어요. 학교장에게 회신할 거예요.';
  const body=request({basisStatus:'provided',sources:[{id:'input',name:'실제 C-1 합성 입력',text}]});
  body.analysis.documentType='reply';
  body.analysis.fields=[field('recipient','수신','가온학교'),field('sender','발신','학교장',{quote:'학교장에게 회신할 거예요.'}),field('reply_content','회신 내용','요청한 10월 16일 오전은 이미 대관이 잡혀서 제공할 수 없어요. 대체 일정은 아직 정하지 않았어요.')];
  body.analysis.sections=[{heading:'회신 내용',fieldIds:['recipient','sender','reply_content']}];
  const prepared=prepare(body);
  assert.equal(prepared.reviewedFields.find(f=>f.id==='recipient').value,'학교장');
  assert.equal(prepared.reviewedFields.find(f=>f.id==='sender').kind,'unknown');
  assert.deepEqual(prepared.explicitStates.map(s=>s.topic),['대체 일정']);
  const bad=generated({documentType:'reply',title:'교육장 사용 협조 요청에 대한 회신',recipient:'가온학교',sender:'학교장',sections:[{heading:'본문',content:'1. 요청하신 10월 16일 오전의 교육장은 제공할 수 없습니다.\n2. 대체 일정은 [확인 필요: 대체 일정]으로 협의하겠습니다.',evidenceIds:['reply_content']}]});
  assert.throws(()=>validateGeneratedDraft(bad,prepared));
  const placeholder=structuredClone(bad);placeholder.sections[0].content='교육장은 제공할 수 없습니다.\n대체 일정: [확인 필요: 대체 일정]';
  assert.throws(()=>validateGeneratedDraft(placeholder,prepared));
  const good=structuredClone(bad);good.sections[0].content='요청하신 10월 16일 오전은 기존 대관으로 교육장을 제공할 수 없습니다.\n대체 일정은 아직 정해지지 않았습니다.';
  const result=validateGeneratedDraft(good,prepared);
  assert.equal(result.recipient,'학교장');assert.equal(result.sender,'[확인 필요: 발신 기관]');
});

test('근거에 없는 미래 후속 약속만 거부하고 명시한 계획·결정·알림은 보존한다', () => {
  for (const content of ['대체 일정은 협의하겠습니다.','별도로 연락드리겠습니다.','자료를 발송할 예정입니다.','결과를 제출하겠습니다.','행사를 추진하겠습니다.']) {
    const raw=generated();raw.sections[0].content+='\n'+content;
    assert.throws(()=>validateGeneratedDraft(raw,prepare()),undefined,content);
  }
  for (const [value,content] of [
    ['수령 담당자는 정해지면 별도로 알리려고 해요.','수령 담당자가 정해지면 별도로 안내할 예정입니다.'],
    ['현직자 강연과 질의응답을 하려 해요.','현직자 강연과 질의응답을 진행할 예정입니다.'],
    ['지연이 최종본을 올리기로 했어요.','지연이 최종본을 게시할 예정입니다.'],
    ['대체 일정은 협의할 예정입니다.','대체 일정은 협의하겠습니다.'],
  ]) {
    const body=request({sources:[],editedFieldIds:['purpose']});body.analysis.fields[0].value=value;body.analysis.fields[0].kind='prediction';
    const raw=generated();raw.sections[0].content=content;assert.equal(validateGeneratedDraft(raw,prepare(body)).mode,'ai');
  }
  const past=request({sources:[],editedFieldIds:['purpose']});past.analysis.fields[0].value='대체 일정을 협의했습니다.';
  const future=generated();future.sections[0].content='대체 일정을 협의하겠습니다.';
  assert.throws(()=>validateGeneratedDraft(future,prepare(past)));
});

test('E/F의 복수 미정 상태는 문장이나 개요 표로 나누어 보존할 수 있다', () => {
  const body=request({sources:[],editedFieldIds:['purpose']});body.analysis.documentType='plan';body.analysis.fields[0].value='장소와 예산은 아직 정하지 않았어요. 구체적인 날짜도 미정이고 강사 섭외는 동아리 회장이 맡아요.';
  const prepared=prepare(body);
  assert.deepEqual(prepared.explicitStates.map(s=>s.topic),['장소','예산','날짜']);
  const raw=generated({documentType:'plan',title:'동아리 강연 계획',closing:'',sections:[{heading:'준비 상태',content:'강사 섭외는 동아리 회장이 담당합니다.',evidenceIds:['purpose'],table:{headers:['항목','상태'],rows:[['장소','미정'],['예산','미정'],['날짜','미정']]}}]});
  assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');
  raw.sections[0].table.rows[1][1]='[확인 필요: 예산]';assert.throws(()=>validateGeneratedDraft(raw,prepared));
  body.analysis.documentType='minutes';body.analysis.fields[0].value='다음 회의 날짜는 미정이에요.';
  const minutes=generated({documentType:'minutes',title:'회의록',closing:'',sections:[{heading:'다음 일정',content:'다음 회의 날짜는 아직 미정입니다.',evidenceIds:['purpose']}]});
  assert.equal(validateGeneratedDraft(minutes,prepare(body)).mode,'ai');
});

test('사용자가 확정한 장소·일정은 형제 항목에 남은 이전 미정 상태보다 우선한다', () => {
  const text='장소와 예산은 아직 정하지 않았어요.';
  const body=request({sources:[{id:'input',name:'이전 입력',text}],editedFieldIds:['location']});
  body.analysis.documentType='plan';
  body.analysis.fields=[field('location','장소','학생회관'),field('budget','예산',text)];
  body.analysis.sections=[{heading:'개요',fieldIds:['location','budget']}];
  const prepared=prepare(body);
  assert.deepEqual(prepared.explicitStates.map(s=>s.topic),['예산']);
  const raw=generated({documentType:'plan',title:'행사 계획',closing:'',sections:[{heading:'개요',content:'',evidenceIds:['location','budget'],table:{headers:['항목','내용'],rows:[['장소','학생회관'],['예산','미정']]}}]});
  assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');

  const replyText='요청한 10월 16일은 제공할 수 없어요. 대체 일정은 아직 정하지 않았어요.';
  const reply=request({sources:[{id:'input',name:'이전 입력',text:replyText}],editedFieldIds:['schedule']});
  reply.analysis.documentType='reply';reply.analysis.fields=[field('reply_content','회신 내용',replyText),field('schedule','대체 일정','10월 20일')];reply.analysis.sections=[{heading:'본문',fieldIds:['reply_content','schedule']}];
  const replyPrepared=prepare(reply);assert.deepEqual(replyPrepared.explicitStates,[]);
  assert.equal(validateGeneratedDraft(generated({documentType:'reply',title:'교육장 사용 회신',sections:[{heading:'본문',content:'요청하신 10월 16일은 제공할 수 없습니다. 대체 일정은 10월 20일입니다.',evidenceIds:['reply_content','schedule']}]}),replyPrepared).mode,'ai');

  body.analysis.fields=[field('purpose','작성 목적',text),field('location','장소','학생회관'),field('budget','예산','100원')];body.editedFieldIds=['location','budget'];body.analysis.sections=[{heading:'개요',fieldIds:['purpose','location','budget']}];
  const allResolved=prepare(body);assert.deepEqual(allResolved.explicitStates,[]);
  raw.sections[0].evidenceIds=['purpose','location','budget'];raw.sections[0].table.rows[1][1]='100원';
  assert.equal(validateGeneratedDraft(raw,allResolved).mode,'ai');
});

test('사용자가 직접 확정한 발신 기관은 원문에 없어도 수정값으로 유지한다', () => {
  const body=request({editedFieldIds:['sender']});body.analysis.fields.push(field('sender','발신','새빛센터'));
  assert.equal(validateGeneratedDraft(generated({sender:'학교장'}),prepare(body)).sender,'새빛센터');
});

test('수령 일정 수정은 별개 주제인 대체 일정 미정까지 지우지 않는다', () => {
  const text='대체 일정은 아직 정하지 않았어요.';
  const body=request({sources:[{id:'input',name:'원문',text}],editedFieldIds:['schedule']});
  body.analysis.documentType='reply';body.analysis.fields=[field('reply_content','회신 내용',text),field('schedule','수령 일정','10월 20일')];
  body.analysis.sections=[{heading:'본문',fieldIds:['reply_content','schedule']}];
  const prepared=prepare(body);assert.deepEqual(prepared.explicitStates.map(s=>s.topic),['대체 일정']);
  const raw=generated({documentType:'reply',title:'일정 회신',sections:[{heading:'본문',content:'수령 일정은 10월 20일입니다. 대체 일정은 아직 미정입니다.',evidenceIds:['reply_content','schedule']}]});
  assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');
  raw.sections[0].content='수령 일정은 10월 20일입니다.';assert.throws(()=>validateGeneratedDraft(raw,prepared));
});

test('실제 E 계획의 담당 역할은 보존하고 원문에 없는 지도교수 승인 절차는 안내에도 추가하지 않는다', () => {
  const text='지도교수에게 다음 달 동아리 진로특강 계획을 공유하려고요. 재학생 20명을 대상으로 현직자 강연과 질의응답을 하려 해요. 장소와 예산은 아직 정하지 않았어요. 구체적인 날짜도 미정이고 강사 섭외는 동아리 회장이 맡아요.';
  const body=request({sources:[{id:'input',name:'E 합성 입력',text}]});body.analysis.documentType='plan';
  body.analysis.fields=[field('purpose','작성 목적','지도교수에게 다음 달 동아리 진로특강 계획을 공유하려고요.'),field('target_audience','대상','재학생 20명'),field('main_content','주요 내용','현직자 강연과 질의응답'),field('location','장소','장소와 예산은 아직 정하지 않았어요.'),field('date','날짜','구체적인 날짜도 미정이고'),field('owner','담당자','강사 섭외는 동아리 회장이 맡아요.')];body.analysis.sections=[{heading:'계획',fieldIds:body.analysis.fields.map(f=>f.id)}];
  const prepared=prepare(body);assert.equal(prepared.reviewedFields.find(f=>f.id==='owner').kind,'fact');
  const raw=generated({documentType:'plan',title:'다음 달 동아리 진로특강 계획',closing:'',unknowns:[],qualityNotes:['구체적인 날짜와 장소, 예산을 확인해 주세요.'],sections:[
    {heading:'개요',content:'다음 달 재학생 20명을 대상으로 현직자 강연과 질의응답을 운영하는 계획을 지도교수에게 공유하고자 합니다.',evidenceIds:['purpose','target_audience','main_content']},
    {heading:'일정과 준비',content:'날짜, 장소와 예산은 아직 미정입니다.',evidenceIds:['date','location']},
    {heading:'담당',content:'강사 섭외는 동아리 회장이 담당합니다.',evidenceIds:['owner']},
  ]});
  assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');
  raw.sections[2].content='';raw.sections[2].table={headers:['업무','담당자'],rows:[['강사 섭외','동아리 회장']]};
  assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');
  raw.qualityNotes=['날짜, 장소, 예산, 담당자 확정 후 지도교수 승인 필요'];assert.deepEqual(validateGeneratedDraft(raw,prepared).qualityNotes,[]);
  raw.qualityNotes=[];raw.sections[0].content+=' 지도교수의 결재를 받아야 합니다.';assert.throws(()=>validateGeneratedDraft(raw,prepared));
  raw.sections[0].content=raw.sections[0].content.split(' 지도교수의 결재')[0];raw.sections.pop();assert.throws(()=>validateGeneratedDraft(raw,prepared));
});

test('원문에 명시된 팀장 승인 후 발행 조건은 새로운 승인 요구로 오해하지 않는다', () => {
  const value='최종 발행은 팀장 승인 후 진행할 예정입니다.';
  const body=request({sources:[],editedFieldIds:['purpose']});body.analysis.documentType='handover';body.analysis.fields[0].value=value;
  const raw=generated({documentType:'handover',title:'발행 업무 인수인계',closing:'',unknowns:[],sections:[{heading:'후속 조치',content:'최종 발행은 팀장 승인을 받은 후 진행할 예정입니다.',evidenceIds:['purpose']}],qualityNotes:['최종 발행 전 팀장 승인 여부를 확인해 주세요.']});
  assert.equal(validateGeneratedDraft(raw,prepare(body)).mode,'ai');
});

test('만들 거예요 같은 명확한 예정형은 제작 예정 문장으로 재작성할 수 있다', () => {
  for (const value of ['카드뉴스를 만들 거예요.','카드뉴스를 만들 것입니다.','카드뉴스를 만들 거야.']) {
    const body=request({sources:[],editedFieldIds:['purpose']});body.analysis.fields[0].value=value;
    const prepared=prepare(body);assert.equal(prepared.reviewedFields[0].kind,'prediction');
    const raw=generated();raw.sections[0].content='카드뉴스를 제작할 예정입니다.';
    assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');
    raw.sections[0].content='카드뉴스를 제작했습니다.';assert.throws(()=>validateGeneratedDraft(raw,prepared));
  }
});

test('회의의 다시 보기 결정은 재검토로 쓸 수 있고 과거 열람·단순 제안을 미래 약속으로 올리지 않는다', () => {
  for (const value of ['영상 제작 여부는 다음 회의에서 다시 보기로 했어요.','민수가 영상도 만들자는 의견을 냈고 다음 회의에서 다시 보기로 했어요.']) {
    const body=request({sources:[],editedFieldIds:['purpose']});body.analysis.documentType='minutes';body.analysis.fields[0].value=value;
    const raw=generated({documentType:'minutes',title:'회의록',closing:'',sections:[{heading:'논의와 후속 조치',content:'영상 제작 의견은 다음 회의에서 다시 검토하기로 하였습니다.',evidenceIds:['purpose']}]});
    assert.equal(validateGeneratedDraft(raw,prepare(body)).mode,'ai');
    raw.sections[0].content='영상 제작 의견을 수용하여 영상을 제작할 예정입니다.';
    assert.throws(()=>validateGeneratedDraft(raw,prepare(body)));
  }
  for (const value of ['영상 제작 여부는 다음 회의에서 다시 보면 좋겠어요.','영상 제작 여부를 다시 봤어요.']) {
    const body=request({sources:[],editedFieldIds:['purpose']});body.analysis.fields[0].value=value;
    const raw=generated();raw.sections[0].content='영상 제작 여부는 다시 검토하기로 하였습니다.';
    assert.throws(()=>validateGeneratedDraft(raw,prepare(body)));
  }
});

test('의견·예상·설문 미실시의 제한을 제거한 결과는 자체평가가 true여도 거부한다', () => {
  const body = request({ basisStatus: 'unknown' });
  body.sources[0].text = '설문은 하지 않았지만 제 생각에는 반응이 좋았어요.';
  body.analysis.documentType = 'report'; body.analysis.fields = [field('feedback', '반응', body.sources[0].text)]; body.analysis.sections = [{ heading: '반응', fieldIds: ['feedback'] }];
  const prepared = prepare(body);
  assert.equal(prepared.reviewedFields[0].kind, 'opinion');
  const raw = generated({ documentType: 'report', recipient: '', sender: '', title: '홍보 활동 보고', closing: '', sections: [{ heading: '작성자 평가', content: '설문은 실시하지 않았으며, 작성자는 현장 반응을 긍정적으로 평가하였습니다.', evidenceIds: ['feedback'] }] });
  assert.equal(validateGeneratedDraft(raw, prepared).mode, 'ai');
  raw.sections[0].content = '참여자 만족도가 높았습니다.';
  assert.throws(() => validateGeneratedDraft(raw, prepared));
  const planned = generated(); planned.sections[0].content = '홍보물품 배부를 완료하였습니다.';
  assert.throws(() => validateGeneratedDraft(planned, prepare()));
});

test('실제 D-1의 주체 없는 평가와 새 효율 예측은 거부하고 작성자 평가·개선 제안은 보존한다', () => {
  const body=request({sources:[],editedFieldIds:['issues','improvements']});body.analysis.documentType='report';
  body.analysis.fields=[field('issues','문제점','제 생각에는 역할을 늦게 나눠서 작업이 몰렸어요.'),field('improvements','개선방안','다음에는 시작 전에 역할을 정하면 좋겠어요.',{kind:'prediction'})];
  body.analysis.sections=[{heading:'문제점 및 개선방안',fieldIds:['issues','improvements']}];
  const prepared=prepare(body);assert.deepEqual(prepared.reviewedFields.map(f=>f.kind),['opinion','opinion']);
  const raw=generated({documentType:'report',title:'홍보단 활동 평가',closing:'',sections:[{heading:'문제점 및 개선방안',content:'역할 분담이 늦어져 작업이 집중되었던 점이 과제로 지적됩니다. 향후에는 활동 시작 전에 역할을 미리 정하여 진행하는 것이 효율적일 것으로 판단됩니다.',evidenceIds:['issues','improvements']}]});
  assert.throws(()=>validateGeneratedDraft(raw,prepared));
  raw.sections[0].content='역할 분담이 늦어져 작업이 집중되었던 점이 과제로 지적됩니다. 작성자는 시작 전에 역할을 정할 것을 제안합니다.';
  assert.throws(()=>validateGeneratedDraft(raw,prepared));
  raw.sections[0].content='작성자는 역할 분담 지연으로 작업이 집중된 것으로 평가하며, 다음 활동은 시작 전에 역할을 정할 것을 제안합니다.';
  assert.equal(validateGeneratedDraft(raw,prepared).mode,'ai');
  raw.sections[0].content+=' 작성자는 이 제안으로 효율이 증가할 것으로 판단합니다.';
  assert.throws(()=>validateGeneratedDraft(raw,prepared));
  body.analysis.fields=[field('issues','논의 내용','민수가 영상을 만들자는 의견을 냈어요.',{kind:'opinion'})];body.editedFieldIds=['issues'];body.analysis.sections=[{heading:'논의 내용',fieldIds:['issues']}];
  raw.sections[0].evidenceIds=['issues'];raw.sections[0].content='민수가 영상 제작을 제안하였습니다.';
  assert.equal(validateGeneratedDraft(raw,prepare(body)).mode,'ai');
});

test('새 숫자·단위·연결되지 않은 근거·추천 붙임·새 안내 약속은 거부한다', () => {
  const prepared = prepare();
  const bad = [];
  const count = generated(); count.sections[0].content += '\n200명을 대상으로 배부할 계획입니다.'; bad.push(count);
  const ref = generated(); ref.sections[0].evidenceIds = ['input']; bad.push(ref);
  bad.push(generated({ closing: '붙임 수령명세서 1부. 끝.' }));
  const promise = generated(); promise.sections[0].content += '\n수령 장소는 추후 안내하겠습니다.'; bad.push(promise);
  bad.push(generated({ selfReview: { factsPreserved: false } }));
  for (const raw of bad) assert.throws(() => validateGeneratedDraft(raw, prepared));
  const body = request({ editedFieldIds: ['purpose'] }); body.analysis.fields[0].value = '20만원 배부 예정';
  const unit = generated(); unit.sections[0].content = '20명에게 배부할 예정입니다.';
  assert.throws(() => validateGeneratedDraft(unit, prepare(body)));
});

test('붙임 없음이라는 입력을 실제 붙임의 존재로 오해하지 않는다', () => {
  const body = request({ editedFieldIds: ['attachments'] });
  body.analysis.fields.push(field('attachments', '첨부자료', '별도 붙임은 없어요.'));
  const raw = generated({ closing: '붙임 수령 명세서. 끝.' });
  assert.throws(() => validateGeneratedDraft(raw, prepare(body)));
});

test('이미 약속한 알림·통지를 안내로 다듬는 재작성은 허용하되 새 약속은 만들지 않는다', () => {
  for (const value of ['수령 담당자는 정해지면 별도로 알리려고 해요.', '수령 담당자는 정해지면 별도로 통지할 예정입니다.']) {
    const body = request({ editedFieldIds: ['followup'] });
    body.analysis.fields.push(field('followup', '후속 조치', value, { kind: 'prediction' }));
    const raw = generated(); raw.sections[0].content += '\n수령 담당자가 정해지면 별도로 안내할 예정입니다.'; raw.sections[0].evidenceIds.push('followup');
    assert.equal(validateGeneratedDraft(raw, prepare(body)).mode, 'ai');
  }
  for (const value of ['수령 담당자는 아직 미정입니다.', '수령 담당자를 알렸습니다.', '수령 담당자를 별도로 안내했습니다.', '수령 담당자를 별도로 알리지 않을 예정입니다.', '수령 담당자를 별도로 통지할 계획이 없습니다.']) {
    const body = request({ editedFieldIds: ['followup'] }); body.analysis.fields.push(field('followup', '후속 조치', value));
    const raw = generated(); raw.sections[0].content += '\n수령 담당자가 정해지면 별도로 안내할 예정입니다.';
    assert.throws(() => validateGeneratedDraft(raw, prepare(body)));
  }
});

test('동적 표의 행과 증거를 검증하고 새로운 수량이나 잘못된 열 개수는 거부한다', () => {
  const body = request({ sources: [], editedFieldIds: ['purpose'] }); body.analysis.documentType = 'journal'; body.analysis.fields[0].value = '문의 8건 중 6건 답변, 2건 대기';
  const raw = generated({ documentType: 'journal', title: '고객 문의 처리 업무일지', sections: [{ heading: '처리 내역', content: '문의 답변 및 확인 대기 내역을 정리하였습니다.', evidenceIds: ['purpose'], table: { headers: ['업무', '상태'], rows: [['문의 6건', '답변 완료'], ['문의 2건', '확인 대기']] } }], closing: '' });
  const prepared = prepare(body);
  assert.equal(validateGeneratedDraft(raw, prepared).sections[0].table.rows.length, 2);
  raw.sections[0].table.rows.push(['문의 10건', '완료']);
  assert.throws(() => validateGeneratedDraft(raw, prepared));
  raw.sections[0].table.rows.pop(); raw.sections[0].table.rows[0].push('추가');
  assert.throws(() => validateGeneratedDraft(raw, prepared));
});

test('작성 API 한도·45초 전체 timeout·잘못된 작성 결과는 로컬 받아쓰기 초안으로 대체하지 않는다', async () => {
  const denied = backend({ quota: { data: { allowed: false, remaining: 0 } } });
  assert.equal((await denied.run()).status, 429); assert.deepEqual(denied.calls, ['quota']);
  const timeout = backend({ error: Object.assign(new Error('test-secret'), { name: 'TimeoutError' }) });
  const timeoutResult = await timeout.run(); assert.equal(timeoutResult.status, 504); assert.ok(!timeoutResult.body.draft); assert.ok(!JSON.stringify(timeoutResult).includes('test-secret'));
  const malformed = backend({ raw: { documentType: 'cooperation' } });
  const malformedResult = await malformed.run(); assert.equal(malformedResult.status, 502); assert.ok(!malformedResult.body.draft);
});

test('보완 원문의 시간 범위는 양끝을 검증해 공문 시각 표기로 변환하며 시각·수량 변경은 거부한다', () => {
  const value='10월 8일 14~16시에 센터 1층에서 기관당 10세트씩 받아가게 협조 공문 써주세요.';
  const body=request({sources:[{id:'input',text:value}],analysis:{documentType:'cooperation',fields:[field('source-statement-time','보완한 원문 1',value)],sections:[]}});
  const prepared=prepare(body);
  const draft=(time,quantity=10)=>generated({unknowns:[],sections:[{heading:'본문',content:`10월 8일 ${time}에 센터 1층에서 기관당 ${quantity}세트씩 수령하여 주시기 바랍니다.`,evidenceIds:['source-statement-time']}]});
  for(const time of ['14~16시','14:00~16:00','14시부터 16시까지'])assert.equal(validateGeneratedDraft(draft(time),prepared).mode,'ai');
  for(const time of ['15~16시','14~17시','15:00~16:00','14:00~17:00','14:30~16:00','16:00~14:00','16시부터 14시까지','16~14시'])assert.throws(()=>validateGeneratedDraft(draft(time),prepared));
  assert.throws(()=>validateGeneratedDraft(draft('14:00~16:00',14),prepared));
});

test('별도 붙임 없음만 인용한 작성 메타는 본문 부정을 요구하지 않으며 붙임은 만들지 못한다', () => {
  for(const value of ['붙임은 없어요.','별도 붙임은 없어요.','별도의 첨부 파일은 없습니다.']){
    const body=request({editedFieldIds:['attachments']});body.analysis.fields.push(field('attachments','첨부자료',value));
    const raw=generated();raw.sections[0].evidenceIds.push('attachments');
    assert.equal(validateGeneratedDraft(raw,prepare(body)).mode,'ai');
    raw.closing='붙임 수령 명세서. 끝.';assert.throws(()=>validateGeneratedDraft(raw,prepare(body)));
  }
});

test('붙임 없음과 다른 행동이 섞인 문장·일반 미완료는 부정 보존 검사에서 제외하지 않는다', () => {
  for(const value of ['별도 붙임은 없지만 안내문은 아직 보내지 않았어요.','기관에서 아직 물품을 수령하지 않았어요.']){
    const body=request({editedFieldIds:['status']});body.analysis.fields.push(field('status','현재 상태',value));
    const raw=generated();raw.sections[0].evidenceIds.push('status');
    assert.throws(()=>validateGeneratedDraft(raw,prepare(body)));
  }
});
