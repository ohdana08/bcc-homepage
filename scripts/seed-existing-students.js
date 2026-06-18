// 기존 수강생(전화번호만 보유) 재수강 자격 시드 — 합성 이메일 방식
// (업무지시서 §9-8 / PAYMENT_SETUP.md §86)
//
// 배경: 1기 수강생은 이메일이 없고 전화번호만 있다. Supabase Auth 는 이메일 기반이므로
//   전화번호로 합성 이메일(<숫자만>@phone.bcc.kr)을 만들어 계정을 생성한다.
//   초기 비밀번호 = 전화번호 숫자(예 01067096699). 관리자가 안내 → 마이페이지에서
//   "전화번호로 로그인"(전화번호 + 그 번호) 가능.
//
// 각 수강생에 대해:
//   1) Auth 유저 생성 (email=합성, password=전화숫자, email_confirm=true)
//   2) profiles 1행 (phone=숫자정규화, status='active', password_set=true)
//   3) enrollments 1행 (과거 구매 이력) — 이게 있어야 다음 신청 때
//      create-checkout 가 구매이력(count>0)을 보고 자동으로 재수강가를 적용한다.
//      (create-checkout 는 전화번호로도 기존 회원을 찾으므로, 재신청 시 새 이메일을
//       써도 전화번호가 같으면 재수강가가 붙는다.)
//
// 멱등: 같은 전화번호가 이미 profiles 에 있으면 건너뛴다.
//
// 실행:
//   cd ~/bcc-homepage
//   node --env-file=.env scripts/seed-existing-students.js
//   ( .env 에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요. 로컬 전용, 커밋 금지 )

import { createClient } from '@supabase/supabase-js';

const PHONE_DOMAIN = 'phone.bcc.kr';   // 합성 이메일 도메인 (mypage.html 과 동일해야 함)
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

// ── 기존 수강생 4명 (1기, 전화번호만) ─────────────────────────────
const PAST_PRODUCT = 'shorts1';        // AI 숏폼 크리에이터 1기 (판매중지·비활성)
const STUDENTS = [
  { name: '이미야', phone: '010-6709-6699' },
  { name: '박미경', phone: '010-2577-1596' },
  { name: '박미희', phone: '010-4585-8510' },
  { name: '김진유', phone: '010-8554-5597' },
];
// ─────────────────────────────────────────────────────────────────

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수 누락');
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 과거 강의 상품 확인 (가격은 DB에서)
const { data: product, error: pErr } = await db
  .from('products').select('*').eq('id', PAST_PRODUCT).single();
if (pErr || !product) {
  console.error(`✗ 상품 '${PAST_PRODUCT}' 없음 — schema.sql 의 shorts1 INSERT 를 라이브 DB에 먼저 실행하세요.`);
  process.exit(1);
}

let seeded = 0, skipped = 0, failed = 0;

for (const s of STUDENTS) {
  const name = String(s.name || '').trim();
  const phone = onlyDigits(s.phone);                 // 01067096699
  const email = `${phone}@${PHONE_DOMAIN}`;          // 합성 이메일
  const tag = `${name}<${phone}>`;

  if (!name || phone.length < 10) {
    console.error(`✗ ${tag}: 이름/전화번호 형식 오류 — 건너뜀`);
    failed++; continue;
  }

  // 1) 이미 등록된 전화번호면 건너뜀(멱등)
  const { data: existing } = await db
    .from('profiles').select('id').eq('phone', phone).maybeSingle();
  if (existing) {
    console.log(`• ${tag}: 이미 존재 — 건너뜀`);
    skipped++; continue;
  }

  // 2) Auth 유저 생성 (초기 비번 = 전화번호 숫자)
  const { data: created, error: aErr } = await db.auth.admin.createUser({
    email, password: phone, email_confirm: true,
  });
  if (aErr || !created?.user) {
    console.error(`✗ ${tag}: Auth 유저 생성 실패 — ${aErr?.message || '?'}`);
    failed++; continue;
  }
  const userId = created.user.id;

  // 3) profiles (active, 비번 설정됨)
  const { error: prErr } = await db.from('profiles').insert({
    id: userId, name, phone, email,
    status: 'active', password_set: true,
  });
  if (prErr) {
    console.error(`✗ ${tag}: profiles insert 실패 — ${prErr.message}`);
    failed++; continue;
  }

  // 4) enrollments (과거 구매 1행) — 재수강 판정의 근거
  const orderId = `seed_${PAST_PRODUCT}_${userId}`;
  const { error: enErr } = await db.from('enrollments').insert({
    user_id: userId,
    product_id: PAST_PRODUCT,
    paid_amount: product.price,
    is_recourse: false,
    order_id: orderId,
  });
  if (enErr) {
    console.error(`✗ ${tag}: enrollments insert 실패 — ${enErr.message}`);
    failed++; continue;
  }

  console.log(`✓ ${tag}: 등록 완료 — 로그인: 전화번호 ${phone} / 초기비번 ${phone}`);
  seeded++;
}

console.log(`\n── 결과 ── 등록 ${seeded} · 건너뜀 ${skipped} · 실패 ${failed}`);
console.log(`재신청 시(같은 전화번호) ${product.name} 외 현행 강의는 재수강가 ${product.recourse_price}원 자동 적용.`);
process.exit(failed > 0 ? 1 : 0);
