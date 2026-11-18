import { createHash } from 'node:crypto';
import { DEFAULT_SETTINGS, fail, mergeCase, normalizeSettings, uuid, validateEvent } from './lecture-desk-domain.js';
const PAGE=100;
const BUCKET='lecture-desk-files';
const MIME=new Set(['application/pdf','application/x-hwp','application/vnd.hancom.hwpx','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/wav','text/plain','text/markdown']);
function checked(r){if(r?.error)throw fail(r.error.code==='23505'?409:503,'저장소 응답을 확인하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.','storage_unavailable');return r?.data;}
function pageNo(body){const n=body.page??0;if(!Number.isInteger(n)||n<0||n>10000)throw fail(400,'목록 페이지를 확인해 주세요.');return n;}
async function admin(db,req){const auth=req.headers?.authorization;if(typeof auth!=='string'||!/^Bearer \S+$/i.test(auth)||auth.length>16384)throw fail(401,'관리자 로그인이 필요합니다.','auth_required');const a=await db.auth.getUser(auth.slice(7));if(a.error||!a.data?.user?.id)throw fail(401,'관리자 로그인을 다시 해주세요.','auth_required');const p=checked(await db.from('profiles').select('is_admin').eq('id',a.data.user.id).maybeSingle());if(p?.is_admin!==true)throw fail(403,'관리자만 사용할 수 있습니다.','forbidden');return a.data.user;}
async function baseCase(db,id){const c=checked(await db.from('proposal_cases').select('*').eq('id',uuid(id)).maybeSingle());if(!c)throw fail(404,'강의 문의를 찾을 수 없습니다.','not_found');return c;}
function withOperations(base,desk,op){const item=mergeCase(base,desk);if(!desk&&op?.checklist?.completed===true){item.desk.stage='completed';item.desk.legacy_completion=true;}return item;}
export async function handleLectureDesk(req,res,dependencies={}){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(req.method!=='POST'){res.setHeader('Allow','POST');throw fail(405,'POST 요청만 사용할 수 있습니다.');}
  const origin=req.headers?.origin;const origins=new Set(['https://bccconsulting.kr','https://www.bccconsulting.kr']);if(process.env.VERCEL_URL)origins.add(`https://${process.env.VERCEL_URL}`);
  if(origin&&!origins.has(origin)&&!(process.env.NODE_ENV!=='production'&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))throw fail(403,'BCC 관리자 화면에서 접속해 주세요.');
  const contentType=req.headers?.['content-type'];if(contentType&&!/^application\/json(?:\s*;.*)?$/i.test(contentType))throw fail(415,'JSON 요청으로 전달해 주세요.');
  let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw fail(400,'요청 형식을 확인해 주세요.');}}
  if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>3000000)throw fail(413,'요청 크기 또는 형식을 확인해 주세요.');
  const db=dependencies.db||(await import('./supabase.js')).supabaseAdmin();const user=await admin(db,req);
  if(body.action==='list'){
   const page=pageNo(body);const rows=checked(await db.from('proposal_cases').select('*').order('created_at',{ascending:false}).order('id').range(page*PAGE,(page+1)*PAGE));const cases=rows.slice(0,PAGE);const ids=cases.map(c=>c.id);
   const [states,ops]=ids.length?await Promise.all([db.from('lecture_desk_state').select('*').in('case_id',ids),db.from('lecture_operations').select('case_id,checklist,sessions').in('case_id',ids)]):[{data:[]},{data:[]}];const sm=new Map(checked(states).map(s=>[s.case_id,s]));const om=new Map(checked(ops).map(s=>[s.case_id,s]));
   return res.json({cases:cases.map(c=>withOperations(c,sm.get(c.id),om.get(c.id))),has_more:rows.length>PAGE,next_page:rows.length>PAGE?page+1:null});
  }
  if(body.action==='detail'){
   const c=await baseCase(db,body.case_id);const results=await Promise.all([
    db.from('lecture_desk_state').select('*').eq('case_id',c.id).maybeSingle(),
    db.from('lecture_desk_events').select('event_id,case_id,revision,payload,created_at').eq('case_id',c.id).order('revision',{ascending:false}).limit(200),
    db.from('proposal_outputs').select('*').eq('case_id',c.id).order('version',{ascending:false}),
    db.from('lecture_requests').select('receipt,case_id,payload,revision,created_at,updated_at').eq('case_id',c.id),
    db.from('lecture_operations').select('case_id,checklist,sessions').eq('case_id',c.id).maybeSingle(),
    db.from('lecture_desk_files').select('id,case_id,original_name,mime_type,byte_size,status,created_at').eq('case_id',c.id).order('created_at',{ascending:false})
   ]);const [s,events,outputs,requests,op,files]=results.map(checked);
   const existing=requests.length?checked(await db.from('lecture_request_attachments').select('id,receipt,original_name,mime_type,byte_size,status,created_at').in('receipt',requests.map(r=>r.receipt))):[];
   const merged=withOperations(c,s,op);return res.json({case:merged,state:merged.desk,events,events_truncated:events.length===200,outputs,requests,attachments:[...files.map(f=>({...f,source:'desk'})),...existing.map(f=>({...f,source:'request'}))]});
  }
  if(body.action==='apply'){
   const e=validateEvent(body.event);const result=checked(await db.rpc('bcc_lecture_desk_apply',{p_event:e,p_actor:user.id}));
   if(result?.error){const code=result.error;throw fail({conflict:409,forbidden:403,not_found:404,invalid:400}[code]||503,{conflict:'다른 작업에서 변경됐습니다. 최신 기록을 확인한 뒤 다시 저장해 주세요.',forbidden:'관리자만 저장할 수 있습니다.',not_found:'기존 문의를 찾을 수 없습니다.',invalid:'입력 내용을 확인해 주세요.'}[code]||'저장 결과를 확인하지 못했습니다.',code);}
   if(!result?.case_id)throw fail(503,'저장 결과를 확인하지 못했습니다.');return res.json(result);
  }
  if(body.action==='library'){
   const page=pageNo(body);const rows=checked(await db.from('proposal_knowledge').select('id,title,source_path,source_kind,content,metadata,synced_at').eq('active',true).order('synced_at',{ascending:false}).order('id').range(page*PAGE,(page+1)*PAGE));return res.json({items:rows.slice(0,PAGE),has_more:rows.length>PAGE,next_page:rows.length>PAGE?page+1:null});
  }
  if(body.action==='settings'){const row=checked(await db.from('lecture_desk_settings').select('settings').eq('id',true).maybeSingle());return res.json({settings:{...DEFAULT_SETTINGS,...row?.settings}});}
  if(body.action==='save_settings'){const settings=normalizeSettings(body.settings);checked(await db.from('lecture_desk_settings').upsert({id:true,settings,updated_at:new Date().toISOString()}));return res.json({settings});}
  if(body.action==='upload'){
   const c=await baseCase(db,body.case_id);const id=uuid(body.file_id);const name=body.name;const mime=body.mime_type;
   if(typeof name!=='string'||!name.trim()||name.length>180||/[\x00-\x1f\\/]/.test(name)||!MIME.has(mime)||typeof body.base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64))throw fail(400,'파일 이름과 형식을 확인해 주세요.');
   const bytes=Buffer.from(body.base64,'base64');if(!bytes.length||bytes.length>2097152||bytes.toString('base64')!==body.base64)throw fail(413,'파일은 2MB 이하로 전달해 주세요. 큰 녹음본은 채팅에서 처리하고 출처를 연결해 주세요.');
   const hash=createHash('sha256').update(bytes).digest('hex');let row=checked(await db.from('lecture_desk_files').select('*').eq('id',id).maybeSingle());
   if(row&&(row.case_id!==c.id||row.sha256!==hash||row.original_name!==name||row.mime_type!==mime))throw fail(409,'같은 파일 ID에 다른 내용이 있습니다.');
   if(row?.status==='ready')return res.json({file:{id,case_id:c.id,original_name:name,mime_type:mime,byte_size:bytes.length,status:'ready'},replayed:true});
   if(!row){row={id,case_id:c.id,original_name:name,mime_type:mime,byte_size:bytes.length,sha256:hash,object_path:`${c.id}/${id}`,status:'pending'};checked(await db.from('lecture_desk_files').insert(row));}
   const stored=await db.storage.from(BUCKET).upload(row.object_path,bytes,{contentType:mime,upsert:false});
   if(stored.error){const previous=await db.storage.from(BUCKET).download(row.object_path);if(previous.error||createHash('sha256').update(Buffer.from(await previous.data.arrayBuffer())).digest('hex')!==hash)throw fail(503,'파일 업로드를 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.');}
   checked(await db.from('lecture_desk_files').update({status:'ready'}).eq('id',id));return res.json({file:{id,case_id:c.id,original_name:name,mime_type:mime,byte_size:bytes.length,status:'ready'},replayed:false});
  }
  if(body.action==='download'){
   const c=await baseCase(db,body.case_id);const row=checked(await db.from('lecture_desk_files').select('*').eq('id',uuid(body.file_id)).eq('case_id',c.id).eq('status','ready').maybeSingle());if(!row)throw fail(404,'파일을 찾을 수 없습니다.');
   const downloaded=checked(await db.storage.from(BUCKET).download(row.object_path));const bytes=Buffer.from(await downloaded.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw fail(503,'파일 내용 검증에 실패했습니다.');
   res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);return res.end(bytes);
  }
  throw fail(400,'지원하지 않는 작업입니다.');
 }catch(error){return res.status(error.status||503).json({error:error.status?error.message:'처리하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.',code:error.code||'unavailable'});}
}
