// service_role 클라이언트 — Vercel 서버리스 함수 전용.
// 이 키는 RLS 를 우회하므로 절대 프론트로 나가면 안 된다 (환경변수 전용).
import { createClient } from '@supabase/supabase-js';

let _admin = null;

export function supabaseAdmin() {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 누락');
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
