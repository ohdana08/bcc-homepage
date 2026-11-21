import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createInquiryNotificationHandler } from '../lib/inquiry-notifications.js';
const secret='x'.repeat(40);
const body={kind:'detailed',since:'2026-11-16T00:00:00Z',until:'2026-11-17T00:00:00Z'};
const response=()=>({setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
test('API rejects unauthenticated requests without database access',async()=>{
 const handler=createInquiryNotificationHandler(()=>{throw Error('DB must not be called');},()=>secret);
 for(const authorization of ['', 'Bearer nope']){const r=response();await handler({method:'POST',headers:{authorization},body},r);assert.equal(r.code,401);}
});
test('API selects only metadata and orders pagination stably',async()=>{
 const calls=[],q={};for(const m of ['select','gte','lte','order'])q[m]=(...a)=>{calls.push([m,...a]);return q;};
 q.range=async(...a)=>{calls.push(['range',...a]);return {data:[{receipt:'abc',created_at:body.since,payload:'private'}]};};
 const h=createInquiryNotificationHandler(()=>({from:t=>{calls.push(['from',t]);return q;}}),()=>secret);
 const r=response();await h({method:'POST',headers:{authorization:'Bearer '+secret},body:{...body,offset:100}},r);
 assert.equal(r.code,200);assert.deepEqual(r.body.events,[{kind:'detailed',id:'abc',created_at:body.since}]);
 assert.deepEqual(calls[1],['select','receipt,created_at']);assert.deepEqual(calls.at(-1),['range',100,199]);assert.equal(calls.filter(c=>c[0]==='order').length,2);
});
function worker({quota=100,fail=false,events=[]}={}){
 const state={INQUIRY_NOTIFICATION_SECRET:secret,BCC_START_AT:new Date(Date.now()-60000).toISOString(),BCC_SURVEY_START_AT:new Date(Date.now()-60000).toISOString(),BCC_ADMIN_ACTION_START_AT:new Date(Date.now()-60000).toISOString()},mails=[],requests=[];
 const props={getProperty:k=>state[k]||null,setProperty:(k,v)=>{state[k]=v;},getProperties:()=>({...state}),deleteProperty:k=>{delete state[k];}};
 const ctx={console:{log(){}},PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:m=>{if(fail)throw Error('send failed');mails.push(m);quota--;}},Utilities:{formatDate:()=> '20261116-test'},UrlFetchApp:{fetch:(u,o)=>{const p=JSON.parse(o.payload);requests.push(p);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({events:p.kind==='simple'?events:[],hasMore:false})};}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../ops/inquiry-gmail/Code.gs',import.meta.url),'utf8'),ctx);return {ctx,state,mails,requests};
}
test('three test emails use real composition without API calls or state changes',()=>{
 const w=worker(),before={...w.state};w.ctx.sendTestEmails();assert.equal(w.mails.length,3);assert.equal(w.requests.length,0);assert.deepEqual(w.state,before);assert.ok(w.mails.every(m=>m.to==='ohdana08@gmail.com'&&m.subject.startsWith('[시험]')));assert.ok(w.mails[0].body.includes('https://bcc-admin-eight.vercel.app/'));assert.ok(w.mails[1].body.includes('admin-lecture-requests.html'));
});
test('failed send and quota exhaustion do not acknowledge unsent inquiry',()=>{
 for(const options of [{fail:true},{quota:0}]){const w=worker({...options,events:[{kind:'simple',id:'abc',created_at:new Date().toISOString()}]});assert.throws(()=>w.ctx.pollInquiryNotifications());assert.equal(w.state.BCC_SENT_simple_abc,undefined);assert.equal(w.state.BCC_CHECKPOINT_simple,undefined);}
});
test('successful events deduplicate on repeated polls',()=>{
 const w=worker({events:[{kind:'simple',id:'abc',created_at:new Date().toISOString()}]});w.ctx.pollInquiryNotifications();w.ctx.pollInquiryNotifications();assert.equal(w.mails.length,1);assert.ok(w.state.BCC_SENT_simple_abc);assert.ok(w.state.BCC_LAST_OK);assert.ok(w.requests.filter(r=>['simple','detailed'].includes(r.kind)).every(r=>r.since>=w.state.BCC_START_AT));
});

test('survey route uses protected DB scope and handles empty completed set',async()=>{
 const calls=[];const q={};for(const m of ['select','eq','neq','lte','order'])q[m]=(...a)=>{calls.push([m,...a]);return q;};q.range=async()=>({data:[]});
 const h=createInquiryNotificationHandler(()=>({from:t=>{calls.push(['from',t]);return q;}}),()=>secret),r=response();
 await h({method:'POST',headers:{authorization:'Bearer '+secret},body:{...body,kind:'survey'}},r);
 assert.equal(r.code,200);assert.deepEqual(r.body,{events:[],hasMore:false,nextOffset:0});assert.equal(calls[0][1],'training_need_surveys');assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='is_sample'&&c[2]===false));
});
test('survey read failures never become empty success pages',async()=>{
 const q={};for(const m of ['select','eq','neq','lte','order'])q[m]=()=>q;q.range=async()=>({error:new Error('private DB diagnostic')});
 const h=createInquiryNotificationHandler(()=>({from:()=>q}),()=>secret),r=response();await h({method:'POST',headers:{authorization:'Bearer '+secret},body:{...body,kind:'survey'}},r);
 assert.equal(r.code,503);assert.deepEqual(r.body,{error:'temporarily unavailable'});
});

