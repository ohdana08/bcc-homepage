'use strict';
(async()=>{
 const $=id=>document.getElementById(id), msg=text=>{$('status').textContent=text;};
 const storage=sessionStorage, params=new URLSearchParams(location.search);
 const key='bcc-mentoring-flow', pk='bcc-mentoring-pkce', flow=params.get('flow')||storage.getItem(key);
 if(!/^[\w-]{43}$/.test(flow||'')){msg('수업결과물의 입장 버튼을 눌러 시작해주세요.');return;}
 if(params.has('flow')){storage.setItem(key,flow);storage.removeItem(pk);}
 const authCode=params.get('code');
 history.replaceState(null,'',location.pathname);
 const callback=location.origin+'/admin.html';
 const config=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
 const api=(path)=>new URL('/auth/v1/'+path,config.supabaseUrl);
 const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 let token='';
 async function signIn(grant,values){
  const url=api('token');url.searchParams.set('grant_type',grant);
  const response=await fetch(url,{method:'POST',headers:{apikey:config.supabaseAnonKey,'Content-Type':'application/json'},body:JSON.stringify(values)});
  if(!response.ok) throw Error('본인 확인에 실패했습니다. 계정 정보를 확인하거나 입장을 다시 시작해주세요.');
  const data=await response.json(); token=data.access_token;
  $('methods').hidden=true;$('account').textContent=data.user.email+' 계정으로 확인했습니다.';
  msg('내 작업공간을 열고 있습니다.');
  if(await enter(''))return;
  $('invitation').hidden=false;msg('');$('invite').focus();
 }
 $('google').onclick=async()=>{
  try{const verifier=b64(crypto.getRandomValues(new Uint8Array(48)));storage.setItem(pk,verifier);
   const url=api('authorize');url.search=new URLSearchParams({provider:'google',redirect_to:callback,code_challenge:b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),code_challenge_method:'s256',prompt:'select_account'});location.assign(url);
  }catch{msg('Google 인증을 시작할 수 없습니다. 입장을 다시 시작해주세요.');}
 };
 $('password-form').onsubmit=async e=>{e.preventDefault();const pw=$('pw').value;$('pw').value='';try{await signIn('password',{email:$('email').value.trim(),password:pw});}catch(err){msg(err.message);}};
 async function enter(code){
   const res=await fetch('/api/mentoring-entry',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({flow,code})});
   const body=await res.json();
   if(res.status===403 && !code)return false;
   if(!res.ok)throw Error(body.error||'입장 정보를 확인해주세요.');
   if(new URL(body.redeem_url).origin!=='https://bcc-modu-mentoring.vercel.app')throw Error('작업공간 주소를 확인해주세요.');
   const form=document.createElement('form');form.action=body.redeem_url;form.method='POST';const input=document.createElement('input');input.type='hidden';input.name='ticket';input.value=body.ticket;form.append(input);document.body.append(form);
   $('invite').value='';storage.removeItem(key);storage.removeItem(pk);token='';form.submit();return true;
 }
 $('invitation').onsubmit=async e=>{
  e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;
  try{await enter($('invite').value.trim());
  }catch(err){msg(err.message);btn.disabled=false;}
 };
 $('methods').hidden=false;msg('');
 if(authCode){const verifier=storage.getItem(pk);storage.removeItem(pk);if(!verifier){msg('인증을 시작한 브라우저에서 다시 진행해주세요.');return;}
  try{await signIn('pkce',{auth_code:authCode,code_verifier:verifier});}catch(err){msg(err.message);}}
})().catch(()=>{document.getElementById('status').textContent='접속 정보를 확인하기 어렵습니다. 입장을 다시 시작해주세요.';});
