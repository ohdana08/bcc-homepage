// GET /api/config — 프론트가 쓰는 "공개" 설정만 내려준다.
//   tossClientKey, supabaseUrl, supabaseAnonKey 는 노출돼도 되는 값(anon 은 RLS 로 보호).
//   service_role / toss secret 은 절대 포함하지 않는다.
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  return res.json({
    tossClientKey: process.env.TOSS_CLIENT_KEY || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
}
