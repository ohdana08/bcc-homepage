import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PRODUCT_ID = 'claude101-pro';
const API = window.BCC_API_BASE;
const loginDialog = document.getElementById('loginDialog');
const loginForm = document.getElementById('proLoginForm');
const loginStatus = document.getElementById('proLoginStatus');
const checkoutNotice = document.getElementById('checkoutNotice');
const checkoutFallback = document.getElementById('checkoutFallback');
const statusLines = Array.from(document.querySelectorAll('[data-checkout-status]'));
const purchaseButtons = Array.from(document.querySelectorAll('[data-purchase]'));
let supabase;
let pendingCheckout = false;
let checkoutPopup = null;

function track(name, params) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (_) {}
}

function setStatus(message, kind = '') {
  statusLines.forEach((element) => {
    element.textContent = message;
    element.className = `status-line${kind ? ` ${kind}` : ''}`;
  });
}

function setBusy(busy) {
  purchaseButtons.forEach((element) => {
    if ('disabled' in element) element.disabled = busy;
    element.setAttribute('aria-disabled', busy ? 'true' : 'false');
  });
}

async function getClient() {
  if (supabase) return supabase;
  const config = await fetch(`${API}/api/config`).then((response) => response.json());
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('로그인 설정을 불러오지 못했습니다.');
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return supabase;
}

async function getSession() {
  const client = await getClient();
  const { data: { session } } = await client.auth.getSession();
  return session;
}

function openLogin() {
  loginStatus.textContent = '';
  if (typeof loginDialog.showModal === 'function') loginDialog.showModal();
  else loginDialog.setAttribute('open', '');
  document.getElementById('proEmail').focus();
}

function closeLogin() {
  if (typeof loginDialog.close === 'function') loginDialog.close();
  else loginDialog.removeAttribute('open');
}

function openLoadingPopup() {
  const width = 520;
  const height = Math.min(820, window.screen.availHeight - 80);
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open('about:blank', 'bccClaude101Checkout', `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
  if (popup) {
    popup.document.title = 'BCC 결제 준비 중';
    popup.document.body.innerHTML = '<main style="font:16px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;min-height:90vh;display:grid;place-items:center;background:#111;color:#eee"><div style="text-align:center"><strong>안전한 결제창을 준비하고 있습니다.</strong><p style="color:#999">잠시만 기다려 주세요.</p></div></main>';
  }
  return popup;
}

async function beginCheckout() {
  if (pendingCheckout) return;
  pendingCheckout = true;
  setBusy(true);
  setStatus('로그인 상태를 확인하고 있습니다.');

  try {
    const session = await getSession();
    if (!session?.access_token) {
      pendingCheckout = false;
      setBusy(false);
      setStatus('결제와 수강권 연결을 위해 먼저 로그인해 주세요.');
      openLogin();
      return;
    }

    checkoutPopup = openLoadingPopup();
    const response = await fetch(`${API}/api/groble-checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ productId: PRODUCT_ID }),
    });
    const result = await response.json();

    if (!response.ok) {
      if (checkoutPopup && !checkoutPopup.closed) checkoutPopup.close();
      if (response.status === 409 && /이미 수강권/.test(result.error || '')) {
        location.href = 'course-claude101-pro.html';
        return;
      }
      throw new Error(result.error || '결제창을 열지 못했습니다.');
    }

    track('begin_checkout', { product_id: PRODUCT_ID, value: result.amount, currency: 'KRW', provider: 'groble' });
    checkoutFallback.href = result.checkoutUrl;
    checkoutNotice.hidden = false;

    if (checkoutPopup && !checkoutPopup.closed) {
      checkoutPopup.location.replace(result.checkoutUrl);
      checkoutPopup.focus();
    } else {
      checkoutFallback.click();
    }

    setStatus('그로블 보안 결제창이 열렸습니다. 결제를 마치면 수강실로 돌아옵니다.', 'success');
  } catch (error) {
    setStatus(error.message || '결제를 시작하지 못했습니다.', 'error');
  } finally {
    pendingCheckout = false;
    setBusy(false);
  }
}

purchaseButtons.forEach((element) => element.addEventListener('click', (event) => {
  event.preventDefault();
  if (element.getAttribute('aria-disabled') === 'true') return;
  beginCheckout();
}));
document.getElementById('loginClose').addEventListener('click', closeLogin);
loginDialog.addEventListener('click', (event) => { if (event.target === loginDialog) closeLogin(); });

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('proEmail').value.trim();
  const password = document.getElementById('proPassword').value;
  const button = document.getElementById('proLoginButton');
  if (!email || !password) { loginStatus.textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }

  button.disabled = true;
  loginStatus.textContent = '로그인 중…';
  try {
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error('이메일 또는 비밀번호를 확인해 주세요.');
    closeLogin();
    track('claude101_pro_login');
    await beginCheckout();
  } catch (error) {
    loginStatus.textContent = error.message || '로그인하지 못했습니다.';
  } finally {
    button.disabled = false;
  }
});

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data !== 'bcc:claude101:paid') return;
  checkoutNotice.hidden = true;
  location.href = 'course-claude101-pro.html';
});

track('view_claude101_pro');
