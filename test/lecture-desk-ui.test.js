import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {startDeskServer} from '../scripts/lecture-desk-local-server.mjs';
const source=await readFile(new URL('../lecture-desk/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../admin-lecture-desk.html',import.meta.url),'utf8');
test('UI emits escaped content and rejects unsafe or absent links',()=>{
 const context=vm.createContext({URL,location:{origin:'https://bccconsulting.kr'}});
 vm.runInContext(source.slice(source.indexOf('const esc ='),source.indexOf('const STAGES ='))+source.slice(source.indexOf('function safeUrl('),source.indexOf('const stage ='))+';this.escape=esc;this.safe=safeUrl;',context);
 assert.equal(context.escape('<script>"&\''),'&lt;script&gt;&quot;&amp;&#39;');
 for(const v of ['',null,'javascript:alert(1)','data:text/html,evil'])assert.equal(context.safe(v),'');
 assert.equal(context.safe('https://example.com/a'),'https://example.com/a');
});
test('actual lecture day uses Korea calendar date, not UTC day',()=>{
 const context=vm.createContext({Intl,Date});vm.runInContext(source.slice(source.indexOf('function koreaDate('),source.indexOf('function safeUrl('))+'this.date=koreaDate;',context);
 assert.equal(context.date('2026-11-17T16:00:00Z'),'2026-11-18');
});
test('legacy drafts are not counted as fresh proposals and explicit QA is identifiable',()=>{
 const context=vm.createContext({});vm.runInContext(source.slice(source.indexOf('const stage ='),source.indexOf('const followup ='))+'this.current=currentProposal;this.testCase=testCase;',context);
 assert.equal(context.current({status:'drafted'}),false);
 assert.equal(context.current({desk:{revision:1,stage:'proposal_ready'}}),true);
 assert.equal(context.current({desk:{revision:1,stage:'proposal_ready',prepared_stale:true}}),false);
 assert.equal(context.current({desk:{revision:3,stage:'waiting',proposal_pending:true}}),true);
 for(const stage of ['completed','closed','on_hold'])assert.equal(context.current({desk:{revision:4,stage,proposal_pending:true}}),false);
 assert.equal(context.current({desk:{revision:3,stage:'proposal_ready',proposal_pending:false}}),false);
 assert.equal(context.testCase({institution_name:'QA_자동시험'}),true);
 assert.equal(context.testCase({institution_name:'실제 기관',project_name:'실제 강의 아님'}),true);
 assert.equal(context.testCase({institution_name:'가상 대학'}),false);
});
test('admin UI has no tracker and uses no production test bypass',()=>{
 assert.match(html,/noindex,nofollow/);assert.doesNotMatch(html+source,/googletagmanager|posthog|__fixture|synthetic-admin-token/);
 assert.match(source,/onAuthStateChange/);assert.match(source,/state\.epoch\+\+/);assert.match(source,/expected_revision/);
 for(const id of ['topic-filter','region-filter','institution-filter','stage-filter','include-tests'])assert.ok(html.includes(`id="${id}"`));
});
test('synthetic harness is explicit, isolated and supports preservation/replay/conflict',async t=>{
 const {server,url}=await startDeskServer();t.after(()=>new Promise(r=>server.close(r)));
 const call=async(body,auth=true)=>{const r=await fetch(url+'/api/lecture-desk',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer synthetic-admin-token'}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 assert.equal((await call({action:'list'},false)).status,401);
 assert.equal((await fetch(url+'/.env')).status,404);
 const src=await (await fetch(url+'/lecture-desk/app.js')).text();assert.match(src,/__fixture\/auth-client/);assert.doesNotMatch(src,/https:\/\/esm.sh/);
 const event={event_id:randomUUID(),case_id:null,expected_revision:0,kind:'inquiry',occurred_on:'2026-11-18',source_ref:'fixture',raw_text:'처음 받은 원문',fields:{institution_name:'합성 보존 시험'}};
 const a=await call({action:'apply',event}),b=await call({action:'apply',event});assert.equal(a.data.case_id,b.data.case_id);assert.equal(b.data.replayed,true);
 const id=a.data.case_id;const update={...event,event_id:randomUUID(),case_id:id,expected_revision:1,kind:'blog_written',raw_text:'종료 직후 블로그 작성',fields:{topic:'ChatGPT'}};
 assert.equal((await call({action:'apply',event:update})).status,200);assert.equal((await call({action:'apply',event:{...update,event_id:randomUUID()}})).status,409);
 const d=(await call({action:'detail',case_id:id})).data;assert.equal(d.case.inquiry_text,'처음 받은 원문');assert.equal(d.state.actual_lecture_date,'2026-11-18');assert.equal(d.events.length,2);
});
test('metric selection displays exactly current proposals or due contacts across stages',()=>{
 const nodes=new Map(['search','topic-filter','institution-filter','region-filter','stage-filter'].map(k=>[k,{value:''}]));
 const cases=[
  {id:'new',desk:{revision:1,stage:'proposal_ready'}},
  {id:'old',status:'drafted'},
  {id:'stale',desk:{revision:2,stage:'proposal_ready',prepared_stale:true}},
  {id:'future',desk:{revision:1,stage:'waiting',followup_on:'2099-01-01'}},
  {id:'due-waiting',desk:{revision:1,stage:'waiting',followup_on:'2000-01-01'}},
  {id:'due-preparing',desk:{revision:1,stage:'preparing',followup_on:'2000-01-01'}},
  {id:'done',desk:{revision:1,stage:'completed',followup_on:'2000-01-01'}},
  {id:'done-explicit',desk:{revision:2,stage:'completed',fields:{followup_on:'2000-01-01'},followup_on:'2000-01-01',followup_suggested:false}},
  {id:'done-suggested',desk:{revision:2,stage:'completed',fields:{followup_on:'2000-01-01'},followup_on:'2000-01-01',followup_suggested:true}},
  {id:'closed-explicit',desk:{revision:2,stage:'closed',fields:{followup_on:'2000-01-01'},followup_on:'2000-01-01',followup_suggested:false}}
 ];
 const context=vm.createContext({Intl,Date,$:id=>nodes.get(id),state:{view:'cases',metricFilter:'proposal_ready'},visibleCases:()=>cases});
 vm.runInContext(source.slice(source.indexOf('function koreaDate('),source.indexOf('function safeUrl('))+source.slice(source.indexOf('const stage ='),source.indexOf('function nextAction('))+source.slice(source.indexOf('function filteredCases('),source.indexOf('function fillFilter('))+'this.filtered=filteredCases;',context);
 assert.deepEqual(Array.from(context.filtered(),c=>c.id),['new']);
 context.state.metricFilter='waiting';assert.deepEqual(Array.from(context.filtered(),c=>c.id).sort(),['done-explicit','due-preparing','due-waiting']);
 context.state.view='today';assert.deepEqual(Array.from(context.filtered(),c=>c.id).sort(),['done-explicit','due-preparing','due-waiting']);
 context.state.view='cases';context.state.metricFilter='completed';assert.deepEqual(Array.from(context.filtered(),c=>c.id).sort(),['done','done-explicit','done-suggested']);
});
