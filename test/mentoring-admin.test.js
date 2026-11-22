import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMentoringAdmin } from '../lib/mentoring-admin.js';

const env={MENTORING_ORIGIN:'https://workspace.example.test', MENTORING_ADMIN_SECRET:'mock-'.repeat(8)};
function request(method='GET',body){
  return {method,headers:{authorization:'Bearer test-admin','content-type':'application/json'},body};
}
function auth(admin=true){
  return {auth:{getUser:async()=>({data:{user:{id:'user-id'}}})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{is_admin:admin}})})})})};
}
async function invoke(req,dependencies={}){
  let result;const out={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){result=v;}};
  await handleMentoringAdmin(req,out,{db:auth(),env,...dependencies});
  return {status:out.statusCode,headers:out.headers,data:result};
}
const noFetch=()=>assert.fail('unexpected upstream request');
test('private requests require a current BCC admin profile',async()=>{
  assert.equal((await invoke({method:'GET',headers:{}},{fetch:noFetch})).status,401);
  assert.equal((await invoke(request(),{db:auth(false),fetch:noFetch})).status,403);
  assert.equal((await invoke(request('DELETE'),{fetch:noFetch})).status,405);
});
test('admin can view three slots but upstream secrets cannot reach listing',async()=>{
  const slots=[1,2,3].map(slot=>({slot,status:'empty',code:'private-value',invite_hash:'private-hash'}));
  const result=await invoke(request(),{fetch:async(url,init)=>{
    assert.equal(url,env.MENTORING_ORIGIN+'/internal/admin/mentoring/slots');
    assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer '+env.MENTORING_ADMIN_SECRET);
    return Response.json({slots});
  }});
  assert.equal(result.status,200);assert.equal(result.data.slots.length,3);assert.equal(result.data.slots[0].code,undefined);
  assert.match(result.headers['Cache-Control'],/no-store/);
});
test('mint one code and only forward the fixed registration fields',async()=>{
  const result=await invoke(request('POST',{slot:2,name:'합성 대표',email:'Sample@Example.test',role:'admin'}),{fetch:async(url,init)=>{
    assert.ok(url.endsWith('/slots/2'));assert.deepEqual(JSON.parse(init.body),{name:'합성 대표',email:'sample@example.test'});
    return Response.json({slot:2,code:'synthetic-first-view',token:'secret'});
  }});
  assert.equal(result.status,200);assert.deepEqual(result.data,{slot:2,code:'synthetic-first-view',expires_at:null});
  assert.equal((await invoke(request('POST',{slot:4,email:'bad',name:'x'}),{fetch:noFetch})).status,400);
});
test('refuse an insecure origin and small credential; safe upstream conflicts',async()=>{
  for(const overrides of [{MENTORING_ORIGIN:'http://workspace.example.test'},{MENTORING_ADMIN_SECRET:'short'}])
    assert.equal((await invoke(request(),{env:{...env,...overrides},fetch:noFetch})).status,503);
  const result=await invoke(request('POST',{slot:1,name:'합성',email:'one@example.test'}),{fetch:async()=>Response.json({error:'internal detail'},{status:409})});
  assert.equal(result.status,409);assert.doesNotMatch(result.data.error,/internal detail/);
});
