import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';

const $ = id => document.getElementById(id);
let client, revision = 0, controller, activeUser;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function clearPreview() {
  revision++; controller?.abort(); controller = null; activeUser = null;
  $('workspace').replaceChildren(); $('workspace').hidden = true;
  $('gate').hidden = false; $('close-preview').hidden = true; $('retry').hidden = false;
}
async function getClient() {
  if (client) return client;
  const response = await fetch('/api/config', { cache: 'no-store' });
  const config = await response.json();
  if (!response.ok || !config.supabaseUrl || !config.supabaseAnonKey) throw new Error('로그인 설정을 불러오지 못했습니다.');
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } });
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (activeUser && session?.user?.id !== activeUser)) {
      clearPreview(); $('login').hidden = false; status('관리자 로그인이 필요합니다.');
    }
  });
  return client;
}
async function openPreview() {
  clearPreview(); $('retry').hidden = true; $('login').hidden = true;
  const current = revision;
  status('관리자 권한을 확인하고 있습니다.');
  try {
    const sb = await getClient();
    const { data, error } = await sb.auth.getSession();
    if (current !== revision) return;
    if (error || !data.session) { $('login').hidden = false; throw new Error('기존 BCC 관리자 계정으로 로그인해 주세요.'); }
    // Bind pending responses to the requesting account, not only a mounted frame.
    activeUser = data.session.user.id;
    controller = new AbortController();
    let session = data.session;
    const request = () => fetch('/api/saju-admin', { cache: 'no-store', credentials: 'same-origin', headers: { Authorization: 'Bearer ' + session.access_token }, signal: controller.signal });
    let response = await request();
    if (response.status === 401) {
      const refreshed = await sb.auth.refreshSession();
      if (current !== revision) return;
      if (!refreshed.error && refreshed.data.session) { session = refreshed.data.session; response = await request(); }
    }
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) $('login').hidden = false;
      throw new Error(failure.error || '미리보기를 불러오지 못했습니다. 잠시 후 다시 열어주세요.');
    }
    const html = await response.text();
    if (current !== revision) return;
    const latest = await sb.auth.getSession();
    if (current !== revision) return;
    if (latest.error || latest.data.session?.user?.id !== activeUser) {
      clearPreview(); $('login').hidden = false; status('계정이 변경되었습니다. 관리자 권한을 다시 확인해 주세요.'); return;
    }
    if (!response.headers.get('content-type')?.includes('text/html') || !html.startsWith('<!doctype html>')) throw new Error('미리보기 응답을 확인하지 못했습니다.');
    const frame = document.createElement('iframe');
    frame.title = '결 사주 관리자 전용 미리보기';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-downloads allow-modals');
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = html;
    activeUser = session.user.id;
    $('workspace').replaceChildren(frame); $('workspace').hidden = false;
    $('gate').hidden = true; $('close-preview').hidden = false;
  } catch (error) {
    if (current !== revision || error.name === 'AbortError') return;
    status(error.message || '미리보기를 불러오지 못했습니다.', true); $('retry').hidden = false;
  }
}
$('retry').addEventListener('click', openPreview);
$('close-preview').addEventListener('click', () => { clearPreview(); status('미리보기를 닫았습니다. 입력한 출생 정보와 결과도 화면에서 지워졌습니다.'); });
window.addEventListener('pagehide', clearPreview);
window.addEventListener('pageshow', event => { if (event.persisted) void openPreview(); });
void openPreview();
