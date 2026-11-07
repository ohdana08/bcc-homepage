// POST /api/set-password — 결제 완료 후 (선택) 비밀번호 설정
// 검증: orderId 가 결제 완료(enrollments 존재)이고, 그 주문의 user 이메일이 일치할 때만 허용.
//
// ⚠️ 보안 메모: orderId 가 URL 에 노출되므로 "orderId + 이메일 일치"만으로는
//   결제 직후 짧은 시간 내 비밀번호 가로채기 가능성이 이론상 존재.
//   강화하려면 Supabase 매직링크/OTP(이메일 인증) 기반으로 교체 권장.
//   업무지시서상 비밀번호 설정은 "선택사항"이라 MVP 로 이 방식 채택.
// 2026-11-07 보강(Codex Security High): 이미 비밀번호가 설정된 계정은 이 경로로 바꿀 수 없고,
//   결제 후 24시간이 지난 주문번호는 거부한다. → "결제 직후 최초 1회 설정"으로만 제한.
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SET_PASSWORD_WINDOW_MS = 24 * 60 * 60 * 1000; // 결제 후 24시간

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const orderId = String(req.body?.orderId || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!orderId || !EMAIL_RE.test(email))
    return res.status(400).json({ error: '주문/이메일 정보가 올바르지 않습니다.' });
  if (password.length < 8)
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });

  const db = supabaseAdmin();

  // 1) 결제 완료된 주문인지 확인
  const { data: enr } = await db
    .from('enrollments').select('user_id, paid_at').eq('order_id', orderId).maybeSingle();
  if (!enr) return res.status(400).json({ error: '결제 완료된 주문을 찾을 수 없습니다.' });
  // 1-1) 결제 후 24시간 지난 주문은 더 이상 비밀번호 설정 근거로 쓰지 않는다
  const paidAt = enr.paid_at ? new Date(enr.paid_at).getTime() : 0;
  if (!paidAt || Date.now() - paidAt > SET_PASSWORD_WINDOW_MS)
    return res.status(403).json({ error: '비밀번호 설정 가능 시간이 지났습니다. 비밀번호 찾기를 이용해 주세요.' });

  // 2) 그 주문의 회원 이메일이 입력 이메일과 일치하는지
  const { data: profile } = await db
    .from('profiles').select('id, email, password_set').eq('id', enr.user_id).single();
  if (!profile || profile.email !== email)
    return res.status(403).json({ error: '이메일이 주문과 일치하지 않습니다.' });
  // 2-1) 이미 비밀번호가 있는 계정은 이 공개 경로로 교체 불가(계정 탈취 차단)
  if (profile.password_set)
    return res.status(409).json({ error: '이미 비밀번호가 설정된 계정입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.' });

  // 3) 비밀번호 설정 + 이메일 확인 처리
  const { error: upErr } = await db.auth.admin.updateUserById(profile.id, {
    password,
    email_confirm: true,
  });
  if (upErr) return res.status(500).json({ error: '비밀번호 설정에 실패했습니다.' });

  await db.from('profiles')
    .update({ password_set: true, status: 'active' })
    .eq('id', profile.id);

  return res.json({ success: true });
}
