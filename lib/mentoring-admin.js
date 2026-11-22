import { requireAdmin } from './project-instruction/handler.js';

const errors = {
  400:'대표 이름, 이메일과 등록 위치를 확인해주세요.',
  401:'BCC 관리자 로그인이 필요합니다.',
  403:'BCC 관리자만 참여자를 등록할 수 있습니다.',
  405:'지원하지 않는 요청 방식입니다.',
  409:'참여자가 이미 활성화되었거나 등록 정보가 달라졌습니다. 최신 상태를 확인해주세요.',
  429:'잠시 후 다시 시도해주세요.',
  503:'멘토링 작업공간 연결을 확인해주세요.',
};
function fail(status) { throw Object.assign(new Error(),{status}); }
function upstreamConfig(env) {
  const origin=new URL(env.MENTORING_ORIGIN);
  if (origin.protocol!=='https:' || origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname!=='/' || !env.MENTORING_ADMIN_SECRET || env.MENTORING_ADMIN_SECRET.length<32) fail(503);
  return {origin:origin.origin,secret:env.MENTORING_ADMIN_SECRET};
}
function readRegistration(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type']||'')) fail(400);
  let input=req.body;
  if (typeof input==='string') { if(input.length>2000) fail(400); try {input=JSON.parse(input);} catch {fail(400);} }
  const {slot,name,email}=input||{};
  if (![1,2,3].includes(slot) || typeof name!=='string' || !name.trim() || name.trim().length>80 ||
      /[\u0000-\u001f\u007f]/.test(name) || typeof email!=='string' || email.trim().length>254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim())) fail(400);
  return {slot,name:name.trim(),email:email.trim().toLowerCase()};
}
function publicSlot(item) {
  if(!item || ![1,2,3].includes(item.slot) || !['empty','invited','active'].includes(item.status)) fail(503);
  return {slot:item.slot,status:item.status,name:String(item.name||''),email:String(item.email||''),expires_at:item.expires_at||null};
}
export async function handleMentoringAdmin(req,res,dependencies={}) {
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('Vercel-CDN-Cache-Control','no-store');
  res.setHeader('Vary','Authorization');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  try {
    if (!['GET','POST'].includes(req.method)) {res.setHeader('Allow','GET, POST');fail(405);}
    if (!req.headers?.authorization) fail(401);
    const db=dependencies.db || (await import('./supabase.js')).supabaseAdmin();
    await requireAdmin(db,req);
    const {origin,secret}=upstreamConfig(dependencies.env||process.env);
    const input=req.method==='POST'?readRegistration(req):null;
    const path='/internal/admin/mentoring/slots'+(input?'/'+input.slot:'');
    const response=await (dependencies.fetch||fetch)(origin+path,{
      method:req.method,headers:{Authorization:'Bearer '+secret,...(input?{'Content-Type':'application/json'}:{})},
      ...(input?{body:JSON.stringify({name:input.name,email:input.email})}:{}),
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)
    });
    if (!response.ok) fail([400,409,429].includes(response.status)?response.status:503);
    const data=await response.json();
    if(input) {
      if(data.slot!==input.slot) fail(503);
      return res.status(200).json({slot:input.slot});
    }
    if (!Array.isArray(data.slots) || data.slots.length!==3) fail(503);
    const slots=data.slots.map(publicSlot).sort((a,b)=>a.slot-b.slot);
    if (new Set(slots.map(slot=>slot.slot)).size!==3) fail(503);
    return res.status(200).json({slots});
  } catch(error) {
    const status=Object.hasOwn(errors,error.status)?error.status:503;
    return res.status(status).json({error:errors[status]});
  }
}
