import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIENCE_SCHEMA, EXPERIENCE_QUESTIONS, MAX_PORTFOLIO_BYTES, normalizeExperienceAnswers, normalizePortfolioFile, safePortfolioUrl, experienceResponseCard } from '../lib/ai-experience-card.js';
import { summarizeResponses, handleTrainingNeedsPublic, handleTrainingNeedsAdmin } from '../lib/training-needs.js';

const uuid = '10000000-0000-4000-8000-000000000001';
const otherSurvey = '20000000-0000-4000-8000-000000000002';
const key = '30000000-0000-4000-8000-000000000003';
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64');
const answers = (overrides = {}) => ({ schema_version: EXPERIENCE_SCHEMA, experience_tasks:['image'], creation_process:['direct','revise'], portfolio:{}, desired_work:['video'], support_needs:['visual'], others:{}, ...overrides });
const file = (overrides = {}) => ({name:'my-image.png',mime_type:'image/png',data_base64:png,...overrides});
const response = () => ({ statusCode:200, headers:{}, status(n){this.statusCode=n;return this;}, json(data){this.data=data;return this;}, setHeader(k,v){this.headers[k]=v;} });
function mockDb({isAdmin=true, surveyId=uuid, code='ABC12345', status='open', error=null, attachment=null, responseSurvey=uuid}={}) {
  const calls=[];
  const db={calls,auth:{getUser:async()=>({data:{user:{id:'admin'}}})},rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:{ok:true,duplicate:false,response_id:'7',answers:args.p_answers},error};},from(table){
    const filters=[];const q={select(fields,opts){calls.push({table,fields,opts,filters});return q;},eq(k,v){filters.push([k,v]);return q;},maybeSingle:async()=>{
      if(table==='training_need_surveys') return {data:filters.some(([k,v])=>k==='public_code'&&v!==code)?null:{id:surveyId,public_code:code,status,title:'강의',institution_label:'기관',expected_response_count:20}};
      if(table==='training_need_responses') return {data:filters.some(([k,v])=>k==='survey_id'&&v!==responseSurvey)?null:{id:'7'}};
      if(table==='training_need_attachments') return {data:attachment};
      return {data:null};
    },single:async()=>({data:table==='profiles'?{is_admin:isAdmin}:null})};return q;
  }};return db;
}

