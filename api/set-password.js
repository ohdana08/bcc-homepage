// POST /api/set-password — 결제 고객의 "최초 비밀번호 설정"을 이메일 본인 확인으로 처리한다.
//
// 2026-11-09 전환(Codex Security High 후속): 이전에는 "주문번호 + 이메일"만 알면 이 API 로
//   비밀번호를 바로 설정할 수 있었다(결제 후 24시간, 미설정 계정 한정). 주문번호는 URL 에
//   노출되므로, 이제 이 API 는 비밀번호를 받지 않는다. 두 가지 동작만 한다.
//
//   1) 링크 요청  — body { orderId, email }
//        결제 완료 주문 + 이메일 일치 + 24시간 이내 + 비밀번호 미설정일 때,
//        Supabase 가 그 이메일로 일회용 설정 링크를 보낸다(→ /set-password.html).
//        링크를 받은 사람(=메일함 주인)만 비밀번호를 정할 수 있다.
//   2) 완료 기록  — header Authorization: Bearer <링크로 얻은 세션 토큰>
//        set-password.html 이 비밀번호 변경 후 호출. 토큰의 본인 profile 만
//        password_set=true, status='active' 로 표시한다.
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SET_PASSWORD_WINDOW_MS = 24 * 60 * 60 * 1000; // 결제 후 24시간
const SET_PASSWORD_PAGE =
  (process.env.SITE_URL || 'https://bccconsulting.kr').replace(/\/+$/, '') + '/set-password.html';

function bearerToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers?.authorization || ''));
  return m ? m[1] : '';
}

// 2) 링크로 로그인한 본인의 profile 에 "비밀번호 설정 완료" 기록
async function markPasswordSet(res, token) {
  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(token);
  const user = data?.user;
  if (error || !user?.id) return res.status(401).json({ error: '인증이 만료되었습니다. 메일의 링크를 다시 열어 주세요.' });

  const { error: upErr } = await db.from('profiles')
    .update({ password_set: true, status: 'active' })
    .eq('id', user.id);
  if (upErr) return res.status(500).json({ error: '설정 완료 기록에 실패했습니다.' });
  return res.json({ success: true });
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = bearerToken(req);
  if (token) return markPasswordSet(res, token);

  // 예전 방식(비밀번호를 직접 보내는 요청)은 더 이상 받지 않는다.
  if (req.body?.password !== undefined)
    return res.status(410).json({ error: '비밀번호는 이메일로 받은 링크에서 설정해 주세요.' });

  const orderId = String(req.body?.orderId || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!orderId || !EMAIL_RE.test(email))
    return res.status(400).json({ error: '주문/이메일 정보가 올바르지 않습니다.' });

  const db = supabaseAdmin();

  // 결제 완료된 주문인지
  const { data: enr } = await db
    .from('enrollments').select('user_id, paid_at').eq('order_id', orderId).maybeSingle();
  if (!enr) return res.status(400).json({ error: '결제 완료된 주문을 찾을 수 없습니다.' });
  const paidAt = enr.paid_at ? new Date(enr.paid_at).getTime() : 0;
  if (!paidAt || Date.now() - paidAt > SET_PASSWORD_WINDOW_MS)
    return res.status(403).json({ error: '설정 가능 시간이 지났습니다. 마이페이지 로그인 화면의 "비밀번호 설정·재설정 메일 받기"를 이용해 주세요.' });

  // 그 주문의 회원 이메일과 일치하는지
  const { data: profile } = await db
    .from('profiles').select('id, email, password_set').eq('id', enr.user_id).single();
  if (!profile || profile.email !== email)
    return res.status(403).json({ error: '이메일이 주문과 일치하지 않습니다.' });
  if (profile.password_set)
    return res.status(409).json({ error: '이미 비밀번호가 설정된 계정입니다. 마이페이지에서 로그인해 주세요.' });

  // 일회용 설정 링크 메일 발송 (Supabase Auth 가 발송·만료·1회 사용을 관리)
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return res.status(500).json({ error: '메일 발송 설정이 누락되었습니다.' });
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: mailErr } = await pub.auth.resetPasswordForEmail(email, { redirectTo: SET_PASSWORD_PAGE });
  if (mailErr) {
    const limited = mailErr.status === 429 || /rate limit|security purposes/i.test(mailErr.message || '');
    return res.status(limited ? 429 : 502).json({
      error: limited
        ? '메일을 방금 보냈습니다. 1분 뒤 다시 시도해 주세요.'
        : '메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
  return res.json({ success: true, sent: true });
}
