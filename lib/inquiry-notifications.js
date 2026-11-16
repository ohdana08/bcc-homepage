import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from './supabase.js';

const TYPES = { simple: ['leads', 'id'], detailed: ['lecture_requests', 'receipt'] };
export function createInquiryNotificationHandler(getDb = supabaseAdmin, getSecret = () => process.env.INQUIRY_NOTIFICATION_SECRET) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    const secret = getSecret();
    if (!secret || secret.length < 32) return res.status(503).json({ error: 'not configured' });
    const supplied = String(req.headers?.authorization || '');
    const expected = `Bearer ${secret}`;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { kind, since, until, offset = 0 } = req.body || {};
    if (!Object.hasOwn(TYPES, kind) || typeof since !== 'string' || typeof until !== 'string' ||
        !Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) ||
        Date.parse(since) > Date.parse(until) || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      return res.status(400).json({ error: 'invalid request' });
    }
    try {
      const [table, id] = TYPES[kind];
      const { data, error } = await getDb().from(table).select(`${id},created_at`)
        .gte('created_at', since).lte('created_at', until)
        .order('created_at', { ascending: true }).order(id, { ascending: true }).range(offset, offset + 99);
      if (error) throw error;
      return res.status(200).json({ events: data.map(row => ({ kind, id: String(row[id]), created_at: row.created_at })), hasMore: data.length === 100 });
    } catch {
      return res.status(503).json({ error: 'temporarily unavailable' });
    }
  };
}
export const handleInquiryNotifications = createInquiryNotificationHandler();
