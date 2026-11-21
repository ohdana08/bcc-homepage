import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { surveyCompletion, surveySummaryText, surveyNotificationPage } from '../lib/survey-notifications.js';
const until='2026-11-22T00:01:00.000Z';
const base={id:'10000000-0000-4000-8000-000000000001',institution_label:'교육기관',title:'AI 교육',status:'open',is_sample:false,expected_response_count:2,updated_at:'2026-11-21T10:00:00Z'};
const rows=[{id:1,submitted_at:'2026-11-21T12:00:00Z',answers:{schema_version:'ai_experience_v2',experience_tasks:['image'],creation_process:['direct'],desired_work:['video'],support_needs:['prompt'],support_detail:'회의록 정리 mail@example.com',portfolio:{url:'https://private.test',file:{data_base64:'SECRET'}}}},{id:2,submitted_at:'2026-11-22T00:00:00Z',answers:{ai_experience:'never'}}];
test('completion handles target, KST end of deadline, explicit closure and sample/draft exclusion',()=>{
 assert.equal(surveyCompletion(base,rows,until).reason,'예정 응답 인원 도달');
 assert.equal(surveyCompletion(base,rows.slice(0,1),until),null);
 assert.equal(surveyCompletion({...base,expected_response_count:0},rows,until),null);
 assert.equal(surveyCompletion({...base,response_deadline:'2026-11-21'},[],until).completed_at,'2026-11-21T15:00:00.000Z');
 assert.equal(surveyCompletion({...base,response_deadline:'2026-11-22'},[],until),null);
 assert.equal(surveyCompletion({...base,status:'closed'},[],until).reason,'관리자 마감');
 assert.equal(surveyCompletion({...base,status:'closed',updated_at:'2026-11-23T00:00:00Z'},[],until),null);
 for(const changes of [{is_sample:true},{status:'draft'}])assert.equal(surveyCompletion({...base,...changes},rows,until),null);
});
test('summary separates cohorts and strips direct contact, files and links',()=>{
 const text=surveySummaryText(base,rows,surveyCompletion(base,rows,until));
 assert.match(text,/나의 AI 경험 카드 · 1명/);assert.match(text,/기존 설문 · 1명/);assert.match(text,/회의록 정리 \[이메일 삭제\]/);
 for(const secret of ['private.test','SECRET','mail@example.com'])assert.ok(!text.includes(secret));
 assert.match(text,/AI에 요청하기/);
});
test('survey pagination counts scanned surveys even with zero eligible events',async()=>{
 const calls=[];const db={from(table){const q={};for(const m of ['select','eq','neq','lte','order'])q[m]=(...a)=>{calls.push([table,m,...a]);return q;};q.range=async()=>({data:table==='training_need_surveys'?Array.from({length:25},(_,i)=>({...base,id:String(i),expected_response_count:99})):[]});return q;}};
 const result=await surveyNotificationPage(db,{until,offset:25});
 assert.deepEqual(result,{events:[],hasMore:true,nextOffset:50});
 assert.ok(calls.some(c=>c[1]==='eq'&&c[2]==='is_sample'&&c[3]===false));
 assert.ok(calls.some(c=>c[1]==='lte'&&c[2]==='submitted_at'&&c[3]===until));
});
function worker({pages,fail=false,state:extra={}}={}){
 const state={INQUIRY_NOTIFICATION_SECRET:'x'.repeat(40),BCC_START_AT:'2026-01-01T00:00:00Z',BCC_SURVEY_START_AT:'2026-11-22T00:00:00Z',BCC_ADMIN_ACTION_START_AT:'2026-11-22T00:00:00Z',...extra},mails=[],requests=[];
 const props={getProperty:k=>state[k]||null,setProperty:(k,v)=>{state[k]=v;},getProperties:()=>({...state}),deleteProperty:k=>{delete state[k];}};
 const ctx={console:{log(){}},PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:m=>{if(fail)throw Error('failure');mails.push(m);}},Utilities:{formatDate:()=> 'test'},UrlFetchApp:{fetch:(u,o)=>{const p=JSON.parse(o.payload);requests.push(p);const page=pages?.(p)||{events:[],hasMore:false};return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(page)};}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../ops/inquiry-gmail/Code.gs',import.meta.url),'utf8'),ctx);return {ctx,state,mails,requests,props};
}
const event={kind:'survey',id:base.id,created_at:'2026-11-22T00:00:01Z',title:'교육기관',summary_text:'합성 요약'};
const execute=w=>w.ctx.pollSummaryNotifications_(w.props,'x'.repeat(40),Date.now()+10000,until);
test('once per survey including after ordinary inquiry cleanup; historical completions are skipped',()=>{
 const old={...event,id:'old',created_at:'2026-11-21T00:00:00Z'};
 const w=worker({pages:p=>({events:p.kind==='survey'?[old,event]:[],hasMore:false})});execute(w);execute(w);
 assert.equal(w.mails.length,1);assert.equal(w.state.BCC_SENT_survey_old,'historical');assert.ok(w.state['BCC_SENT_survey_'+base.id]);
 assert.match(w.mails[0].body,/admin-training-needs.html/);
});
test('failed send remains retryable, no summary checkpoint or sent flag',()=>{
 const w=worker({fail:true,pages:p=>({events:p.kind==='survey'?[event]:[],hasMore:false})});assert.throws(()=>execute(w));assert.equal(w.state['BCC_SENT_survey_'+base.id],undefined);
});
test('empty eligible pages use nextOffset and malformed cursor aborts instead of looping',()=>{
 const w=worker({pages:p=>p.kind==='survey'?(p.offset===0?{events:[],hasMore:true,nextOffset:25}:{events:[event],hasMore:false,nextOffset:26}):{events:[],hasMore:false}});execute(w);assert.equal(w.mails.length,1);assert.equal(w.requests[1].offset,25);
 const bad=worker({pages:()=>({events:[],hasMore:true,nextOffset:0})});assert.throws(()=>execute(bad),/pagination/);
});
test('partial historical initialization retries without sending already baselined events',()=>{
 let attempts=0;
 const w=worker({pages:p=>{if(p.kind!=='survey')return {events:[],hasMore:false};if(p.offset===0)return {events:[{...event,id:'old',created_at:'2026-11-21T00:00:00Z'}],hasMore:true,nextOffset:25};if(attempts++===0)throw Error('network');return {events:[event],hasMore:false};}});
 assert.throws(()=>execute(w));assert.equal(w.mails.length,0);execute(w);assert.equal(w.mails.length,1);
});


test('target over 500 uses all response pages and exact count while old summary sample is labeled',async()=>{
 const all=Array.from({length:1000},(_,i)=>({id:i,submitted_at:'2026-11-22T00:00:00Z',answers:{ai_experience:'never'}}));
 const db={from(table){const q={};for(const m of ['select','eq','neq','lte','order'])q[m]=()=>q;q.range=async(a,b)=>({data:table==='training_need_surveys'?[{...base,expected_response_count:1000}]:all.slice(a,b+1)});return q;}};
 const result=await surveyNotificationPage(db,{until});
 assert.equal(result.events.length,1);assert.match(result.events[0].summary_text,/응답: 1000명/);assert.match(result.events[0].summary_text,/최초 500명 기준/);
});
