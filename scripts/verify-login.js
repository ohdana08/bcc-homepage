// 전화번호 로그인 라이브 검증 — 시드된 수강생이 실제로 인증되는지 확인.
// 공개 anon 키(/api/config)만 사용. 비밀키 불필요.
//   node scripts/verify-login.js
import { createClient } from '@supabase/supabase-js';

const API = 'https://bcc-homepage.vercel.app';
const PHONE_DOMAIN = 'phone.bcc.kr';     // mypage.html / seed 와 동일해야 함

const PHONES = ['01067096699', '01025771596', '01045858510', '01085545597'];

const cfg = await fetch(API + '/api/config').then(r => r.json());
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  console.error('✗ /api/config 에서 supabaseUrl/anonKey 못 받음'); process.exit(1);
}
const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

let ok = 0, fail = 0;
for (const phone of PHONES) {
  const email = `${phone}@${PHONE_DOMAIN}`;   // 전화 → 합성 이메일(프론트와 동일 변환)
  const { data, error } = await sb.auth.signInWithPassword({ email, password: phone });
  if (error || !data?.session) {
    console.log(`✗ ${phone}: 로그인 실패 — ${error?.message || '세션 없음'}`); fail++;
  } else {
    console.log(`✓ ${phone}: 로그인 OK (세션 발급, user ${data.user.id.slice(0,8)}…)`); ok++;
    await sb.auth.signOut();
  }
}
console.log(`\n── 검증 ── 성공 ${ok} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
