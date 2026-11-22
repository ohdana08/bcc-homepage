import test from 'node:test';
import assert from 'node:assert/strict';
import enter from '../api/mentoring-entry.js';

function response(){
 return {code:200,status(n){this.code=n;return this},json(data){this.body=data;return this},setHeader(){},
 redirect(code,to){this.code=code;this.to=to;}};
}
test('only verified server identity is exchanged; a browser cannot name another participant',async t=>{
 const original={...process.env};t.after(()=>{for(const key of ['MENTORING_ORIGIN','MENTORING_ADMIN_SECRET','SUPABASE_URL','SUPABASE_ANON_KEY']){
   if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}});
 Object.assign(process.env,{MENTORING_ORIGIN:'https://private.example',MENTORING_ADMIN_SECRET:'m'.repeat(40),SUPABASE_URL:'https://auth.example',SUPABASE_ANON_KEY:'public-fixture'});
 const previous=globalThis.fetch;t.after(()=>globalThis.fetch=previous);
 let calls=[];const ticket='t'.repeat(43);
 globalThis.fetch=async(url,opt)=>{calls.push({url:String(url),opt});
  if(String(url).includes('auth.example'))return {ok:true,json:async()=>({email:'verified@example.test',email_confirmed_at:'2026-11-23'})};
  return {ok:true,json:async()=>({ticket})};};
 const req={method:'POST',headers:{origin:'https://bccconsulting.kr',authorization:'Bearer '+'a'.repeat(40),'content-type':'application/json'},
 body:{flow:'f'.repeat(43),code:'test-code',verified_email:'other@example.test'}};
 const res=response();await enter(req,res);assert.equal(res.code,200);
 assert.equal(JSON.parse(calls[1].opt.body).verified_email,'verified@example.test');assert.equal(res.body.redeem_url,'https://private.example/api/auth/redeem');
 const rejected=response();await enter({...req,headers:{...req.headers,origin:'https://other.example'}},rejected);
 assert.equal(rejected.code,403);assert.equal(calls.length,2);
});
