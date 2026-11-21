import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminActionNotificationEvents } from '../lib/admin-action-notifications.js';
const id = '10000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000001';
const window = { since:'2026-11-21T15:00:00Z', until:'2026-11-22T12:00:00Z' };
const base = changes => ({id,institution_name:'고성 센터',project_name:'AI 수업',status:'inquiry',created_at:'2026-11-01T00:00:00Z',updated_at:'2026-11-22T02:00:00Z',...changes});
const state = changes => ({case_id:id,revision:3,stage:'proposal_ready',fields:{},proposal_pending:true,prepared_stale:false,followup_on:null,...changes});
const event = changes => ({case_id:id,event_id:eventId,revision:2,payload:{kind:'proposal_ready'},created_at:'2026-11-22T01:00:00Z',...changes});
function db({cases=[base()],states=[state()],events=[event()],operations=[]}={}) {
 const tables={proposal_cases:cases,lecture_desk_state:states,lecture_desk_events:events,lecture_operations:operations};
 return {from(table){let rows=[...(tables[table]||[])];const sorts=[];let range;
  const val=(row,key)=>key==='payload->>kind'?row.payload.kind:key==='payload->fields->>followup_on'?row.payload.fields?.followup_on:row[key];
  const q={select(){return q;},eq(k,v){rows=rows.filter(r=>val(r,k)===v);return q;},lte(k,v){rows=rows.filter(r=>val(r,k)<=v);return q;},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return q;},order(k,opt={}){sorts.push([k,opt.ascending!==false]);return q;},range(a,b){range=[a,b+1];return q;},limit(n){range=[0,n];return q;},then(resolve,reject){try{rows.sort((a,b)=>{for(const [k,asc]of sorts){if(a[k]!==b[k])return(a[k]>b[k]?1:-1)*(asc?1:-1);}return 0;});return Promise.resolve({data:range?rows.slice(...range):rows,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}};return q;}};
}
test('proposal review uses preparation event ID and not unrelated current revision',async()=>{
 const first=await getAdminActionNotificationEvents(db(),window);
 assert.equal(first.events[0].id,`review-${id}-${eventId}`);
 assert.equal(first.events[0].created_at,'2026-11-22T01:00:00.000Z');
 assert.equal(first.events[0].kind,'admin_action');
 const again=await getAdminActionNotificationEvents(db({states:[state({revision:99})]}),window);
 assert.deepEqual(again,first);
 assert.doesNotMatch(JSON.stringify(first),/contact|raw_text|email_body/);
});
test('old proposals, stale, completed, on hold, sent and test cases do not notify',async()=>{
 const settings=[{events:[event({created_at:'2026-11-20T00:00:00Z'})]},...['completed','closed','on_hold'].map(stage=>({states:[state({stage})]})),{states:[state({prepared_stale:true})]},{states:[state({proposal_pending:false})]},{states:[]},{cases:[base({institution_name:'QA_Test'})]},{cases:[base({project_name:'테스트 강의'})]}];
 for(const setup of settings)assert.equal((await getAdminActionNotificationEvents(db(setup),window)).events.length,0,JSON.stringify(setup));
});
test('followup begins at Korean midnight, once per case/date with no unrelated revision churn',async()=>{
 const setup={states:[state({stage:'waiting',proposal_pending:false,followup_on:'2026-11-22'})],events:[]};
 const result=await getAdminActionNotificationEvents(db(setup),window);
 assert.equal(result.events[0].created_at,'2026-11-21T15:00:00.000Z');
 assert.equal(result.events[0].id,`followup-${id}-20261122`);
 assert.equal((await getAdminActionNotificationEvents(db(setup),{since:'2026-11-21T00:00:00Z',until:'2026-11-21T14:59:59Z'})).events.length,0);
});
test('newly assigned overdue followup is actionable, old overdue records do not flood startup',async()=>{
 const s=state({stage:'waiting',proposal_pending:false,followup_on:'2026-11-20'});
 assert.equal((await getAdminActionNotificationEvents(db({states:[s],events:[]}),window)).events.length,0);
 const assigned=event({payload:{kind:'update',fields:{followup_on:'2026-11-20'}}});
 assert.equal((await getAdminActionNotificationEvents(db({states:[s],events:[assigned]}),window)).events[0].created_at,'2026-11-22T01:00:00.000Z');
});
test('completed explicit followup allowed while suggested and legacy completed excluded',async()=>{
 const explicit=state({stage:'completed',followup_on:'2026-11-22',fields:{followup_on:'2026-11-22'},followup_suggested:false});
 assert.equal((await getAdminActionNotificationEvents(db({states:[explicit]}),window)).events.length,1);
 assert.equal((await getAdminActionNotificationEvents(db({states:[{...explicit,followup_suggested:true}]}),window)).events.length,0);
 assert.equal((await getAdminActionNotificationEvents(db({cases:[base({next_action_at:'2026-11-22T00:00:00Z'})],states:[],operations:[{case_id:id,checklist:{completed:true}}]}),window)).events.length,0);
});
test('sparse source pages retain qualifying events and event pages cover without gaps',async()=>{
 const cases=Array.from({length:150},(_,i)=>base({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,next_action_at:'2026-11-22T00:00:00Z'}));
 const store=db({cases,states:[],events:[]});
 const first=await getAdminActionNotificationEvents(store,window);
 const second=await getAdminActionNotificationEvents(store,{...window,offset:first.nextOffset});
 assert.equal(first.events.length,100);assert.equal(first.hasMore,true);assert.equal(second.events.length,50);assert.equal(second.hasMore,false);
 assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,150);
});
test('database errors fail the poll instead of acknowledging an empty notification page',async()=>{
 const broken={from(){const q={select(){return q;},lte(){return q;},order(){return q;},range(){return Promise.resolve({error:{message:'secret raw DB error'}})}};return q;}};
 await assert.rejects(getAdminActionNotificationEvents(broken,window),/Admin notification query unavailable/);
});
