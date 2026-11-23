const $=id=>document.getElementById(id);
let client, owner, epoch=0, busy=false;
const statusText=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
function clearPrivate() {
  epoch++;owner=null;$('results').replaceChildren();$('results-status').textContent='';$('workspace').hidden=true;$('slots').replaceChildren();$('login').hidden=false;
}
function showSlots(slots) {
  const fragment=document.createDocumentFragment();
  for (const item of slots) {
    const form=document.createElement('form');form.className='slot';form.autocomplete='off';
    const heading=document.createElement('h2');heading.textContent='참여자 '+item.slot;
    const badge=document.createElement('small');
    const status={empty:'등록 가능',active:'본인 인증 완료',invited:'이메일 등록 완료'};
    badge.textContent=status[item.status];
    form.append(heading,badge);
    const field=(type,label,value)=>{
      const wrap=document.createElement('label');wrap.textContent=label;
      const el=document.createElement('input');el.type=type;el.required=true;el.value=value||'';
      el.readOnly=item.status!=='empty';el.maxLength=type==='email'?254:80;wrap.append(el);form.append(wrap);return el;
    };
    const name=field('text','대표 이름',item.name), email=field('email','인증 이메일',item.email);
    if(item.status==='empty') {
      const submit=document.createElement('button');submit.type='submit';submit.className='issue';
      submit.textContent='이메일 등록';form.append(submit);
      form.onsubmit=event=>{
        event.preventDefault();
        action(async()=>{
          
          const created=await call('POST',{slot:item.slot,name:name.value.trim(),email:email.value.trim()});
          if(!created)return;
          await reload();statusText('이메일을 등록했습니다.');
        });
      };
    }
    fragment.append(form);
  }
  $('slots').replaceChildren(fragment);
}
async function call(method,data) {
  const captured=epoch;
  const {data:{session},error}=await client.auth.getSession();
  if(captured!==epoch)return null;
  if(error||!session||session.user.id!==owner){clearPrivate();throw new Error('관리자 계정으로 다시 로그인해주세요.');}
  const response=await fetch('/api/mentoring-admin',{method,credentials:'same-origin',cache:'no-store',
    headers:{Authorization:'Bearer '+session.access_token,...(data?{'Content-Type':'application/json'}:{})},
    ...(data?{body:JSON.stringify(data)}:{})});
  const result=await response.json().catch(()=>({}));
  if(captured!==epoch)return null;
  if(!response.ok){
    if([401,403].includes(response.status))clearPrivate();
    throw new Error(result.error||'요청을 처리하지 못했습니다.');
  }
  return result;
}
function showResults(result, slots) {
  const panel=$('results');
  panel.replaceChildren();
  if (!result) {
    const entered=slots.filter(slot=>slot.expires_at).length;
    $('results-status').textContent=entered<3
      ? '첫 입장 '+entered+'/3명 · 세 대표가 각자 7일을 사용한 뒤 결과가 생성됩니다.'
      : '세 대표의 이용 종료 후 10분 이내에 결과가 생성됩니다.';
    return;
  }
  $('results-status').textContent='수업이 종료되었습니다. 홈페이지용 사례는 공개 전 검토용 초안입니다.';
  for (const [label,content] of [['멘토용 결과표',result.mentor_report],['홈페이지 수업 사례 초안',result.gallery_draft]]) {
    const section=document.createElement('section');
    const heading=document.createElement('h3');heading.textContent=label;
    const body=document.createElement('p');body.style.whiteSpace='pre-wrap';body.textContent=content;
    const download=document.createElement('button');download.type='button';download.textContent=label+' 내려받기';
    download.onclick=()=>{
      const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/plain;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=label+'.txt';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    section.append(heading,body,download);panel.append(section);
  }
}
async function reload() {
  const result=await call('GET');if(!result)return;
  showSlots(result.slots);showResults(result.result,result.slots);$('workspace').hidden=false;$('login').hidden=true;
}
async function action(work) {
  if(busy)return;busy=true;
  document.querySelectorAll('.issue,#refresh').forEach(el=>el.disabled=true);
  try {await work();}catch(error){statusText(error.message||'요청을 처리하지 못했습니다.',true);}
  finally{busy=false;document.querySelectorAll('.issue,#refresh').forEach(el=>el.disabled=false);}
}
$('refresh').onclick=()=>action(async()=>{await reload();statusText('등록 상태를 불러왔습니다.');});
window.addEventListener('pagehide',clearPrivate);
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
async function init() {
  try {
    const config=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
    const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.108.2');
    client=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,storage:window.bccBrowserSession}});
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||(owner&&session?.user?.id!==owner)){clearPrivate();statusText('관리자 로그인이 필요합니다.');}
    });
    const {data:{session}}=await client.auth.getSession();
    if(!session){clearPrivate();statusText('BCC 관리자 로그인이 필요합니다.');return;}
    owner=session.user.id;await reload();if(owner)statusText('등록할 참여자의 이메일과 이름을 확인해주세요.');
  }catch(error){clearPrivate();statusText(error.message||'관리자 화면을 열 수 없습니다.',true);}
}
init();
