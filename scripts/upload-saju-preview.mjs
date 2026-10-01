// Upload one versioned build artifact only. Never upload user birth inputs.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sajuRelease } from '../lib/saju-preview/release.js';
process.loadEnvFile('.vercel/.env.production.local');
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const link = JSON.parse(await readFile('.vercel/project.json', 'utf8'));
  if (link.projectName !== 'bcc-homepage') throw new Error('Wrong deployment project');
  const api = endpoint => {
    try { return JSON.parse(execFileSync('/Users/jinjoopwer/.npm-global/bin/vercel', ['api', endpoint, '--raw'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch { throw new Error('Cannot read the existing BCC connection configuration'); }
  };
  const list = api(`/v10/projects/${link.projectId}/env?teamId=${link.orgId}`);
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const entry = list.envs?.find(item => item.key === key && item.target?.includes('production'));
    if (!entry?.id) throw new Error('Required production connection configuration is unavailable');
    const detail = api(`/v1/projects/${link.projectId}/env/${entry.id}?teamId=${link.orgId}`);
    if (!detail.value) throw new Error('Production connection value is not readable');
    process.env[key] = detail.value;
  }
}
const { supabaseAdmin } = await import('../lib/supabase.js');
const db = supabaseAdmin();
const bytes = await readFile('.private-saju/' + sajuRelease.objectPath);
if (bytes.length !== sajuRelease.gzipBytes || createHash('sha256').update(gunzipSync(bytes)).digest('hex') !== sajuRelease.sha256) throw new Error('Local artifact integrity mismatch');
const buckets = await db.storage.listBuckets();
if (buckets.error) throw new Error('Cannot verify private storage configuration');
const existing = buckets.data.find(bucket => bucket.name === sajuRelease.bucket);
if (existing?.public) throw new Error('Refusing to use a public bucket');
if (!existing) {
  const result = await db.storage.createBucket(sajuRelease.bucket, { public: false, fileSizeLimit: 2_000_000, allowedMimeTypes: ['application/gzip'] });
  if (result.error) throw new Error('Cannot create private preview storage');
}
const upload = await db.storage.from(sajuRelease.bucket).upload(sajuRelease.objectPath, bytes, { contentType: 'application/gzip', cacheControl: '0', upsert: false });
if (upload.error && !['409', '400'].includes(String(upload.error.statusCode))) throw new Error('Cannot upload private preview');
const verifiedBucket = await db.storage.getBucket(sajuRelease.bucket);
if (verifiedBucket.error || verifiedBucket.data?.public !== false) throw new Error('Private storage check failed');
const download = await db.storage.from(sajuRelease.bucket).download(sajuRelease.objectPath);
if (download.error || !download.data || !bytes.equals(Buffer.from(await download.data.arrayBuffer()))) throw new Error('Stored artifact differs from local build');
const publicUrl = db.storage.from(sajuRelease.bucket).getPublicUrl(sajuRelease.objectPath).data.publicUrl;
const anonymous = await fetch(publicUrl);
if (![400, 401, 403, 404].includes(anonymous.status)) throw new Error('Could not confirm anonymous access denial');
console.log(JSON.stringify({ bucket: sajuRelease.bucket, public: false, objectPath: sajuRelease.objectPath, bytes: bytes.length, storedBytesVerified: true, anonymousStatus: anonymous.status }));
