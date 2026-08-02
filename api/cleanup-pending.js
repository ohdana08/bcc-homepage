// GET /api/cleanup-pending — Vercel Cron(매시간). 업무지시서 §8 "pending 계정 방치" 대응.
//   - 24h 초과 pending_orders.status='pending' → 'expired'
//   - 결제 이력(enrollments) 없는 24h 초과 profiles.status='pending' 회원 정리(auth 포함 삭제)
// Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 헤더를 보낸다(설정 시).
import { supabaseAdmin } from '../lib/supabase.js';
import { runThreadsAutopilot } from '../lib/threads-autopilot.js';

export const maxDuration = 300;

export default async function handler(req, res) {
  // Cron 인증 (CRON_SECRET 설정 시에만 강제)
  const isThreadsJob = req.query?.job === 'threads';
  const secret = isThreadsJob
    ? (process.env.THREADS_CRON_SECRET || process.env.CRON_SECRET)
    : process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = supabaseAdmin();
  if (isThreadsJob) {
    try {
      const campaignId = String(req.query?.campaign || '').trim() || null;
      if (campaignId && !/^[a-z0-9_-]+$/i.test(campaignId)) {
        return res.status(400).json({ ok: false, error: 'Invalid campaign' });
      }
      const verifyOnly = String(req.query?.verify_only || '').toLowerCase() === 'true';
      if (verifyOnly && !campaignId) {
        return res.status(400).json({ ok: false, error: 'verify_only requires campaign' });
      }
      const result = await runThreadsAutopilot({ db, campaignId, verifyOnly });
      return res.json(result);
    } catch (err) {
      console.error('threads-autopilot error:', err?.message || err);
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1) 만료 주문 처리
  const { data: expired } = await db
    .from('pending_orders')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('order_id');

  // 2) 결제 이력 없는 오래된 pending 회원 정리
  const { data: stale } = await db
    .from('profiles')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoff);

  let removed = 0;
  for (const p of stale || []) {
    const { count } = await db
      .from('enrollments').select('*', { count: 'exact', head: true })
      .eq('user_id', p.id);
    if ((count || 0) > 0) continue; // 결제 이력 있으면 보존
    // auth 유저 삭제 → profiles 는 on delete cascade 로 함께 삭제
    const { error } = await db.auth.admin.deleteUser(p.id);
    if (!error) removed += 1;
  }

  return res.json({
    ok: true,
    expiredOrders: expired?.length || 0,
    removedPendingUsers: removed,
  });
}
