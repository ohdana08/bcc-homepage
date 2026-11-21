import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import \{ createClient \} from '[^']+';/, '');
async function harness({session=null, admin=false, oauthError=null, protocol='https:', hash='', search='', permissionFailure=false, sessionWait=null}={}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set(id==='hubView'?['hidden']:[]);
      nodes.set(id, {value:'', textContent:'', disabled:['googleBtn','loginBtn'].includes(id), handlers:{}, classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(){}}, addEventListener(type,cb){this.handlers[type]=cb},focus(){}});
    }
    return nodes.get(id);
  }
  const calls = {oauth:[],signout:[],fetch:[],redirect:[],history:[]};
  const sb = {auth:{getSession:async()=>{if(sessionWait)await sessionWait;return {data:{session},error:null}},signOut:async opts=>{calls.signout.push(opts);return {error:null}},signInWithOAuth:async opts=>{calls.oauth.push(opts);return {error:oauthError}},signInWithPassword:async()=>({data:{session:{access_token:'password-session'}}}),resetPasswordForEmail:async()=>({error:null})}};
  const context = vm.createContext({URL,URLSearchParams,window:{BCC_API_BASE:'https://bccconsulting.kr',localStorage:{}},location:{protocol,search,hash,pathname:'/admin.html',href:'https://bccconsulting.kr/admin.html',assign:x=>calls.redirect.push(x),reload(){}},history:{replaceState:(_a,_b,url)=>calls.history.push(url)},document:{getElementById:node,querySelectorAll:()=>[]},createClient:()=>sb,fetch:async(url,opts)=>{calls.fetch.push([url,opts]);if(url.endsWith('/api/config'))return {json:async()=>({supabaseUrl:'https://auth.example',supabaseAnonKey:'public-test'})};if(permissionFailure)throw Error('network');return {ok:true,json:async()=>({profile:{is_admin:admin}})};}});
  vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {node,calls,click:async id=>node(id).handlers.click(),submit:async()=>node('loginForm').handlers.submit({preventDefault(){}})};
}

test('Google login requests only Google auth and returns to the fixed production admin page',async()=>{
  const h=await harness(); await h.click('googleBtn');
  assert.equal(h.calls.oauth.length,1);
  assert.equal(h.calls.oauth[0].provider,'google');
  assert.equal(h.calls.oauth[0].options.redirectTo,'https://bccconsulting.kr/admin.html');
  assert.equal(h.calls.oauth[0].options.queryParams.prompt,'select_account');
  assert.equal(h.calls.oauth[0].options.scopes,undefined);
  assert.equal(h.node('googleBtn').disabled,true);
  assert.equal(h.node('hubView').classList.contains('hidden'),true);
});
test('OAuth callback session must pass server administrator check before opening hub',async()=>{
  const h=await harness({session:{access_token:'synthetic'},admin:true});
  assert.equal(h.node('hubView').classList.contains('hidden'),false);
  const request=h.calls.fetch.find(([url])=>url.endsWith('/api/my-enrollments'));
  assert.equal(request[1].headers.Authorization,'Bearer synthetic');
  assert.equal(h.calls.signout.length,0);
});
test('Non-admin Google session is signed out locally and never opens admin hub',async()=>{
  const h=await harness({session:{access_token:'synthetic'},admin:false});
  assert.equal(h.node('hubView').classList.contains('hidden'),true);
  assert.equal(h.calls.signout[0].scope,'local');
  assert.match(h.node('loginStatus').textContent,/관리자 권한이 없습니다/);
});
test('Failed server check does not show privileged hub',async()=>{
  const h=await harness({session:{access_token:'synthetic'},admin:true,permissionFailure:true});
  assert.equal(h.node('hubView').classList.contains('hidden'),true);
  assert.match(h.node('loginStatus').textContent,/확인하지 못했습니다/);
});
test('Google provider failure uses safe copy and enables retry and password login',async()=>{
  const h=await harness({oauthError:Error('SECRET URL OR TOKEN')});await h.click('googleBtn');
  assert.equal(h.node('googleBtn').disabled,false);assert.equal(h.node('loginBtn').disabled,false);
  assert.match(h.node('loginStatus').textContent,/시작하지 못했습니다/);
  assert.equal(h.node('loginStatus').textContent.includes('SECRET'),false);
});
test('Cancelled OAuth response removes URL errors without displaying provider contents',async()=>{
  const h=await harness({hash:'#error=access_denied&error_description=SECRET'});
  assert.deepEqual(h.calls.history,['/admin.html']);assert.equal(h.calls.fetch.length,0);
  assert.match(h.node('loginStatus').textContent,/취소/);assert.equal(h.node('loginStatus').textContent.includes('SECRET'),false);
});
test('file preview never calls auth APIs and directs login to HTTPS website',async()=>{
  const h=await harness({protocol:'file:'});await h.click('googleBtn');
  assert.equal(h.calls.fetch.length,0);assert.equal(h.calls.oauth.length,0);
  assert.equal(h.node('loginBtn').disabled,true);assert.equal(h.node('forgotBtn').disabled,true);
  assert.deepEqual(h.calls.redirect,['https://bccconsulting.kr/admin.html']);
});
test('Password login still checks administrator status and rejects ordinary account',async()=>{
  const h=await harness({admin:false});h.node('email').value='admin@example.test';h.node('pw').value='test-only';await h.submit();
  assert.equal(h.node('hubView').classList.contains('hidden'),true);assert.equal(h.calls.signout.length,1);
  assert.match(h.node('loginStatus').textContent,/관리자 계정만/);
});

test('Initial session check keeps both login actions disabled until it completes',async()=>{
  let finish;const sessionWait=new Promise(resolve=>{finish=resolve});
  const h=await harness({sessionWait});
  assert.equal(h.node('loginBtn').disabled,true);assert.equal(h.node('googleBtn').disabled,true);
  finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.node('loginBtn').disabled,false);assert.equal(h.node('googleBtn').disabled,false);
});