test('five experience questions use no scoring or levels',()=>{
  assert.equal(EXPERIENCE_QUESTIONS.length,5);
  assert.equal(EXPERIENCE_QUESTIONS[2].required,false);
  assert.deepEqual(EXPERIENCE_QUESTIONS.map(q=>q.id),['experience_tasks','creation_process','portfolio','desired_work','support_needs']);
});
test('normalization retains only explicit experience and no uploaded bytes in answers',()=>{
  const result=normalizeExperienceAnswers(answers({portfolio:{file:file(),url:'https://example.com/work',consent:true},desired_detail:'  홍보\n영상  ', tools_detail:'mail@example.com'}));
  assert.equal(result.answers.desired_detail,'홍보 영상');
  assert.equal(result.answers.tools_detail,'[이메일 삭제]');
  assert.equal(result.attachment.data_base64,png);
  assert.equal(result.answers.portfolio.file.data_base64,undefined);
  assert.equal(result.answers.portfolio.file.sha256.length,64);
  assert.equal(result.answers.portfolio.url,'https://example.com/work');
});
test('new users skip process without inferring a level',()=>{
  const {answers:a}=normalizeExperienceAnswers(answers({experience_tasks:['none'],creation_process:undefined}));
  assert.deepEqual(a.creation_process,[]);
  assert.equal(a.level,undefined);
  assert.equal(a.portfolio.consent,false);
});
test('required, unknown and mutually exclusive options reject malformed answers',()=>{
  for (const change of [{experience_tasks:[]},{experience_tasks:['unknown']},{experience_tasks:['none','image']},{creation_process:[]},{desired_work:['undecided','video']},{support_needs:['none','visual']},{support_needs:'visual'}]) assert.throws(()=>normalizeExperienceAnswers(answers(change)),e=>e.httpStatus===400);
  assert.throws(()=>normalizeExperienceAnswers(answers({desired_work:['other']})),/기타/);
  assert.throws(()=>normalizeExperienceAnswers(answers({desired_work:['image','video','writing','documents']})),/3개/);
});
test('optional portfolio needs explicit consent only when supplied',()=>{
  assert.doesNotThrow(()=>normalizeExperienceAnswers(answers()));
  assert.throws(()=>normalizeExperienceAnswers(answers({portfolio:{url:'https://example.com'}})),/동의/);
  assert.throws(()=>normalizeExperienceAnswers(answers({portfolio:{file:file(),consent:'true'}})),/동의/);
});
test('links cannot carry executable protocols or URL credentials',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,Hi','file:///tmp/a','https://user:password@example.com','https://example.com/\nfoo','not a url']) assert.throws(()=>safePortfolioUrl(url),e=>e.httpStatus===400);
  assert.equal(safePortfolioUrl('https://example.com/path?q=1'),'https://example.com/path?q=1');
});
test('file checks validate size, base64, MIME/signature and safe filename',()=>{
  assert.throws(()=>normalizePortfolioFile(file({mime_type:'text/html'})),/JPG/);
  assert.throws(()=>normalizePortfolioFile(file({mime_type:'application/pdf'})),/일치/);
  assert.throws(()=>normalizePortfolioFile(file({data_base64:'ab#='})),/1MB/);
  assert.throws(()=>normalizePortfolioFile(file({data_base64:Buffer.alloc(MAX_PORTFOLIO_BYTES+1).toString('base64')})),/1MB/);
  const normalized=normalizePortfolioFile(file({name:'../../payload.html'}));
  assert.equal(normalized.name.endsWith('.png'),true);
  assert.equal(/[\/\\<>]/.test(normalized.name),false);
  assert.doesNotThrow(()=>normalizePortfolioFile(file({mime_type:'application/pdf',data_base64:Buffer.from('%PDF-1.7\n%%EOF').toString('base64')})));
});
test('cohort denominators preserve old history and exclude skipped process answers',()=>{
  const rows=[{answers:{ai_experience:'never',current_context:['office_admin']}},{answers:normalizeExperienceAnswers(answers()).answers},{answers:normalizeExperienceAnswers(answers({experience_tasks:['none']})).answers}];
  const s=summarizeResponses(rows);
  assert.equal(s.sample_size,3);assert.equal(s.legacy_sample_size,1);assert.equal(s.experience_card.sample_size,2);
  assert.equal(s.distributions.ai_experience[0].percentage,100);
  assert.equal(s.experience_card.answered_counts.creation_process,1);
  assert.equal(s.experience_card.distributions.creation_process[0].percentage,100);
  assert.equal(s.experience_card.distributions.experience_tasks[0].percentage,50);
});
test('card contains labels but never bytes or scores',()=>{
  const a=normalizeExperienceAnswers(answers({portfolio:{file:file(),consent:true}})).answers;
  const c=experienceResponseCard({id:7,answers:a});
  assert.equal(c.response_id,'7');assert.deepEqual(c.experience_tasks,['이미지 만들기']);
  assert.equal(c.portfolio.file.data_base64,undefined);assert.equal(c.score,undefined);
  assert.equal(experienceResponseCard({answers:{ai_experience:'never'}}),null);
});
test('public get uses the same institutional code without exposing internal ID',async()=>{
  const db=mockDb();const res=response();await handleTrainingNeedsPublic({body:{action:'get',form:'ABC12345'}},res,{db});
  assert.equal(res.data.schema_version,EXPERIENCE_SCHEMA);assert.equal(res.data.questions.length,5);
  assert.equal(res.data.survey.id,undefined);assert.equal(res.data.survey.public_code,undefined);
});
test('v2 submit calls atomic scoped RPC and returns safe server card',async()=>{
  const db=mockDb();const res=response();await handleTrainingNeedsPublic({body:{action:'submit',form:'ABC12345',idempotency_key:key,answers:answers({portfolio:{file:file(),consent:true}})}},res,{db});
  assert.equal(res.statusCode,201);const call=db.calls.find(c=>c.rpc);
  assert.equal(call.args.p_survey_id,uuid);assert.equal(call.args.p_key,key);
  assert.equal(call.args.p_attachment.data_base64,png);
  assert.equal(res.data.card.portfolio.file.data_base64,undefined);
  assert.equal(db.calls.some(c=>c.opts?.count),false);
});
test('duplicate retries reach RPC even if survey closed and return stored result',async()=>{
  const db=mockDb({status:'closed'});db.rpc=async()=>({data:{ok:true,duplicate:true,response_id:'7',answers:normalizeExperienceAnswers(answers()).answers}});
  const res=response();await handleTrainingNeedsPublic({body:{action:'submit',code:'ABC12345',idempotency_key:key,answers:answers()}},res,{db});
  assert.equal(res.statusCode,200);assert.equal(res.data.duplicate,true);
});
test('closed, cap and idempotency conflicts return explicit errors',async()=>{
  for(const [message,status] of [['SURVEY_CLOSED',409],['RESPONSE_CAP',429],['IDEMPOTENCY_CONFLICT',409]]){
    const db=mockDb({error:{message}}),res=response();await handleTrainingNeedsPublic({body:{action:'submit',form:'ABC12345',idempotency_key:key,answers:answers()}},res,{db});assert.equal(res.statusCode,status);
  }
});
test('unknown schema or malformed submit key does not reach insert RPC',async()=>{
  for (const change of [{answers:answers({schema_version:'v3'})},{idempotency_key:'----'}]) {
    const db=mockDb(),res=response();await handleTrainingNeedsPublic({body:{action:'submit',form:'ABC12345',idempotency_key:key,answers:answers(),...change}},res,{db});assert.equal(res.statusCode,400);assert.equal(db.calls.some(c=>c.rpc),false);
  }
});
test('attachment download requires admin and correct survey/response scope',async()=>{
  const req={headers:{authorization:'Bearer test'},body:{action:'attachment',id:uuid,response_id:'7'}};
  await assert.rejects(handleTrainingNeedsAdmin({...req,headers:{}},response(),{db:mockDb()}),e=>e.httpStatus===401);
  await assert.rejects(handleTrainingNeedsAdmin(req,response(),{db:mockDb({isAdmin:false})}),e=>e.httpStatus===403);
  const wrongDb=mockDb({responseSurvey:otherSurvey}),wrongRes=response();await handleTrainingNeedsAdmin(req,wrongRes,{db:wrongDb});assert.equal(wrongRes.statusCode,404);assert.equal(wrongDb.calls.some(c=>c.table==='training_need_attachments'),false);
  const db=mockDb({attachment:file()}),res=response();await handleTrainingNeedsAdmin(req,res,{db});assert.equal(res.data.file.data_base64,png);assert.equal(res.headers['Cache-Control'],'private, no-store');
  const filters=db.calls.find(c=>c.table==='training_need_attachments').filters;
  assert.deepEqual(filters,[['response_id','7'],['survey_id',uuid]]);
});
test('AI analysis without client fails explicitly while ordinary admin remains independent',async()=>{
  await assert.rejects(handleTrainingNeedsAdmin({headers:{authorization:'Bearer test'},body:{action:'analyze',id:uuid}},response(),{db:mockDb(),client:null}),e=>e.httpStatus===503);
});

