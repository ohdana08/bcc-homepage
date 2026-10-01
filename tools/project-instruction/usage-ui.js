import { USAGE_VERSION, buildUsageInstruction, buildUsageEnvironment } from './usage-kit.js';
const API='/api/project-instruction-usage';
const $=id=>document.getElementById(id);
const KEY='bcc-pi-usage-keys-v1';
const validAuth=a=>a && /^[0-9a-f-]{36}$/i.test(a.id||'') && /^[a-f0-9]{64}$/i.test(a.receiptToken||'');
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function initUsage({getDocument}) {
  let auth=null, detail=null, busy=false, sequence=0, readSequence=0, pendingLoad=false, keys={};
  try{const stored=JSON.parse(sessionStorage.getItem(KEY));if(stored && typeof stored==='object' && !Array.isArray(stored))keys=stored;}catch{}
  function persist(){try{sessionStorage.setItem(KEY,JSON.stringify(keys));}catch{}}
  function token(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function message(text){$('usage-status').textContent=text;}
  function render(){
    const c=detail?.connection, active=!!c&&!c.revokedAt;
    $('usage-enable').disabled=busy||!auth||!!c||!['usage-consent','usage-overseas','usage-own'].every(id=>$(id).checked);
    ['usage-consent','usage-overseas','usage-own'].forEach(id=>$(id).disabled=busy||!!c);
    $('usage-download').disabled=busy||!active;
    $('usage-config').disabled=busy||!active||!keys[auth?.id]?.token||keys[auth?.id]?.generation!==c?.generation;
    $('usage-rotate').disabled=busy||!active;
    $('usage-revoke').disabled=busy||!active;
    $('usage-refresh').disabled=busy||!auth;
    if(!auth)return;
    $('usage-identity').textContent='제출 확인번호: '+auth.id;
    $('usage-summary').textContent=!c?'아직 연결하지 않았습니다.':c.revokedAt?'사용 기록 동의를 철회했습니다. 기존 기록을 삭제했고, 앞으로 전송되는 기록도 받지 않습니다. 새로 동의하려면 업무지시서를 새로 제출해 주세요.':`연동 설정 준비됨 · 보관 종료 ${new Date(c.expiresAt).toLocaleString('ko-KR')}\n시험 기록 ${detail.stats?.testCount||0}건 · 실제 사용 기록 ${detail.stats?.liveCount||0}건\n${detail.stats?.liveCount?'제작 도구가 보고한 실제 사용 기록이 있습니다.':'실제 사용 기록이 아직 없습니다. 개발 도구에서 기능을 구현하고 연결을 확인해 주세요.'}`;
  }
  async function request(action,extra={},owner=auth){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(API+'?action='+action,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...owner,...extra}),signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'요청을 완료하지 못했습니다. 다시 확인해 주세요.');
      return data;
    }catch(error){if(error.name==='AbortError'||error instanceof TypeError)throw new Error('응답을 확인하지 못했습니다. 상태를 다시 확인하거나 같은 요청으로 재시도해 주세요.');throw error;}
    finally{clearTimeout(timer);}
  }
  async function load(ctx){
    if(!ctx.owner)return;const read=++readSequence;
    const data=await request('status',{},ctx.owner);
    if(!Object.hasOwn(data,'connection') || !data.stats)throw new Error('연결 상태 응답을 확인하지 못했습니다.');
    if(!ctx.current()||read!==readSequence)return data;
    detail=data;
    if(data.connection?.revokedAt){delete keys[ctx.owner.id];persist();}
    render();return data;
  }
  async function act(fn){
    if(busy)return;
    const owner=auth?{...auth}:null,epoch=sequence;
    const ctx={owner,current:()=>sequence===epoch&&auth?.id===owner?.id};
    busy=true;render();
    try{await fn(ctx);}catch(error){if(ctx.current())message(error.message);}
    finally{busy=false;render();if(pendingLoad&&auth){pendingLoad=false;act(async next=>{await load(next);if(next.current())message('선택 동의와 사용 기록 상태를 확인하세요.');});}}
  }
  for(const id of ['usage-consent','usage-overseas','usage-own'])$(id).addEventListener('change',render);
  $('usage-enable').addEventListener('click',()=>act(async ctx=>{
    if(!auth||detail?.connection||!['usage-consent','usage-overseas','usage-own'].every(id=>$(id).checked))return;
    const current=keys[ctx.owner.id]||{token:token(),generation:1};keys[ctx.owner.id]=current;persist();
    await request('enable',{writeToken:current.token,consent:{version:USAGE_VERSION,usage:true,overseas:true,ownUse:true,age14:true}},ctx.owner);
    await load(ctx);if(ctx.current())message('연동용 업무지시서와 설정 파일을 받으세요. 실제 도구에서 구현한 뒤 상태를 확인할 수 있습니다.');
  }));
  $('usage-refresh').addEventListener('click',()=>act(async ctx=>{await load(ctx);if(ctx.current())message('최신 수신 상태를 확인했습니다. 시험 기록은 실제 사용 통계에 포함하지 않습니다.');}));
  $('usage-rotate').addEventListener('click',()=>act(async ctx=>{
    if(!detail?.connection||detail.connection.revokedAt)return;
    if(!window.confirm('기존 연동 설정을 무효화하고 새 설정을 만들까요? 사용 중인 도구에도 새 설정 파일을 적용해야 합니다.'))return;
    let next=keys[ctx.owner.id]?.rotation;
    if(!next||next.expectedGeneration!==detail.connection.generation)next={token:token(),expectedGeneration:detail.connection.generation};
    keys[ctx.owner.id]={...(keys[ctx.owner.id]||{}),rotation:next};persist();
    const rotated=await request('rotate',{writeToken:next.token,expectedGeneration:next.expectedGeneration},ctx.owner);
    if(rotated.connection?.generation!==next.expectedGeneration+1)throw new Error('설정 교체 응답을 확인하지 못했습니다. 상태를 확인해 주세요.');
    keys[ctx.owner.id]={token:next.token,generation:rotated.connection.generation};persist();await load(ctx);if(ctx.current())message('새 설정을 만들었습니다. 설정 파일을 다시 받아 도구 서버에 적용하세요.');
  }));
  $('usage-revoke').addEventListener('click',()=>act(async ctx=>{
    if(!detail?.connection||detail.connection.revokedAt)return;
    if(!window.confirm('사용 기록 수집을 중단하고 기존 사용 기록을 삭제할까요? 제출한 업무지시서는 유지됩니다.'))return;
    await request('revoke',{},ctx.owner);delete keys[ctx.owner.id];persist();await load(ctx);if(ctx.current())message('사용 기록 동의를 철회했습니다. 업무지시서와 별도 사례 동의는 유지됩니다.');
  }));
  $('usage-download').addEventListener('click',()=>{if(!detail?.connection||detail.connection.revokedAt)return;download(buildUsageInstruction(getDocument(auth.id)||'# 기존 업무지시서에 아래 요구사항을 추가해 주세요.\n',auth.id,detail.connection.expiresAt),'AI_업무지시서_사용기록연동.md');});
  $('usage-config').addEventListener('click',()=>{if(!detail?.connection||detail.connection.revokedAt||keys[auth.id]?.generation!==detail.connection.generation)return;download(buildUsageEnvironment(auth.id,keys[auth.id].token),'BCC_사용기록_연동설정.env');message('설정 파일은 로컬 프로젝트나 배포 서버에 보관하세요. AI 채팅이나 공개 저장소에 붙여넣지 마세요.');});
  $('check-usage').addEventListener('click',()=>{
    if(busy)return;
    const next={id:$('receipt-id').value.trim(),receiptToken:$('receipt-token').value.trim()};
    if(!validAuth(next)){ $('receipt-status').textContent='확인번호와 관리키를 먼저 입력해 주세요.';return; }
    ['usage-consent','usage-overseas','usage-own'].forEach(id=>$(id).checked=false);
    sequence++;auth=next;detail=null;
    act(async ctx=>{await load(ctx);if(!ctx.current())return;$('usage-section').hidden=false;message('선택 동의와 사용 기록 상태를 확인하세요.');$('usage-section').scrollIntoView({behavior:'smooth'});});
  });
  return {
    setReceipt(value){
      if(!validAuth(value))return;sequence++;auth={...value};detail=null;$('usage-section').hidden=false;
      ['usage-consent','usage-overseas','usage-own'].forEach(id=>$(id).checked=false);
      if(busy){pendingLoad=true;render();return;}
      act(async ctx=>{await load(ctx);if(ctx.current())message('원하면 만든 도구의 본인 사용 기록을 남길 수 있어요. 동의하지 않아도 업무지시서를 사용할 수 있습니다.');});
    },
    clear(id){if(id){delete keys[id];persist();}if(!id||auth?.id===id){sequence++;auth=null;detail=null;pendingLoad=false;$('usage-section').hidden=true;}},
  };
}
