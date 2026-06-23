// POST /api/describe-style — 관리자 전용. 디자인 레퍼런스 이미지의 "화풍"만 영어로 요약.
// 2탄 카드 이미지 생성 시, 이 화풍 문구를 Pollinations 프롬프트의 style 로 사용한다.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

export const maxDuration = 30;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });
  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });
  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 미설정' });
  const { imageBase64, imageMediaType } = req.body || {};
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
    console.error('describe-style error:', err?.message || err);
    return res.status(500).json({ error: '서버 예외: ' + (err?.message || String(err)) });
  }
}
