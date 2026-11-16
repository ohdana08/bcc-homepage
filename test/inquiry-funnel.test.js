import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const root = new URL('../',import.meta.url);
const code = readFileSync(new URL('assets/bcc-inquiry.js',root),'utf8');
function run(path='/',storage=new Map()) {
 const events=[],listeners={},formEvents={};
 const location=new URL(path,'https://bccconsulting.kr');
 let observe;
 const form={addEventListener:(name,fn)=>formEvents[name]=fn};
 const context={URL,URLSearchParams,Date,Set,location,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document:{referrer:'',addEventListener:(k,v)=>listeners[k]=v,getElementById:id=>id==='bccLeadForm' && location.pathname!='/lecture-request/'?form:null},IntersectionObserver:class {constructor(fn){observe=fn;}observe(){}disconnect(){}},posthog:{capture:(name,props)=>events.push({name,props}),stopSessionRecording(){context.stopped=true;}}};
 context.window=context;vm.runInNewContext(code,context);
 return {context,events,listeners,formEvents,observe,storage,tracker:context.BCCInquiry};
}
test('simple view is visible-only; trusted start is deduped; values never transmitted',()=>{
 const a=run();assert.deepEqual(a.events.map(e=>e.name),['inquiry_page_view']);
 a.observe([{isIntersecting:true}]);
 a.formEvents.input({isTrusted:false,target:{tagName:'INPUT',name:'name',value:'PRIVATE'}});
 for(let i=0;i<2;i++)a.formEvents.input({isTrusted:true,target:{tagName:'INPUT',name:'name',value:'PRIVATE'}});
 a.tracker.simple('submit_attempt');a.tracker.simple('submit_error');a.tracker.simple('submit_success');a.tracker.simple('PRIVATE');
 assert.equal(a.events.filter(e=>e.name==='inquiry_form_start').length,1);
 assert.equal(JSON.stringify(a.events).includes('PRIVATE'),false);
 assert.equal(a.events.filter(e=>e.name==='inquiry_submit_success').length,1);
});
test('detailed optional skip is not required-step abandonment; receipt stays local',()=>{
 const a=run('/lecture-request/');const id='12345678-1234-4234-8234-123456789012';
 a.tracker.detail('step',2);a.tracker.detail('skip_to_review',2);a.tracker.detail('step',5);
 a.tracker.detail('complete',id);a.tracker.detail('complete',id);
 assert.equal(a.events.filter(e=>e.name==='inquiry_submit_success').length,1);
 assert.equal(JSON.stringify(a.events).includes(id),false);
 assert.deepEqual(a.events.filter(e=>e.name==='inquiry_step_view').map(e=>e.props.step_number),[2,5]);
 a.tracker.detail('stop');a.tracker.detail('start');assert.equal(a.context.stopped,true);
});
test('private URLs and nonproduction origins fail closed',()=>{
 for(const path of ['/lecture-request/?receipt=PRIVATE','/lecture-request/#key=PRIVATE','/lecture-request/?mode=edit','http://localhost:8080/','https://preview.vercel.app/'])assert.equal(run(path).events.length,0,path);
});
test('QA marked on all funnel events and next page; unsafe sources ignored',()=>{
 const a=run('/?bcc_analytics_debug=1');const b=run('/lecture-request/',a.storage);
 assert.ok([...a.events,...b.events].every(e=>e.props.is_test));
 assert.equal(run('/?inquiry_from=PRIVATE').events[0].props.source_page,'direct_or_unknown');
 assert.equal(run('/?inquiry_from=tools').events[0].props.source_page,'tools');
 assert.ok(run('/lecture-request/#qa=1').events.every(e=>e.props.is_test));
});
test('CTA same-origin classification and safe new-tab source; external clicks not conversions',()=>{
 const a=run('/tools.html');
 const link={href:'https://bccconsulting.kr/lecture-request/',closest:()=>null};
 a.listeners.click({target:{closest:()=>link}});
 assert.equal(new URL(link.href).searchParams.get('inquiry_from'),'tools');
 assert.equal(run('/lecture-request/',a.storage).events[0].props.source_page,'tools');
 link.href='https://pf.kakao.com/channel/chat';a.listeners.click({target:{closest:()=>link}});
 assert.equal(a.events.at(-1).props.form_kind,'kakao');assert.equal(a.events.filter(e=>e.name==='inquiry_submit_success').length,0);
});
test('broken analytics never blocks caller',()=>{
 const a=run();a.context.posthog.capture=()=>{throw Error('blocked')};assert.doesNotThrow(()=>a.tracker.simple('submit_success'));
});
test('actual inline simple handlers record success only for 201, failures never convert',async()=>{
 for(const page of ['index.html','ai-automation-education/index.html','geo-education/index.html'])for(const status of [201,400,429,'network']){
  const html=readFileSync(new URL(page,root),'utf8');
  const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('var LEAD_ENDPOINT'));
  const events=[];let submit;
  const form={name:{value:'PRIVATE'},contact:{value:'PRIVATE'},consent:{checked:true},education_interest:{value:'',selectedOptions:[]},request_type:{value:'lecture'},message:{value:'PRIVATE'},website:{value:''},querySelector:()=>({disabled:false}),reset(){},addEventListener:(type,fn)=>{if(type==='submit')submit=fn;}};
  const ctx={URLSearchParams,sessionStorage:{getItem:()=>'',setItem(){}},document:{referrer:'',getElementById:id=>id==='bccLeadForm'?form:{}},location:{search:''},BCCInquiry:{simple:e=>events.push(e)},fetch:()=>status==='network'?Promise.reject(Error()):Promise.resolve({status,json:async()=>({})})};ctx.window=ctx;
  vm.runInNewContext(source,ctx);submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,status===201?['submit_attempt','submit_success']:['submit_attempt','submit_error'],page+status);
 }
});

test('same-document contact click preserves fragment navigation and inputs',()=>{
 const a=run('/ai-automation-education/');
 const link={href:'https://bccconsulting.kr/ai-automation-education/#contact',closest:()=>null};
 a.listeners.click({target:{closest:()=>link}});
 assert.equal(link.href,'https://bccconsulting.kr/ai-automation-education/#contact');
});
