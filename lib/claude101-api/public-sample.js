import { supabaseAdmin } from '../supabase.js';
import { applyCors } from '../cors.js';
import { createClaude101SignedLessonAssets } from '../claude101-course-assets.js';

export const CLAUDE101_PUBLIC_SAMPLE_LESSON_ID = '1-1';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const db = supabaseAdmin();
    const lesson = await createClaude101SignedLessonAssets(
      db,
      process.env.CLAUDE101_STORAGE_BUCKET,
      CLAUDE101_PUBLIC_SAMPLE_LESSON_ID,
      1800,
    );

    if (!lesson?.videoUrl) {
      return res.status(503).json({ error: '무료 1강 영상을 준비하지 못했습니다.' });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.json({
      lessonId: CLAUDE101_PUBLIC_SAMPLE_LESSON_ID,
      expiresIn: 1800,
      lesson,
    });
  } catch (error) {
    console.error('claude101 public sample failed', error);
    return res.status(500).json({ error: '무료 1강 영상을 불러오지 못했습니다.' });
  }
}
