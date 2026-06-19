// POST /api/signup — 독립 회원가입 (결제와 무관하게 계정을 먼저 만든다)
// 받는 값: name, phone, email, password, privacyConsent(필수), marketingConsent(선택)
//   - 모든 쓰기는 service_role 로만 (프론트 anon 은 RLS 로 쓰기 불가).
//   - 가입 즉시 로그인 가능하도록 password 설정 + email_confirm=true + status='active'.
//   - 이메일 중복 처리:
//       · 이미 비밀번호까지 설정된 계정  → 409 "이미 가입됨, 로그인하세요"
//       · 결제 과정에서 만들어진 pending(비번 미설정) 계정 → 그 계정을 그대로 활성화(비번 부여)
// ⚠️ 매칭은 이메일 기준만. (전화번호로 시드된 기존 수강생과는 별개 계정 — create-checkout 가
//     결제 시 전화번호로 재수강가를 연결하므로 가격 혜택은 유지된다.)
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').replace(/\D/g, ''); // 숫자만(전화 매칭 일관성)
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const privacyConsent = body.privacyConsent === true;
  const marketingConsent = body.marketingConsent === true;
  const nowIso = new Date().toISOString();
  const marketingConsentAt = marketingConsent ? nowIso : null;
  // 동의 출처(재동의 확장 대비): 'signup' | 'free_tool' | 'ebook' | 'course_done' | 'community'
  const consentSource = (String(body.consentSource || 'signup').trim()) || 'signup';

  // 허니팟(봇 차단): 사람은 비워둠
  if (body.website) return res.status(200).json({ ok: true });

  if (!name || !phone || !email)
    return res.status(400).json({ error: '이름·연락처·이메일을 모두 입력해 주세요.' });
  if (!EMAIL_RE.test(email))
    return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
  if (password.length < 8)
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
  if (!privacyConsent)
    return res.status(400).json({ error: '개인정보 수집·이용에 동의해 주세요.' });

  const db = supabaseAdmin();

  // 1) 이메일로 기존 계정 조회
  const { data: existing } = await db
    .from('profiles').select('id, password_set').eq('email', email).maybeSingle();

  if (existing) {
    // 이미 비밀번호까지 설정된 정식 회원 → 가입 막고 로그인 유도
    if (existing.password_set)
      return res.status(409).json({ error: '이미 가입된 이메일입니다. 로그인해 주세요.' });

    // 결제 과정에서 만들어진 pending 계정 → 비밀번호 부여하며 정식 활성화
    const { error: upErr } = await db.auth.admin.updateUserById(existing.id, {
      password, email_confirm: true,
    });
    if (upErr) return res.status(500).json({ error: '계정 활성화에 실패했습니다.' });

    const upd = {
      name, phone, password_set: true, status: 'active',
      privacy_agree: true, privacy_agree_at: nowIso, consent_source: consentSource,
    };
    if (marketingConsent) { upd.marketing_consent = true; upd.marketing_consent_at = marketingConsentAt; }
    await db.from('profiles').update(upd).eq('id', existing.id);

    return res.json({ success: true, email });
  }

  // 2) 신규 계정 생성 (비밀번호 포함 → 즉시 로그인 가능)
  const { data: created, error: aErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (aErr || !created?.user) {
    // 인증 유저는 있는데 profiles 가 비어있는 희귀 케이스: 한 번 더 조회 후 중복 안내
    const retry = await db.from('profiles').select('id').eq('email', email).maybeSingle();
    if (retry.data) return res.status(409).json({ error: '이미 가입된 이메일입니다. 로그인해 주세요.' });
    return res.status(500).json({ error: '계정 생성에 실패했습니다.' });
  }

  const { error: insErr } = await db.from('profiles').insert({
    id: created.user.id,
    name, phone, email,
    status: 'active',
    password_set: true,
    privacy_agree: true,
    privacy_agree_at: nowIso,
    marketing_consent: marketingConsent,
    marketing_consent_at: marketingConsentAt,
    consent_source: consentSource,
  });
  if (insErr) return res.status(500).json({ error: '프로필 생성에 실패했습니다.' });

  return res.json({ success: true, email });
}
