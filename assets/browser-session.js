// Supabase refresh tokens can exceed cookie size limits. Keep their encryption
// key in a host-only session cookie, shared by tabs until the browser clears it.
(() => {
  const cookieName = location.protocol === 'https:' ? '__Host-bcc-session-key' : 'bcc-session-key';
  const readKey = () => document.cookie.split('; ').find(item => item.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const encode = bytes => btoa(Array.from(bytes, n=>String.fromCharCode(n)).join(''));
  const decode = value => Uint8Array.from(atob(value), c=>c.charCodeAt(0));
  async function sessionKey(create) {
    let value = readKey();
    if (!value && create) {
      value = encode(crypto.getRandomValues(new Uint8Array(32)));
      document.cookie = cookieName+'='+value+'; Path=/; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
      value = readKey();
      if (!value) throw Error('로그인을 유지하려면 브라우저 쿠키를 허용해 주세요.');
    }
    return value && crypto.subtle.importKey('raw',decode(value),'AES-GCM',false,['encrypt','decrypt']);
  }
  const name = key => 'bcc-browser:'+key;
  window.bccBrowserSession = {
    async getItem(key) {
      // Remove legacy persistent credentials on the first visit after upgrade.
      localStorage.removeItem(key);
      const stored = localStorage.getItem(name(key));
      if (!stored) return null;
      const secret = await sessionKey(false);
      if (!secret) return null;
      try {
        const [iv,data] = stored.split('.');
        const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:new TextEncoder().encode(key)},secret,decode(data));
        return new TextDecoder().decode(plain);
      } catch { return null; }
    },
    async setItem(key,value) {
      const secret = await (navigator.locks ? navigator.locks.request('bcc-browser-key',()=>sessionKey(true)) : sessionKey(true));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(key)},secret,new TextEncoder().encode(value));
      localStorage.setItem(name(key),encode(iv)+'.'+encode(new Uint8Array(encrypted)));
      localStorage.removeItem(key);
    },
    removeItem(key) { localStorage.removeItem(name(key)); localStorage.removeItem(key); }
  };
})();
