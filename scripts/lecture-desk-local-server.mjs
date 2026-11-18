// LOCAL SYNTHETIC HARNESS. No production credentials, customers, DB or model calls.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, validateEvent } from '../lib/lecture-desk-domain.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ADMIN='11111111-1111-4111-8111-111111111111';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function createDeskFixture(){
 const date=today(),now=new Date().toISOString();
 const cases=[
  {id:'22222222-2222-4222-8222-222222222222',institution_name:'가상 청년센터',project_name:'ChatGPT와 함께 쓰는 사업계획서',audience:'예비 창업자',topic:'AI 창업교육',region:'부산',delivery_format:'대면',duration_hours:3,status:'inquiry',inquiry_text:'[합성 자료] 예비 창업자 20명을 위한 3시간 실습 강의를 요청합니다. 강의안과 프로필을 부탁드립니다.',created_at:now,updated_at:now,desk:{revision:1,stage:'proposal_ready',fields:{},prepared:{summary:'예비 창업자 대상 3시간 실습 교육 요청. 확정 일정과 예산은 추가 확인이 필요합니다.',questions:['희망 날짜와 예산을 알려주실 수 있을까요?'],recommendation:'아이디어 정리 → 고객 문제 확인 → 사업계획서 초안 작성 → 근거 검토',email_subject:'청년센터 AI 창업교육 제안드립니다',email_body:'안녕하세요. 요청하신 예비 창업자 교육을 3시간 실습형 과정으로 제안드립니다.\n희망 일정과 준비 환경을 알려주시면 강의안을 구체화하겠습니다.',proposal_text:'참여자가 자신의 아이디어로 사업계획서의 핵심 항목을 완성하는 실습 교육입니다.',materials:[{title:'합성 강의 개요',source:'검증용 샘플, 실제 실적 아님'}],next_action:'회신 초안과 첨부 후보 검토'},prepared_stale:false,followup_on:null,milestones:{},updated_at:now}},
  {id:'33333333-3333-4333-8333-333333333333',institution_name:'가상 여성인력개발기관',project_name:'AI 실무 문서 작성',topic:'AI 업무자동화',audience:'기관 실무자',region:'경남',delivery_format:'온라인',duration_hours:2,status:'waiting',inquiry_text:'[합성 자료] 실무 문서 교육 문의',created_at:now,updated_at:now,desk:{revision:2,stage:'waiting',fields:{},prepared:{next_action:'제안서 수신과 일정 검토 여부 확인'},prepared_stale:false,followup_on:date,followup_suggested:true,milestones:{},updated_at:now}},
  {id:'44444444-4444-4444-8444-444444444444',institution_name:'가상 대학',project_name:'ChatGPT 자기소개서 실습',topic:'자기소개서',audience:'대학생',region:'울산',duration_hours:3,status:'won',inquiry_text:'[합성 자료] 취업교육',created_at:now,updated_at:now,desk:{revision:4,stage:'completed',fields:{},prepared:{summary:'강의안, 현장 사진, 종료 녹음본, 당일 블로그를 연결한 합성 기록입니다.'},actual_lecture_date:date,followup_on:null,milestones:{blog_written:date},updated_at:now}},
  {id:'55555555-5555-4555-8555-555555555555',institution_name:'QA_자동시험',project_name:'실제 강의 아님',status:'inquiry',created_at:now,updated_at:now,inquiry_text:'시험 기록'}
 ];
 const events=new Map(),journal=new Map(),files=new Map();let settings={...DEFAULT_SETTINGS};
 for(const c of cases)events.set(c.id,[]);
 return {cases,events,files,async action(body){
  if(body.action==='list')return {cases,has_more:false,next_page:null};
  if(body.action==='library')return {items:[{id:'library-one',title:'사업계획서 실습 자료 · 합성 예시',source_kind:'lecture_material',source_path:'synthetic/example.md',content:'실제 강의 실적이 아닌 화면 검증용 자료입니다.\n고객 문제, 제안 가치, 근거를 구분하여 사업계획서 초안을 정리합니다.',metadata:{topic:'사업계획서'}}],has_more:false,next_page:null};
  if(body.action==='settings')return {settings};
  if(body.action==='save_settings'){settings=body.settings;return {settings};}
  if(body.action==='detail'){const c=cases.find(c=>c.id===body.case_id);if(!c)throw Object.assign(new Error('기록 없음'),{status:404});return {case:c,state:c.desk,events:events.get(c.id)||[],outputs:[],requests:[],attachments:[...files.values()].filter(f=>f.case_id===c.id).map(({base64,...f})=>f)};}
  if(body.action==='apply'){
   const e=validateEvent(body.event),signature=JSON.stringify(e),prior=journal.get(e.event_id);if(prior){if(prior.signature!==signature)throw Object.assign(new Error('같은 요청 ID의 내용이 다릅니다.'),{status:409});return {...prior.result,replayed:true};}
   let c=e.case_id?cases.find(c=>c.id===e.case_id):null;if(e.case_id&&!c)throw Object.assign(new Error('기록 없음'),{status:404});if((c?.desk?.revision||0)!==e.expected_revision)throw Object.assign(new Error('다른 작업에서 변경됐습니다.'),{status:409});
   if(!c){c={id:randomUUID(),...e.fields,status:'inquiry',inquiry_text:e.raw_text,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};cases.push(c);events.set(c.id,[]);}
   let s=c.desk||{case_id:c.id,revision:0,stage:'inquiry',fields:{},prepared:{},milestones:{}};s={...s,fields:{...s.fields,...e.fields},revision:s.revision+1,updated_at:new Date().toISOString(),prepared:e.prepared||s.prepared,prepared_stale:!e.prepared&&Object.keys(e.fields).length>0};
   const next={proposal_ready:'proposal_ready',proposal_sent:'waiting',scheduled:'confirmed',plan_received:'preparing',photos_received:'on_site',recording_received:'completed',blog_written:'completed'}[e.kind];if(next&&s.stage!=='completed')s.stage=next;if(e.kind==='blog_written'){s.actual_lecture_date=e.occurred_on;s.milestones.blog_written=e.occurred_on;}if(Object.hasOwn(e.fields,'followup_on'))s.followup_on=e.fields.followup_on;
   Object.assign(c,e.fields,{desk:s});events.get(c.id).unshift({event_id:e.event_id,revision:s.revision,payload:e,created_at:new Date().toISOString()});const result={case_id:c.id,revision:s.revision,state:s,replayed:false};journal.set(e.event_id,{signature,result});return result;
  }
  if(body.action==='upload'){const file={id:body.file_id,case_id:body.case_id,original_name:body.name,mime_type:body.mime_type,byte_size:Buffer.from(body.base64,'base64').length,base64:body.base64,status:'ready',source:'desk'};files.set(file.id,file);return {file};}
  throw Object.assign(new Error('지원하지 않는 합성 작업'),{status:400});
 }};
}
export function startDeskServer(port=0){const fixture=createDeskFixture();const server=http.createServer(async(req,res)=>{
 const origin=`http://127.0.0.1:${server.address().port}`;res.setHeader('Cache-Control','no-store');res.setHeader('X-Synthetic-Only','true');const json=(value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 try{
  if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return json({error:'Local fixture only'},403);
  const url=new URL(req.url,origin);
  if(url.pathname==='/api/config')return json({supabaseUrl:origin,supabaseAnonKey:'synthetic-only-public'});
  if(url.pathname==='/api/lecture-desk'){
   if(req.method!=='POST')return json({error:'POST only'},405);if(req.headers.authorization!=='Bearer synthetic-admin-token')return json({error:'관리자 로그인이 필요합니다.'},401);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3000000)return json({error:'too large'},413);chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString());
   if(body.action==='download'){const f=fixture.files.get(body.file_id);if(!f||f.case_id!==body.case_id)return json({error:'파일 없음'},404);res.setHeader('Content-Type','application/octet-stream');return res.end(Buffer.from(f.base64,'base64'));}
   return json(await fixture.action(body));
  }
  if(url.pathname==='/__fixture/auth-client.js'){res.setHeader('Content-Type','text/javascript');return res.end(`export function createClient(){return{auth:{async getSession(){return{data:{session:localStorage.getItem('desk-fixture')?{access_token:'synthetic-admin-token',user:{id:'${ADMIN}'}}:null}}},onAuthStateChange(){return{}}}}}`);}
  if(url.pathname==='/__fixture/start'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><h1>강의 업무함 · 합성 검증</h1><p>실제 고객·자료·계정에 연결하지 않습니다.</p><button id="start">합성 관리자 열기</button><script src="/__fixture/start.js"></script></html>');}
  if(url.pathname==='/__fixture/start.js'){res.setHeader('Content-Type','text/javascript');return res.end("document.getElementById('start').onclick=()=>{localStorage.setItem('desk-fixture','1');location.href='/admin-lecture-desk.html'};");}
  if(url.pathname==='/__fixture/mobile'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><h1>390px 합성 모바일</h1><iframe title="모바일 업무함" src="/admin-lecture-desk.html" width="390" height="844"></iframe></html>');}
  const allowed=['/admin-lecture-desk.html','/lecture-desk/app.js','/lecture-desk/style.css','/logo.png'];if(!allowed.includes(url.pathname)){res.statusCode=404;return res.end();}
  let body=await readFile(resolve(ROOT,'.'+url.pathname));if(url.pathname==='/lecture-desk/app.js')body=Buffer.from(body.toString().replaceAll('https://esm.sh/@supabase/supabase-js@2','/__fixture/auth-client.js'));
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[extname(url.pathname)]);
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'");res.end(body);
 }catch(error){if(!res.writableEnded)json({error:error.message||'Synthetic error'},error.status||500);}
 });return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({server,fixture,url:`http://127.0.0.1:${server.address().port}`})));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {url}=await startDeskServer(Number(process.env.PORT||5203));console.log(`Synthetic-only: ${url}/__fixture/start`);}
