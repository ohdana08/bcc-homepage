import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from './supabase.js';
import { surveyNotificationPage } from './survey-notifications.js';
import { getAdminActionNotificationEvents } from './admin-action-notifications.js';

const TYPES = { detailed: ['lecture_requests', 'receipt'] };
async function getSimpleEvents({ since, until, offset }) {
  const token = process.env.BCC_LEAD_NOTIFICATION_READ_TOKEN;
  if (!token) throw new Error('Missing lead notification token');
  const url = new URL('https://bcc-admin-eight.vercel.app/api/lead');
  url.search = new URLSearchParams({ since, until, offset: String(offset) }).toString();
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Lead notification feed unavailable');
  const page = await response.json();
  if (!Array.isArray(page.events) || typeof page.hasMore !== 'boolean') throw new Error('Invalid lead notification feed');
  return page;
}
export function createInquiryNotificationHandler(getDb = supabaseAdmin, getSecret = () => process.env.INQUIRY_NOTIFICATION_SECRET, simpleEvents = getSimpleEvents) {
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
    if ((!Object.hasOwn(TYPES, kind) && !['simple','survey','admin_action'].includes(kind)) || typeof since !== 'string' || typeof until !== 'string' ||
        !Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) ||
        Date.parse(since) > Date.parse(until) || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
      return res.status(400).json({ error: 'invalid request' });
    }
    try {
      if (kind === 'simple') return res.status(200).json(await simpleEvents({ since, until, offset }));
      if (kind === 'admin_action') return res.status(200).json(await getAdminActionNotificationEvents(getDb(), {since,until,offset,now:new Date(until)}));
      if (kind === 'survey') return res.status(200).json(await surveyNotificationPage(getDb(), {until, offset}));
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
