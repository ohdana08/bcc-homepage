// Synthetic UI/HTTP harness only. No production credentials, remote DB or AI calls.
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createLectureFixture, createMemoryDb, ADMIN_ID, ADMIN_TOKEN } from './lecture-request-local-server.mjs';
import { handleLectureOperations } from '../lib/lecture-operations.js';
import { handleLectureRequest } from '../lib/lecture-request.js';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const db=createLectureFixture(),originalRpc=db.rpc.bind(db),journal=new Map();
const caseId='11111111-1111-4111-8111-111111111111',secondCase='22222222-2222-4222-8222-222222222222',lectureId='33333333-3333-4333-8333-333333333333';
const now=new Date().toISOString();
db.tables.proposal_cases.push(...[
  {id:caseId,institution_name:'QA 가상 평생교육원',project_name:'AI 업무 활용 · 3회차 교육',contact_name:'가상 담당자',contact_email:'organizer@example.invalid',status:'inquiry',next_action:'담당자와 3회차 일정 협의',next_action_at:now,updated_at:now,created_at:now,audience:'기관 실무자',goals:'반복 업무 줄이기',lecture_date:'2026-11-12',owner_id:ADMIN_ID},
  {id:secondCase,institution_name:'QA 가상 기업',project_name:'실무 문서 작성 교육',contact_name:'가상 담당자',status:'won',next_action:'교안 준비',updated_at:now,created_at:now,owner_id:ADMIN_ID},
]);
db.tables.lecture_requests.push({receipt:randomUUID(),case_id:caseId,revision:1,payload:{institution_name:'QA 가상 평생교육원',audience:'기관 실무자',purpose:'반복 업무를 줄이는 실습',schedule_candidates:[{lecture_date:'2026-11-12',time:'오전'},{lecture_date:'2026-11-19',time:'오후'}],total_budget_range:'100~500만원',required_documents:'강의계획서'},created_at:now,updated_at:now});
db.tables.lecture_operations=[];db.tables.lecture_operations_history=[];
db.rpc=async(name,p)=>{
  if(!name.startsWith('lecture_ops_'))return originalRpc(name,p);
  const signature=JSON.stringify({name,p}),old=journal.get(p.p_mutation);
  if(old)return {data:old.signature===signature?old.result:{error:'conflict'},error:null};
  const c=db.tables.proposal_cases.find(c=>c.id===p.p_case_id);if(!c)return {data:{error:'not_found'},error:null};
  let result;
  if(name==='lecture_ops_case_update'){
    if(c.updated_at!==p.p_updated_at)return {data:{error:'conflict'},error:null};Object.assign(c,p.p_fields,{updated_at:new Date().toISOString()});result={case:structuredClone(c)};
  }else{
    let op=db.tables.lecture_operations.find(o=>o.case_id===c.id);
    if((op?.revision||0)!==p.p_revision)return {data:{error:'conflict'},error:null};
    for(const a of p.p_payload.sessions)for(const other of db.tables.lecture_operations)for(const b of other.sessions){if(other.case_id!==c.id&&a.status!=='cancelled'&&b.status!=='cancelled'&&a.instructor===b.instructor&&a.start_at<b.end_at&&a.end_at>b.start_at)return {data:{error:'schedule_conflict'},error:null};}
    if(!op){op={case_id:c.id,revision:0};db.tables.lecture_operations.push(op);}
    Object.assign(op,structuredClone(p.p_payload),{revision:op.revision+1,updated_at:new Date().toISOString()});result={operation:structuredClone(op)};
    db.tables.lecture_operations_history.push({id:randomUUID(),case_id:c.id,action:'save_operations',revision:op.revision,created_at:op.updated_at});
  }
  journal.set(p.p_mutation,{signature,result});return {data:result,error:null};
};
const finance=createMemoryDb({tables:{lectures:[{id:lectureId,user_id:ADMIN_ID,date:'2026-11-12',organization:'QA 가상 평생교육원',topic:'AI 업무 활용',fee:1000000,promised_fee:1000000,actual_fee:200000,is_paid:false,paid_at:null}],lecture_finance_links:[],lecture_finance_payments:[]}});
finance.rpc=async(name,p={})=>{
  if(name==='is_finance_owner')return {data:true,error:null};
  if(name!=='lecture_finance_mutate')return {data:null,error:{code:'unimplemented'}};
  const signature=JSON.stringify(p),old=journal.get(p.p_mutation);if(old)return {data:old.signature===signature?old.result:{error:'conflict'},error:null};
  let s=finance.tables.lecture_finance_links.find(s=>s.case_id===p.p_case_id);const v=p.p_payload;
  if(p.p_action==='link'){
    if(s)return {data:{error:'already_linked'},error:null};
    let l=finance.tables.lectures.find(l=>l.id===v.lecture_id);
    if(v.create){l={id:randomUUID(),user_id:ADMIN_ID,...v.create,fee:v.settings.contract_amount,promised_fee:v.settings.contract_amount,actual_fee:0,is_paid:false,paid_at:null};finance.tables.lectures.push(l);}
    if(!l)return {data:{error:'not_found'},error:null};
    s={case_id:p.p_case_id,lecture_id:l.id,owner_id:ADMIN_ID,revision:0,opening_received:v.opening_received,received_amount:v.opening_received,...v.settings};finance.tables.lecture_finance_links.push(s);
  }else{
    if(!s)return {data:{error:'not_found'},error:null};if(s.revision!==p.p_revision)return {data:{error:'conflict'},error:null};
    if(p.p_action==='settings')Object.assign(s,v.settings);
    if(p.p_action==='payment'){const sign=v.payment.kind==='receipt'?1:-1;if(s.received_amount+sign*v.payment.amount<0)return {data:{error:'negative_received'},error:null};finance.tables.lecture_finance_payments.push({...v.payment,case_id:s.case_id,owner_id:ADMIN_ID,created_at:new Date().toISOString(),voided_at:null});s.received_amount+=sign*v.payment.amount;}
    if(p.p_action==='void'){const entry=finance.tables.lecture_finance_payments.find(e=>e.id===v.payment_id&&e.case_id===s.case_id);if(!entry)return {data:{error:'not_found'},error:null};const change=entry.kind==='receipt'?-entry.amount:entry.amount;if(s.received_amount+change<0)return {data:{error:'negative_received'},error:null};entry.voided_at=new Date().toISOString();entry.void_reason=v.reason;s.received_amount+=change;}
  }
  s.revision++;const l=finance.tables.lectures.find(l=>l.id===s.lecture_id);Object.assign(l,{fee:s.contract_amount,promised_fee:s.contract_amount,actual_fee:s.received_amount,is_paid:s.received_amount>=s.contract_amount-s.deduction_amount});
  const result={settlement:structuredClone(s),payments:structuredClone(finance.tables.lecture_finance_payments.filter(p=>p.case_id===s.case_id))};journal.set(p.p_mutation,{signature,result});return {data:result,error:null};
};
const server=http.createServer(async(req,res)=>{
  res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);res.setHeader('Cache-Control','no-store');res.setHeader('X-Synthetic-Only','true');
  try{
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.status(403).json({error:'Local synthetic harness only'});
    if(url.pathname==='/api/config')return res.json({supabaseUrl:origin,supabaseAnonKey:'synthetic-public-no-privileges'});
    if(url.pathname==='/api/lecture-operations'||url.pathname==='/api/lecture-request'){
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>60000)return res.status(413).json({error:'too large'});chunks.push(chunk);}try{req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{return res.status(400).json({error:'invalid json'});}
      if(url.pathname==='/api/lecture-request')return handleLectureRequest(req,res,{db,rateSecret:'synthetic-only-rate'});
      return handleLectureOperations(req,res,{db,financeDb:finance,financeConfig:{enabled:true,url:`${origin}/finance`,anonKey:'synthetic-public-no-privileges'}});
    }
    if(url.pathname==='/__fixture/auth-client.js'){
      res.setHeader('Content-Type','text/javascript');return res.end(`export function createClient(url){const finance=url.endsWith('/finance'),key=finance?'fixture-finance':'fixture-admin',handlers=[];const session=()=>localStorage.getItem(key)?{access_token:'${ADMIN_TOKEN}',user:{id:'${ADMIN_ID}'}}:null;return{auth:{async getSession(){return{data:{session:session()}}},onAuthStateChange(fn){handlers.push(fn);return{}},async signInWithPassword({email,password}){if(email!=='owner@example.invalid'||password!=='synthetic-only')return{error:{message:'synthetic login rejected'}};localStorage.setItem(key,'1');handlers.forEach(fn=>fn('SIGNED_IN',session()));return{data:{session:session()}}},async signOut(){localStorage.removeItem(key);handlers.forEach(fn=>fn('SIGNED_OUT',null));return{}}}};}`);
    }
    if(url.pathname==='/__fixture/start'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><h1>강의 운영실 · 로컬 합성 검토</h1><p>실제 고객·장부·계정과 연결하지 않는 테스트입니다.</p><button id="start">합성 관리자 화면 열기</button><script>document.getElementById("start").onclick=()=>{localStorage.setItem("fixture-admin","1");location.href="/admin-lecture-operations.html";};</script></html>');
    }
    if(url.pathname==='/__fixture/mobile'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{background:#dfe4da;font-family:system-ui;padding:20px}iframe{width:390px;height:844px;border:0}</style><h1>390px 합성 모바일 표시</h1><iframe src="/admin-lecture-operations.html" title="모바일 관리자"></iframe></html>');
    }
    const allowed=['/admin-lecture-operations.html','/lecture-operations/app.js','/lecture-operations/style.css','/logo.png','/lecture-request/index.html','/lecture-request/app.js','/lecture-request/style.css','/lecture-request/analytics.js'];
    let route=url.pathname==='/lecture-request/'?'/lecture-request/index.html':url.pathname;if(!allowed.includes(route))return res.status(404).end();
    const path=await realpath(resolve(ROOT,'.'+route));if(!path.startsWith(ROOT+sep))return res.status(404).end();let content=await readFile(path);
    if(route==='/lecture-operations/app.js')content=Buffer.from(content.toString().replaceAll('https://esm.sh/@supabase/supabase-js@2','/__fixture/auth-client.js'));
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[extname(path)]||'text/plain');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'");res.end(content);
  }catch{if(!res.writableEnded)res.status(500).json({error:'Synthetic harness failure'});}
});
server.listen(Number(process.env.PORT||5202),'127.0.0.1',()=>console.log(`Synthetic-only UI: http://127.0.0.1:${server.address().port}/__fixture/start`));
