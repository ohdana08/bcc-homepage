import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { sajuRelease } from './release.js';

let cachedHtml;
export async function loadPrivateSajuHtml() {
  if (cachedHtml) return cachedHtml;
  const { supabaseAdmin } = await import('../supabase.js');
  const { data, error } = await supabaseAdmin().storage.from(sajuRelease.bucket).download(sajuRelease.objectPath);
  if (error || !data || data.size !== sajuRelease.gzipBytes) throw new Error('Private preview unavailable');
  const html = gunzipSync(Buffer.from(await data.arrayBuffer()), { maxOutputLength: 4_400_000 });
  if (html.length !== sajuRelease.htmlBytes || createHash('sha256').update(html).digest('hex') !== sajuRelease.sha256) throw new Error('Private preview integrity check failed');
  cachedHtml = html.toString('utf8');
  return cachedHtml;
}