function triggerWorker({failCreate=false}={}) {
 const state={INQUIRY_NOTIFICATION_SECRET:secret,BCC_START_AT:'2026-11-20T00:00:00Z',BCC_SURVEY_START_AT:'2026-11-21T00:00:00Z',BCC_ADMIN_ACTION_START_AT:'2026-11-21T00:00:00Z',BCC_SENT_survey_saved:'saved',BCC_CHECKPOINT_simple:'checkpoint'},actions=[];
 const trigger=(id,handler)=>({id,getHandlerFunction:()=>handler});
 const triggers=[trigger('old','pollInquiryNotifications'),trigger('unrelated','anotherWorker')];
 const ctx={console:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>state[k]||null,setProperty:(k,v)=>{state[k]=v;}})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},ScriptApp:{getProjectTriggers:()=>[...triggers],newTrigger:handler=>{let minutes;const builder={timeBased:()=>builder,everyHours:n=>{minutes=n*60;return builder;},create:()=>{actions.push(['create',handler,minutes]);if(failCreate)throw Error('quota');const t=trigger('new'+actions.length,handler);triggers.push(t);return t;}};return builder;},deleteTrigger:t=>{actions.push(['delete',t.id]);triggers.splice(triggers.indexOf(t),1);}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../ops/inquiry-gmail/Code.gs',import.meta.url),'utf8'),ctx);return {ctx,state,triggers,actions};
}
test('enable migrates to sixty minutes before removing only own triggers and repeated enable stays single',()=>{
 const w=triggerWorker(),before={...w.state};w.ctx.enableNotifications();
 assert.deepEqual(w.actions.slice(0,2),[['create','pollInquiryNotifications',60],['delete','old']]);
 w.ctx.enableNotifications();assert.equal(w.triggers.filter(t=>t.getHandlerFunction()==='pollInquiryNotifications').length,1);assert.ok(w.triggers.some(t=>t.id==='unrelated'));
 for(const [key,value] of Object.entries(before))assert.equal(w.state[key],value);
 assert.equal(w.state.BCC_POLL_INTERVAL_MINUTES,'60');
});
test('trigger creation failure preserves the old worker and existing checkpoints',()=>{
 const w=triggerWorker({failCreate:true}),before={...w.state};assert.throws(()=>w.ctx.enableNotifications(),/quota/);
 assert.ok(w.triggers.some(t=>t.id==='old'));assert.equal(w.actions.some(a=>a[0]==='delete'),false);assert.deepEqual(w.state,before);
});
