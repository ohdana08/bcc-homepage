// POST /api/illustrate — 관리자 전용. 2탄 카드 이미지 관련 (함수 수 절약 위해 2기능 통합)
//   { op:'describe', imageBase64 } → 디자인 레퍼런스 화풍을 영어로 요약 {style}  (Claude 비전)
//   { prompt, seed }              → Pollinations AI(무료) 일러스트 생성 {b64,mediaType}
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export const maxDuration = 60;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 로그인 + 관리자 검증
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });
  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  const body = req.body || {};

  // (A) 디자인 레퍼런스 화풍 분석 (Claude 비전)
  if (body.op === 'describe' || body.imageBase64) {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY 미설정' });
    const { imageBase64, imageMediaType } = body;
    if (!imageBase64 || imageBase64.length < 100) return res.status(400).json({ error: '이미지가 필요합니다.' });
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: 'Describe ONLY the visual art style of this image as a concise English comma-separated phrase usable in an AI image generation prompt — medium/technique, rendering style, color palette, texture, lighting, mood. Do NOT describe the subject, scene, or any text/content. Output only the style phrase, nothing else.' },
          ],
        }],
      });
      const text = (msg.content.find((b) => b.type === 'text') || {}).text || '';
      const style = text.trim().replace(/^["']|["']$/g, '').slice(0, 400);
      if (!style) return res.status(502).json({ error: '화풍 분석 결과가 비었습니다.' });
      return res.json({ style });
    } catch (err) {
      console.error('illustrate(describe) error:', err?.message || err);
      return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
    }
  }

  // (B) 일러스트 생성 (Pollinations AI, 무료·키 불필요)
  const { prompt, seed } = body;
  if (!prompt || String(prompt).trim().length < 4) return res.status(400).json({ error: 'prompt 가 필요합니다.' });
  try {
    const p = String(prompt).slice(0, 900);
    const sd = Number.isFinite(seed) ? seed : 0;
    const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(p)
      + '?width=1024&height=1024&nologo=true&model=flux&seed=' + sd;
    const r = await fetch(url, { headers: { Accept: 'image/*' } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(r.status === 429 ? 429 : 502).json({ error: '이미지 생성 실패(' + r.status + ') ' + t.slice(0, 120) });
    }
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return res.status(502).json({ error: '이미지 응답이 비어 있습니다.' });
    return res.json({ b64: buf.toString('base64'), mediaType: ct });
  } catch (err) {
    console.error('illustrate error:', err?.message || err);
    return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
  }
}
