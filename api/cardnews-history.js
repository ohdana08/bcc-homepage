// /api/cardnews-history — 관리자 카드뉴스 히스토리 (Supabase 저장, 기기 간 동기화)
//   GET            → 내 히스토리 목록(가벼운 메타 + 첫 썸네일)
//   GET ?id=...    → 한 항목 상세(data, thumbs)
//   POST {op:...}  → save | rename | thumbs | delete
//   ★ 스레드 공장 히스토리도 이 함수에 통합한다(Vercel 12함수 한계 회피).
//     kind=threads (GET 쿼리 / POST 본문) 이면 threads_history 테이블로 분기한다.
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export const maxDuration = 30;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });
  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });
  const uid = user.id;

  // 스레드/블로그 공장 분기 — 카드뉴스와 동일한 구조를 별 테이블로 복제
  const kind = req.method === 'GET' ? req.query.kind : (req.body || {}).kind;
  if (kind === 'threads') return handleThreadsHistory(req, res, db, uid);
  if (kind === 'blog') return handleBlogHistory(req, res, db, uid);

  try {
    if (req.method === 'GET') {
      const id = req.query.id;
      if (id) {
        const { data, error } = await db.from('cardnews_history')
          .select('id, data, thumbs').eq('user_id', uid).eq('id', id).single();
        if (error || !data) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        return res.json({ id: data.id, data: data.data, thumbs: data.thumbs || [] });
      }
      const { data, error } = await db.from('cardnews_history')
        .select('id, title, cards_count, thumb0, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
      if (error) return res.status(500).json({ error: '히스토리 조회 실패: ' + error.message });
      return res.json({ items: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.op === 'save') {
        if (!body.id) return res.status(400).json({ error: 'id 누락' });
        const row = {
          id: body.id, user_id: uid,
          title: String(body.title || '').slice(0, 200),
          cards_count: body.cards_count || 0,
          data: body.data || null,
          thumbs: body.thumbs || null,
          thumb0: body.thumb0 || (Array.isArray(body.thumbs) ? body.thumbs[0] : null) || null,
        };
        if (body.created_at) { try { row.created_at = new Date(body.created_at).toISOString(); } catch (e) {} }
        const { error } = await db.from('cardnews_history').upsert(row, { onConflict: 'id' });
        if (error) return res.status(500).json({ error: '저장 실패: ' + error.message });
        return res.json({ ok: true, id: body.id });
      }
      if (body.op === 'rename') {
        const { error } = await db.from('cardnews_history')
          .update({ title: String(body.title || '').slice(0, 200) }).eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '이름 변경 실패' });
        return res.json({ ok: true });
      }
      if (body.op === 'thumbs') {
        const { error } = await db.from('cardnews_history')
          .update({ thumbs: body.thumbs || null, thumb0: body.thumb0 || (Array.isArray(body.thumbs) ? body.thumbs[0] : null) || null })
          .eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '썸네일 저장 실패' });
        return res.json({ ok: true });
      }
      if (body.op === 'delete') {
        const { error } = await db.from('cardnews_history').delete().eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '삭제 실패' });
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: '알 수 없는 작업' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('cardnews-history error:', err?.message || err);
    return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
  }
}

// ───────── 스레드 공장 히스토리 (threads_history) — 카드뉴스 구조 그대로 복제 ─────────
//   GET            → 목록(가벼운 메타: 입력종류·목적·글수)
//   GET ?id=...    → 한 항목 상세(data)
//   POST {op:...}  → save | rename | delete  (썸네일 없음)
async function handleThreadsHistory(req, res, db, uid) {
  try {
    if (req.method === 'GET') {
      const id = req.query.id;
      if (id) {
        const { data, error } = await db.from('threads_history')
          .select('id, data').eq('user_id', uid).eq('id', id).single();
        if (error || !data) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        return res.json({ id: data.id, data: data.data });
      }
      const { data, error } = await db.from('threads_history')
        .select('id, title, input_type, purpose, threads_count, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
      if (error) return res.status(500).json({ error: '히스토리 조회 실패: ' + error.message });
      return res.json({ items: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.op === 'save') {
        if (!body.id) return res.status(400).json({ error: 'id 누락' });
        const row = {
          id: body.id, user_id: uid,
          title: String(body.title || '').slice(0, 200),
          input_type: String(body.input_type || '').slice(0, 20) || null,
          purpose: String(body.purpose || '').slice(0, 20) || null,
          threads_count: body.threads_count || 0,
          data: body.data || null,
        };
        if (body.created_at) { try { row.created_at = new Date(body.created_at).toISOString(); } catch (e) {} }
        const { error } = await db.from('threads_history').upsert(row, { onConflict: 'id' });
        if (error) return res.status(500).json({ error: '저장 실패: ' + error.message });
        return res.json({ ok: true, id: body.id });
      }
      if (body.op === 'rename') {
        const { error } = await db.from('threads_history')
          .update({ title: String(body.title || '').slice(0, 200) }).eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '이름 변경 실패' });
        return res.json({ ok: true });
      }
      if (body.op === 'delete') {
        const { error } = await db.from('threads_history').delete().eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '삭제 실패' });
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: '알 수 없는 작업' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('threads-history error:', err?.message || err);
    return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
  }
}

// ───────── 블로그 공장 히스토리 (blog_results) — 스레드 구조 그대로 복제 ─────────
//   GET            → 목록(가벼운 메타: 제목·UTM 식별자)
//   GET ?id=...    → 한 항목 상세(data = { message, column, seo })
//   POST {op:...}  → save | rename | delete  (썸네일 없음)
async function handleBlogHistory(req, res, db, uid) {
  try {
    if (req.method === 'GET') {
      const id = req.query.id;
      if (id) {
        const { data, error } = await db.from('blog_results')
          .select('id, data').eq('user_id', uid).eq('id', id).single();
        if (error || !data) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        return res.json({ id: data.id, data: data.data });
      }
      const { data, error } = await db.from('blog_results')
        .select('id, title, campaign_id, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
      if (error) return res.status(500).json({ error: '히스토리 조회 실패: ' + error.message });
      return res.json({ items: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.op === 'save') {
        if (!body.id) return res.status(400).json({ error: 'id 누락' });
        const row = {
          id: body.id, user_id: uid,
          title: String(body.title || '').slice(0, 200),
          campaign_id: String(body.campaign_id || '').slice(0, 60) || null,
          data: body.data || null,
        };
        if (body.created_at) { try { row.created_at = new Date(body.created_at).toISOString(); } catch (e) {} }
        const { error } = await db.from('blog_results').upsert(row, { onConflict: 'id' });
        if (error) return res.status(500).json({ error: '저장 실패: ' + error.message });
        return res.json({ ok: true, id: body.id });
      }
      if (body.op === 'rename') {
        const { error } = await db.from('blog_results')
          .update({ title: String(body.title || '').slice(0, 200) }).eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '이름 변경 실패' });
        return res.json({ ok: true });
      }
      if (body.op === 'delete') {
        const { error } = await db.from('blog_results').delete().eq('user_id', uid).eq('id', body.id);
        if (error) return res.status(500).json({ error: '삭제 실패' });
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: '알 수 없는 작업' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('blog-history error:', err?.message || err);
    return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
  }
}
