// POST /api/unsplash — 관리자 전용 Unsplash 사진 검색 프록시(③ 배경용)
// 카드별 bg_query(영어 검색어) 배열을 받아, 각 검색어의 대표 사진 1장 URL 을 돌려준다.
// ★ UNSPLASH_ACCESS_KEY 는 이 서버 함수에만 존재한다(브라우저로 안 내려감).
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export const maxDuration = 30;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 로그인 + 관리자 검증 (cardnews-generate 와 동일 패턴)
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });
  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  const { queries } = req.body || {};
  if (!Array.isArray(queries) || !queries.length) {
    return res.status(400).json({ error: 'queries 배열이 필요합니다.' });
  }
  // 과도한 호출 방지(카드 최대 8장)
  const qs = queries.slice(0, 8).map((q) => String(q || '').trim() || 'dark abstract');

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    // 키 미설정: 에러 대신 "사진 없음" 으로 정상 응답 → 프론트가 그라데이션 배경으로 렌더.
    // 나중에 키를 넣으면 코드 변경 없이 이 분기를 건너뛰고 사진이 적용된다.
    return res.json({ keyless: true, results: qs.map((q) => ({ query: q, imageUrl: null })) });
  }

  async function searchOne(q) {
    try {
      const url = 'https://api.unsplash.com/search/photos'
        + '?per_page=1&orientation=squarish&content_filter=high&query=' + encodeURIComponent(q);
      const r = await fetch(url, { headers: { Authorization: 'Client-ID ' + key, 'Accept-Version': 'v1' } });
      if (!r.ok) return { query: q, imageUrl: null };
      const j = await r.json();
      const p = j.results && j.results[0];
      if (!p) return { query: q, imageUrl: null };
      // imgix 동적 리사이즈 파라미터로 1080 정사각 크롭을 바로 받는다.
      const base = p.urls.raw;
      const imageUrl = base + (base.includes('?') ? '&' : '?') + 'w=1080&h=1080&fit=crop&crop=entropy&q=80&fm=jpg';
      return {
        query: q,
        imageUrl,
        author: p.user?.name || '',
        authorLink: p.user?.links?.html || '',
      };
    } catch (e) {
      return { query: q, imageUrl: null };
    }
  }

  try {
    const results = await Promise.all(qs.map(searchOne));
    return res.json({ results });
  } catch (err) {
    console.error('unsplash error:', err?.message || err);
    return res.status(500).json({ error: '배경 검색 중 오류가 발생했습니다.' });
  }
}
