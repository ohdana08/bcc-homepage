// LOCAL SYNTHETIC HARNESS ONLY. Never connects to production or reads credentials.
import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryDb, ADMIN_ID, ADMIN_TOKEN } from './lecture-request-local-server.mjs';
import { handleTrainingNeedsPublic, handleTrainingNeedsAdmin, isSurveyOpen } from '../lib/training-needs.js';
import { normalizeExperienceAnswers, EXPERIENCE_SCHEMA } from '../lib/ai-experience-card.js';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const SURVEY_A='10000000-0000-4000-8000-000000000001';
export const SURVEY_B='20000000-0000-4000-8000-000000000002';
const now=new Date().toISOString();
export function createExperienceFixture(){
  return createMemoryDb({tables:{
    training_need_surveys:[
      {id:SURVEY_A,public_code:'LOCALGOS',title:'AI 콘텐츠 제작 · 합성 검토',institution_label:'QA 가상 고성 교육기관',audience_label:'교육생 20명',lecture_date:'2026-11-26',expected_response_count:20,response_deadline:null,status:'open',is_sample:true,created_by:ADMIN_ID,created_at:now,analysis:{}},
      {id:SURVEY_B,public_code:'LOCALB',title:'AI 업무 활용 · 합성 검토',institution_label:'QA 가상 두 번째 기관',audience_label:'재직자',response_deadline:null,status:'open',is_sample:true,created_by:ADMIN_ID,created_at:now,analysis:{}},
    ],
    training_need_responses:[
      {id:'1',survey_id:SURVEY_A,idempotency_key:'30000000-0000-4000-8000-000000000001',submitted_at:now,answers:{current_context:['office_admin'],ai_experience:'simple_questions',ai_tool_access:['chatgpt:free'],work_tasks:['documents'],pain_points:['what_to_ask'],desired_topics:['prompt_basics'],desired_outputs:['work_document'],learning_methods:['step_by_step'],others:{},open_question:'합성 기존 응답입니다.'}},
      {id:'2',survey_id:SURVEY_A,idempotency_key:'30000000-0000-4000-8000-000000000002',submitted_at:now,answers:normalizeExperienceAnswers({schema_version:EXPERIENCE_SCHEMA,experience_tasks:['image'],creation_process:['direct','revise'],desired_work:['video'],support_needs:['visual'],desired_detail:'가상의 지역 홍보 영상을 만들고 싶어요.'}).answers},
      {id:'3',survey_id:SURVEY_B,idempotency_key:'30000000-0000-4000-8000-000000000003',submitted_at:now,answers:normalizeExperienceAnswers({schema_version:EXPERIENCE_SCHEMA,experience_tasks:['none'],desired_work:['documents'],support_needs:['files']}).answers},
    ],training_need_attachments:[],
  },rpcHandlers:{submit_ai_experience_card(p,tables){
    const survey=tables.training_need_surveys.find(s=>s.id===p.p_survey_id);
    const fail=message=>({data:null,error:{message}});
    if(!survey)return fail('SURVEY_NOT_FOUND');
    const existing=tables.training_need_responses.find(r=>r.survey_id===p.p_survey_id&&r.idempotency_key===p.p_key);
    if(existing){if(JSON.stringify(existing.answers)!==JSON.stringify(p.p_answers))return fail('IDEMPOTENCY_CONFLICT');return{data:{ok:true,duplicate:true,response_id:existing.id,answers:existing.answers},error:null};}
    if(!isSurveyOpen(survey))return fail('SURVEY_CLOSED');
    const cap=survey.expected_response_count?Math.max(50,Math.min(2000,survey.expected_response_count*4)):500;
    if(tables.training_need_responses.filter(r=>r.survey_id===survey.id).length>=cap)return fail('RESPONSE_CAP');
    const id=String(Math.max(0,...tables.training_need_responses.map(r=>Number(r.id)))+1);
    tables.training_need_responses.push({id,survey_id:survey.id,idempotency_key:p.p_key,answers:structuredClone(p.p_answers),submitted_at:new Date().toISOString()});
    if(p.p_attachment)tables.training_need_attachments.push({response_id:id,survey_id:survey.id,...structuredClone(p.p_attachment)});
    return{data:{ok:true,duplicate:false,response_id:id,answers:p.p_answers},error:null};
  }}});
}
export function createExperienceServer(){
  const db=createExperienceFixture();
  const server=http.createServer(async(req,res)=>{
    res.status=n=>{res.statusCode=n;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Synthetic-Only','true');
    try{
      if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin))return res.status(403).json({error:'Local synthetic harness only'});
      if(url.pathname==='/api/config')return res.json({supabaseUrl:origin,supabaseAnonKey:'synthetic-public'});
      if(url.pathname==='/api/my-enrollments')return req.headers.authorization===`Bearer ${ADMIN_TOKEN}`?res.json({profile:{is_admin:true}}):res.status(401).json({error:'Synthetic auth required'});
      if(url.pathname==='/api/cardnews-generate'){
        const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1600000)return res.status(413).json({error:'too large'});chunks.push(chunk);}try{req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{return res.status(400).json({error:'invalid json'});}
        if(req.body.engine==='training_needs_public')return await handleTrainingNeedsPublic(req,res,{db});
        if(req.body.engine==='training_needs_admin')return await handleTrainingNeedsAdmin(req,res,{db,client:null});
        return res.status(400).json({error:'Unknown synthetic route'});
      }
      if(url.pathname==='/__fixture/auth-client.js'){
        res.setHeader('Content-Type','text/javascript');return res.end(`export function createClient(){const session={access_token:'${ADMIN_TOKEN}',user:{id:'${ADMIN_ID}'}};return{auth:{async getSession(){return{data:{session}}},async refreshSession(){return{data:{session}}},onAuthStateChange(){return{}}}};}`);
      }
      if(url.pathname==='/__fixture/start'){
        res.setHeader('Content-Type','text/html;charset=utf-8');return res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><h1>AI 경험 카드 · 로컬 합성 검토</h1><p>실제 기관·교육생·계정과 연결되지 않습니다.</p><ul><li><a href="/tools/training-needs/?form=LOCALGOS">첫 번째 기관 설문</a></li><li><a href="/tools/training-needs/?form=LOCALB">두 번째 기관 설문</a></li><li><a href="/admin-training-needs.html">합성 관리자</a></li></ul></html>');
      }
      if(url.pathname==='/__fixture/mobile'){
        res.setHeader('Content-Type','text/html;charset=utf-8');return res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{background:#ddd;font-family:system-ui}iframe{width:390px;height:844px;border:0}</style><h1>390px 합성 모바일 표시</h1><iframe title="모바일 설문" src="/tools/training-needs/?form=LOCALGOS"></iframe></html>');
      }
      if(url.pathname==='/pay-config.js'){res.setHeader('Content-Type','text/javascript');return res.end('// Synthetic local harness: no remote config.');}
      const allowed=['/tools/training-needs/index.html','/tools/training-needs/app.js','/tools/training-needs/style.css','/admin-training-needs.html','/logo.png'];
      const route=url.pathname==='/tools/training-needs/'?'/tools/training-needs/index.html':url.pathname;
      if(!allowed.includes(route))return res.status(404).end();
      const path=await realpath(resolve(ROOT,'.'+route));if(!path.startsWith(ROOT+sep))return res.status(404).end();
      let body=await readFile(path);if(route==='/admin-training-needs.html')body=Buffer.from(body.toString().replaceAll('https://esm.sh/@supabase/supabase-js@2','/__fixture/auth-client.js'));
      res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.png':'image/png'})[extname(path)]||'text/plain');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");res.end(body);
    }catch(error){if(!res.writableEnded)res.status(error.httpStatus||500).json({error:error.httpStatus?error.message:'Synthetic harness failure'});}
  });
  return{server,db};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {server}=createExperienceServer();server.listen(Number(process.env.PORT||8786),'127.0.0.1',()=>console.log(`Synthetic AI experience card: http://127.0.0.1:${server.address().port}/__fixture/start`));
}
