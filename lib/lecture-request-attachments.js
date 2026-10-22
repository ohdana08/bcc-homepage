import { createHash, createHmac } from 'node:crypto';

export const ATTACHMENT_BUCKET = 'lecture-request-forms';
export const ATTACHMENT_CONSENT_VERSION = '2026-10-22-attachment-v1';
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = {
  pdf: 'application/pdf', hwp: 'application/x-hwp', hwpx: 'application/vnd.hancom.hwpx',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const fail = (status, message) => Object.assign(new Error(message), { httpStatus: status });
const sha = value => createHash('sha256').update(value).digest('hex');
function id(value) { if (typeof value !== 'string' || !UUID.test(value)) throw fail(400, '첨부 기록 번호를 확인해 주세요.'); return value.toLowerCase(); }
function keyHash(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw fail(404, '수정 링크를 확인해 주세요.'); return sha(value); }
function checked(result) { if (result.error) throw fail(503, '첨부 저장소에 연결하지 못했습니다. 접수는 보존되며 첨부를 다시 시도할 수 있습니다.'); return result.data; }
function attachment(row) { return { id: row.id, name: row.original_name, size: row.byte_size, mime: row.mime_type, status: row.status }; }

// Read only ZIP headers, never extract user documents or invoke a document parser.
function isOfficeZip(bytes, extension) {
  if (bytes.readUInt32LE(0) !== 0x04034b50) return false;
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) return false;
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count > 2000 || start + size !== end || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) return false;
  let offset = start, expanded = 0;
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return false;
    if (bytes.readUInt16LE(offset + 8) & 1) return false;
    expanded += bytes.readUInt32LE(offset + 24);
    const n = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    if (expanded > 50 * 1024 * 1024 || offset + 46 + n + extra + comment > end) return false;
    const name = bytes.subarray(offset + 46, offset + 46 + n).toString('utf8');
    if (!name || /[\\\x00]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || /vbaProject\.bin$/i.test(name)) return false;
    names.add(name); offset += 46 + n + extra + comment;
  }
  if (offset !== end) return false;
  if (extension === 'hwpx') return names.has('mimetype') && names.has('Contents/content.hpf');
  return names.has('[Content_Types].xml') && names.has({docx:'word/document.xml', xlsx:'xl/workbook.xml', pptx:'ppt/presentation.xml'}[extension]);
}