test('optional support detail survives submission, response card and planning summary', async()=>{
  const db=mockDb();const res=response();
  await handleTrainingNeedsPublic({method:'POST',headers:{origin:'https://bccconsulting.kr'},body:{action:'submit',code:'ABC12345',idempotency_key:key,answers:answers({support_detail:'회의록 정리가 어려워요. mail@example.com'})}},res,{db});
  assert.ok([200,201].includes(res.statusCode),JSON.stringify(res.data));
  assert.equal(res.data.card.support_detail,'회의록 정리가 어려워요. [이메일 삭제]');
  const saved=db.calls.find(c=>c.rpc).args.p_answers;
  assert.equal(saved.support_detail,res.data.card.support_detail);
  assert.deepEqual(summarizeResponses([{answers:saved}]).experience_card.support_details,[saved.support_detail]);
  assert.equal(normalizeExperienceAnswers(answers({support_detail:'가'.repeat(900)})).answers.support_detail.length,800);
  assert.equal(experienceResponseCard({answers:answers()}).support_detail,'');
});

test('blank support detail keeps predeployment retry payload unchanged',()=>{
  const original=normalizeExperienceAnswers(answers()).answers;
  assert.equal(Object.hasOwn(original,'support_detail'),false);
  assert.deepEqual(normalizeExperienceAnswers(answers({support_detail:'  '})).answers,original);
});
