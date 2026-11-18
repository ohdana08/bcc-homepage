export const KINDS = ['inquiry','update','proposal_ready','proposal_sent','scheduled','plan_received','photos_received','recording_received','blog_written'];
export const DEFAULT_SETTINGS = Object.freeze({contact_phone:'',contact_email:'',kakao_url:'https://pf.kakao.com/_xbrxjxkxj/chat',inquiry_cta:'강의 문의는 카카오톡 채널로 편하게 남겨주세요.'});
export const FIELD_NAMES = ['institution_name','project_name','topic','audience','region','delivery_format','duration_hours','lecture_date','followup_on','contact_name','contact_email','contact_phone','next_action'];
export function fail(status,message,code='invalid'){return Object.assign(new Error(message),{status,code});}
export function uuid(value){if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw fail(400,'올바른 기록 ID가 필요합니다.');return value;}
export function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fail(400,'날짜는 실제 날짜의 YYYY-MM-DD 형식이어야 합니다.');return value;}
export function object(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}
export function validateEvent(e){
 if(!object(e)||JSON.stringify(e).length>180000)throw fail(400,'문의 자료 크기 또는 형식을 확인해 주세요.');
 const allowed=['event_id','case_id','expected_revision','kind','occurred_on','source_ref','raw_text','fields','prepared'];
 if(Object.keys(e).some(k=>!allowed.includes(k)))throw fail(400,'지원하지 않는 이벤트 항목입니다.');
 uuid(e.event_id); if(e.case_id!==null&&e.case_id!==undefined)uuid(e.case_id);
 if(!Number.isInteger(e.expected_revision)||e.expected_revision<0)throw fail(400,'현재 기록 버전이 필요합니다.');
 if(!KINDS.includes(e.kind))throw fail(400,'지원하지 않는 처리 단계입니다.');date(e.occurred_on);
 if(typeof e.source_ref!=='string'||!e.source_ref.trim()||e.source_ref.length>1000)throw fail(400,'문의의 출처를 입력해 주세요.');
 if(typeof e.raw_text!=='string'||e.raw_text.length>60000)throw fail(400,'원문은 60,000자까지 저장할 수 있습니다.');
 if(!object(e.fields)||Object.keys(e.fields).some(k=>!FIELD_NAMES.includes(k)))throw fail(400,'지원하지 않는 문의 항목입니다.');
 for(const [key,value] of Object.entries(e.fields)){
  if(value===null)continue;
  if(key==='duration_hours'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000)throw fail(400,'강의 시간을 확인해 주세요.');}
  else if(['lecture_date','followup_on'].includes(key)){if(value!=='')date(value);}
  else if(typeof value!=='string'||value.length>4000)throw fail(400,'문의 항목은 4,000자 이하의 글자여야 합니다.');
 }
 if(e.prepared!==undefined){
  if(!object(e.prepared)||JSON.stringify(e.prepared).length>80000)throw fail(400,'준비한 결과물 형식을 확인해 주세요.');
  if(Object.keys(e.prepared).some(k=>!['summary','questions','recommendation','email_subject','email_body','proposal_text','materials','next_action'].includes(k)))throw fail(400,'지원하지 않는 결과물 항목입니다.');
  for(const [k,v] of Object.entries(e.prepared)){
   if(k==='questions'){if(!Array.isArray(v)||v.length>50||v.some(x=>typeof x!=='string'||x.length>2000))throw fail(400,'확인 질문 형식을 확인해 주세요.');}
   else if(k==='materials'){if(!Array.isArray(v)||v.length>100||v.some(x=>!object(x)||Object.keys(x).some(k=>!['title','url','source'].includes(k))||Object.values(x).some(y=>typeof y!=='string'||y.length>2000)||x.url&&!/^https:\/\//.test(x.url)))throw fail(400,'자료에는 제목·출처와 https 주소를 사용해 주세요.');}
   else if(typeof v!=='string'||v.length>30000)throw fail(400,'결과물 문장을 확인해 주세요.');
  }
 }
 if(!e.case_id&&(e.kind!=='inquiry'||e.expected_revision!==0||!e.fields.institution_name?.trim()||!e.raw_text.trim()))throw fail(400,'새 문의에는 기관명과 문의 원문이 필요합니다.');
 if(e.kind==='proposal_ready'&&(!e.prepared||!['email_body','proposal_text','recommendation'].some(k=>typeof e.prepared[k]==='string'&&e.prepared[k].trim())))throw fail(400,'준비한 제안 내용을 함께 저장해 주세요.');
 return e;
}
export const normalizeEvent = validateEvent;
export function mergeCase(base,desk){return {...base,...(desk?.fields||{}),desk:desk||{case_id:base.id,revision:0,stage:base.status==='lost'?'closed':base.status==='on_hold'?'on_hold':base.status==='won'?'confirmed':['sent','waiting'].includes(base.status)?'waiting':['drafted','reviewing'].includes(base.status)?'proposal_ready':'inquiry',fields:{},prepared:{},prepared_stale:false,proposal_pending:false,followup_on:(base.next_action_at&&!Number.isNaN(Date.parse(base.next_action_at))?new Date(Date.parse(base.next_action_at)+9*3600000).toISOString().slice(0,10):null),followup_suggested:false,actual_lecture_date:null,milestones:{},updated_at:base.updated_at}};}
export function normalizeSettings(s){
 if(!object(s)||Object.keys(s).some(k=>!Object.hasOwn(DEFAULT_SETTINGS,k)))throw fail(400,'연락처 설정을 확인해 주세요.');
 const result={...DEFAULT_SETTINGS,...s};
 if(Object.values(result).some(v=>typeof v!=='string'||v.length>1000))throw fail(400,'연락처 설정이 너무 깁니다.');
 if(result.contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contact_email))throw fail(400,'이메일 형식을 확인해 주세요.');
 if(result.kakao_url&&!/^https:\/\/pf\.kakao\.com\/[A-Za-z0-9_\/-]+$/.test(result.kakao_url))throw fail(400,'카카오톡 채널 주소를 확인해 주세요.');
 return result;
}