export function normalizeAttachment(filename, encoded) {
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 180 || /[\/\\\x00-\x1f\x7f]/.test(filename)) throw fail(400, '파일 이름을 확인해 주세요.');
  const name = filename.trim().normalize('NFC');
  const extension = name.split('.').at(-1).toLowerCase();
  if (!TYPES[extension]) throw fail(415, '한글·워드·엑셀·파워포인트·PDF·PNG·JPG 파일을 첨부해 주세요.');
  if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(MAX_FILE_BYTES / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw fail(400, '파일 전송 형식을 확인해 주세요.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw fail(413, '파일은 1개당 2MB까지 첨부할 수 있습니다.');
  if (bytes.toString('base64') !== encoded) throw fail(400, '파일 전송 형식을 확인해 주세요.');
  let valid = false;
  if (extension === 'pdf') valid = bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
  else if (extension === 'png') valid = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  else if (extension === 'jpg' || extension === 'jpeg') valid = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (['hwp', 'doc', 'xls', 'ppt'].includes(extension)) valid = bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  else if (bytes.length >= 22) valid = isOfficeZip(bytes, extension);
  if (!valid) throw fail(415, '파일 내용과 확장자가 맞지 않거나 지원하지 않는 문서입니다. 원본 파일이나 PDF로 다시 첨부해 주세요.');
  return { name, mime: TYPES[extension], size: bytes.length, sha256: sha(bytes), bytes };
}

function parse(req) {
  if (Number(req.headers?.['content-length']) > MAX_BODY_BYTES) throw fail(413, '파일은 1개당 2MB까지 첨부할 수 있습니다.');
  if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw fail(415, 'JSON 형식으로 전송해 주세요.');
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw fail(413, '파일은 1개당 2MB까지 첨부할 수 있습니다.');
    try { body = JSON.parse(String(body)); } catch { throw fail(400, '입력 형식을 확인해 주세요.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '입력 내용을 확인해 주세요.');
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw fail(413, '파일은 1개당 2MB까지 첨부할 수 있습니다.');
  const allowed = {list:['action','receipt','key'], download:['action','receipt','key','attachment_id'], upload:['action','receipt','key','upload_id','filename','data_base64','consent','consent_version']}[body.action];
  if (!allowed || Object.keys(body).some(key => !allowed.includes(key))) throw fail(400, '지원하지 않는 첨부 요청입니다.');
  if (body.action !== 'upload' && Buffer.byteLength(JSON.stringify(body)) > 4000) throw fail(413, '입력 내용이 너무 큽니다.');
  body.receipt = id(body.receipt);
  if (body.action === 'download') body.attachment_id = id(body.attachment_id);
  if (body.action === 'upload') {
    body.upload_id = id(body.upload_id);
    if (body.consent !== true || body.consent_version !== ATTACHMENT_CONSENT_VERSION) throw fail(400, '첨부파일 수집·이용 안내를 확인하고 동의해 주세요.');
  }
  return body;
}

async function rpc(db, name, args) {
  const value = checked(await db.rpc(name, args));
  if (value?.error === 'not_found') throw fail(404, '수정 링크가 올바르지 않거나 유효기간이 지났습니다.');
  if (value?.error === 'limit') throw fail(429, name === 'lecture_request_rate' ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '첨부는 최대 3개입니다. 전송 중인 파일은 같은 파일로 다시 시도해 주세요.');
  if (value?.error === 'conflict') throw fail(409, '같은 첨부 번호에 다른 파일을 저장할 수 없습니다. 원래 파일로 다시 시도해 주세요.');
  if (!value || value.error) throw fail(503, '첨부 기록을 저장하지 못했습니다. 다시 시도해 주세요.');
  return value;
}

export async function handleLectureRequestAttachments(req, res, dependencies = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw fail(405, '지원하지 않는 요청 방식입니다.'); }
    const origins = new Set(['https://bccconsulting.kr', 'https://www.bccconsulting.kr']);
    if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
    const origin = req.headers?.origin;
    if (origin && !origins.has(origin) && !(process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) throw fail(403, 'BCC 강의의뢰 페이지에서 접속해 주세요.');
    const body = parse(req);
    const admin = !!req.headers?.authorization;
    if (admin && body.action === 'upload') throw fail(403, '의뢰서의 수정 링크에서 첨부해 주세요.');
    const digest = admin ? null : keyHash(body.key);
    const db = dependencies.db || (await import('./supabase.js')).supabaseAdmin();
    if (admin) {
      const auth = req.headers.authorization;
      if (!/^Bearer \S+$/i.test(auth)) throw fail(401, '관리자 로그인이 필요합니다.');
      const user = await db.auth.getUser(auth.slice(7));
      if (user.error || !user.data?.user?.id) throw fail(401, '관리자 로그인을 다시 해주세요.');
      const profile = checked(await db.from('profiles').select('is_admin').eq('id', user.data.user.id).maybeSingle());
      if (!profile?.is_admin) throw fail(403, '관리자만 사용할 수 있습니다.');
      if (!checked(await db.from('lecture_requests').select('receipt').eq('receipt', body.receipt).maybeSingle())) throw fail(404, '접수 기록을 찾을 수 없습니다.');
    } else {
      const pepper = dependencies.rateSecret || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!pepper) throw fail(503, '접수 환경을 확인하고 있습니다.');
      const day = new Date(dependencies.now ? dependencies.now() : Date.now()).toISOString().slice(0, 10);
      const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').slice(0, 150);
      const bucket = createHmac('sha256', pepper).update(`${day}:${ip}`).digest('hex');
      await rpc(db, 'lecture_request_rate', { p_bucket: bucket, p_action: body.action === 'upload' ? 'update' : 'get' });
      await rpc(db, 'lecture_request_get', { p_receipt: body.receipt, p_key_hash: digest });
    }
    if (body.action === 'list') {
      const rows = checked(await db.from('lecture_request_attachments').select('id,original_name,byte_size,mime_type,status').eq('receipt', body.receipt).order('created_at').limit(3));
      return res.json({ attachments: rows.map(attachment) });
    }
    const storage = db.storage.from(ATTACHMENT_BUCKET);
    if (body.action === 'download') {
      const row = checked(await db.from('lecture_request_attachments').select('*').eq('id', body.attachment_id).eq('receipt', body.receipt).eq('status', 'ready').maybeSingle());
      if (!row) throw fail(404, '첨부파일을 찾을 수 없습니다.');
      if (row.object_path !== `${body.receipt}/${row.id}`) throw fail(503, '첨부 기록을 확인해 주세요.');
      const blob = checked(await storage.download(row.object_path));
      if (blob.size !== row.byte_size || blob.size > MAX_FILE_BYTES) throw fail(503, '첨부파일 상태를 확인해 주세요.');
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (sha(bytes) !== row.sha256) throw fail(503, '첨부파일 상태를 확인해 주세요.');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(row.original_name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
      res.setHeader('Content-Length', bytes.length);
      return res.end(bytes);
    }
    const file = normalizeAttachment(body.filename, body.data_base64);
    const reserved = await rpc(db, 'lecture_request_attachment_reserve', { p_receipt: body.receipt, p_key_hash: digest, p_upload_id: body.upload_id, p_name: file.name, p_mime: file.mime, p_size: file.size, p_sha256: file.sha256 });
    const row = reserved.attachment;
    if (!row || row.object_path !== `${body.receipt}/${body.upload_id}`) throw fail(503, '첨부 기록을 확인해 주세요.');
    if (row.status === 'ready') return res.json({ attachment: attachment(row) });
    const uploaded = await storage.upload(row.object_path, file.bytes, { contentType: file.mime, upsert: false, cacheControl: '0' });
    if (uploaded.error) {
      // Storage may have saved the bytes even when its response was lost. SDK
      // error shapes differ by version; exact path + size + hash decide recovery.
      const existing = checked(await storage.download(row.object_path));
      if (existing.size !== file.size || existing.size > MAX_FILE_BYTES || sha(Buffer.from(await existing.arrayBuffer())) !== file.sha256) throw fail(409, '기존 첨부파일과 내용이 다릅니다.');
    }
    const ready = await rpc(db, 'lecture_request_attachment_ready', { p_receipt: body.receipt, p_key_hash: digest, p_attachment_id: body.upload_id });
    return res.status(201).json({ attachment: attachment(ready.attachment) });
  } catch (error) {
    return res.status(error.httpStatus || 503).json({ error: error.httpStatus ? error.message : '첨부를 처리하지 못했습니다. 접수는 보존되며 첨부를 다시 시도할 수 있습니다.' });
  }
}
