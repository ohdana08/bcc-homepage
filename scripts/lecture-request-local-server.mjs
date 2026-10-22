// Local-only browser harness. No production credentials, database or AI calls.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const ADMIN_TOKEN = 'local-synthetic-admin';
export const MEMBER_TOKEN = 'local-synthetic-member';

const copy = (value) => value === undefined ? undefined : structuredClone(value);

/** In-memory bytes only. Never constructs a Supabase URL or reads credentials. */
export function createMemoryStorage() {
  const objects = new Map(), calls = [];
  const failures = new Map();
  return {
    objects, calls,
    fail(operation, error = { message: 'Synthetic storage outage', statusCode: '503' }) { failures.set(operation, error); },
    recover(operation) { operation ? failures.delete(operation) : failures.clear(); },
    from(bucket) {
      if (bucket !== 'lecture-request-forms') throw new Error('Fixture storage bucket not implemented');
      return {
        async upload(path, bytes, options = {}) {
          calls.push({ operation: 'upload', bucket, path });
          if (failures.has('upload')) return { data: null, error: copy(failures.get('upload')) };
          const key = `${bucket}/${path}`;
          if (objects.has(key) && !options.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
          const buffer = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(await new Blob([bytes]).arrayBuffer());
          objects.set(key, { bytes: buffer, contentType: options.contentType || 'application/octet-stream' });
          return { data: { path }, error: null };
        },
        async download(path) {
          calls.push({ operation: 'download', bucket, path });
          if (failures.has('download')) return { data: null, error: copy(failures.get('download')) };
          const object = objects.get(`${bucket}/${path}`);
          return object ? { data: new Blob([object.bytes], { type: object.contentType }), error: null }
            : { data: null, error: { message: 'Object not found', statusCode: '404' } };
        },
      };
    },
  };
}

/** A deliberately bounded PostgREST-shaped fixture, not a PostgreSQL/RLS test. */
export function createMemoryDb({ tables: seed = {}, rpcHandlers = {} } = {}) {
  const tables = {
    profiles: [{ id: ADMIN_ID, is_admin: true }, { id: MEMBER_ID, is_admin: false }],
    proposal_cases: [], lecture_institutions: [], lecture_requests: [], lecture_request_revisions: [],
    training_need_surveys: [], training_need_responses: [], lecture_request_attachments: [],
    ...copy(seed),
  };
  const calls = [];
  let failure = null;
  function from(table) {
    if (!Object.hasOwn(tables, table)) throw new Error(`Fixture table not implemented: ${table}`);
    let operation = 'select', changes, columns = '*', options = {}, take = null, skip = 0;
    let sort = null, single = false, maybe = false;
    const filters = [];
    const chain = {
      select(value = '*', opts = {}) { columns = value; options = opts; return chain; },
      eq(key, value) { filters.push(row => row[key] === value); return chain; },
      neq(key, value) { filters.push(row => row[key] !== value); return chain; },
      is(key, value) { filters.push(row => (row[key] ?? null) === value); return chain; },
      in(key, values) { filters.push(row => values.includes(row[key])); return chain; },
      gt(key, value) { filters.push(row => row[key] > value); return chain; },
      gte(key, value) { filters.push(row => row[key] >= value); return chain; },
      lt(key, value) { filters.push(row => row[key] < value); return chain; },
      lte(key, value) { filters.push(row => row[key] <= value); return chain; },
      order(key, opts = {}) { sort = { key, ascending: opts.ascending !== false }; return chain; },
      limit(value) { take = value; return chain; },
      range(start, end) { skip = start; take = end - start + 1; return chain; },
      insert(value) { operation = 'insert'; changes = value; return chain; },
      update(value) { operation = 'update'; changes = value; return chain; },
      single() { single = true; return chain; },
      maybeSingle() { single = true; maybe = true; return chain; },
      then(yes, no) { return execute().then(yes, no); },
    };
    async function execute() {
      calls.push({ table, operation, columns });
      if (failure) return { data: null, error: copy(failure), count: null };
      let selected = tables[table].filter(row => filters.every(match => match(row)));
      if (operation === 'insert') {
        const batch = (Array.isArray(changes) ? changes : [changes]).map(value => ({
          id: randomUUID(), created_at: new Date().toISOString(), ...copy(value),
        }));
        if (table === 'training_need_responses' && batch.some(value => tables[table].some(row =>
          row.survey_id === value.survey_id && row.idempotency_key === value.idempotency_key))) {
          return { data: null, error: { code: '23505', message: 'Synthetic duplicate' } };
        }
        tables[table].push(...batch);
        selected = batch;
      }
      if (operation === 'update') selected.forEach(row => Object.assign(row, copy(changes)));
      const count = selected.length;
      if (sort) selected.sort((a, b) => String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? '')) * (sort.ascending ? 1 : -1));
      selected = selected.slice(skip, take === null ? undefined : skip + take);
      const selectedColumns = columns.split(',').map(value => value.trim());
      const projected = columns === '*' ? copy(selected) : selected.map(row => {
        const result = Object.fromEntries(selectedColumns.filter(key => Object.hasOwn(row, key)).map(key => [key, copy(row[key])]));
        if (selectedColumns.includes('training_need_responses(count)')) result.training_need_responses = [{ count: tables.training_need_responses.filter(answer => answer.survey_id === row.id).length }];
        return result;
      });
      if (single && selected.length !== 1 && !(maybe && selected.length === 0)) {
        return { data: null, error: { code: 'PGRST116', message: 'Synthetic row count' }, count };
      }
      return { data: options.head ? null : single ? projected[0] ?? null : projected, error: null, count };
    }
    return chain;
  }
  return {
    tables, calls, from,
    fail(value = { code: 'SYNTHETIC_FAILURE', message: 'Synthetic outage' }) { failure = value; },
    recover() { failure = null; },
    auth: { async getUser(token) {
      const id = token === ADMIN_TOKEN ? ADMIN_ID : token === MEMBER_TOKEN ? MEMBER_ID : null;
      return id ? { data: { user: { id, email: 'synthetic@example.invalid' } }, error: null }
        : { data: { user: null }, error: { message: 'Invalid synthetic token' } };
    } },
    async rpc(name, args) {
      calls.push({ rpc: name, args: copy(args) });
      if (failure) return { data: null, error: copy(failure) };
      if (!rpcHandlers[name]) throw new Error(`Fixture RPC not implemented: ${name}`);
      return rpcHandlers[name](copy(args), tables);
    },
  };
}

/** Synthetic RPC semantics for HTTP/UI tests. Atomic SQL and grants need a real PG test. */
export function createLectureFixture() {
  const rate = new Map();
  const ok = data => ({ data, error: null });
  const failure = error => ok({ error });
  const findRequest = (args, tables) => tables.lecture_requests.find(row => row.receipt === args.p_receipt && row.key_hash === args.p_key_hash && Date.parse(row.editable_until) > Date.now());
  const db = createMemoryDb({ rpcHandlers: {
    lecture_request_rate(args) {
      const key = `${args.p_action}:${args.p_bucket}`;
      const hits = (rate.get(key) || 0) + 1;
      rate.set(key, hits);
      return hits > (args.p_action === 'submit' ? 20 : 120) ? failure('limit') : ok({ ok: true });
    },
    lecture_request_submit(args, tables) {
      const old = tables.lecture_requests.find(row => row.idempotency_key === args.p_idempotency);
      if (old) return old.key_hash !== args.p_key_hash || Date.parse(old.editable_until) <= Date.now()
        ? failure('conflict') : ok({ ok: true, receipt: old.receipt, revision: old.revision, duplicate: true });
      const date = new Date().toISOString();
      const payload = args.p_payload;
      const lecture = { id: randomUUID(), owner_id: ADMIN_ID, institution_id: null, institution_name: payload.institution_name, project_name: payload.project_name || null, contact_name: payload.contact_name, contact_email: payload.contact_email, contact_phone: payload.contact_phone || null, audience: payload.audience, audience_size: payload.audience_size, lecture_date: payload.lecture_date || null, duration_hours: payload.duration_hours, budget: payload.total_budget, goals: payload.purpose, inquiry_text: payload.purpose, status: 'inquiry', source: 'lecture_request', created_at: date, updated_at: date };
      const row = { receipt: randomUUID(), case_id: lecture.id, idempotency_key: args.p_idempotency, key_hash: args.p_key_hash, payload: copy(payload), revision: 1, editable_until: new Date(Date.now() + 90 * 86400000).toISOString(), consent_version: args.p_consent_version, created_at: date, updated_at: date };
      tables.proposal_cases.push(lecture); tables.lecture_requests.push(row);
      tables.lecture_request_revisions.push({ receipt: row.receipt, revision: 1, payload: copy(payload) });
      return ok({ ok: true, receipt: row.receipt, revision: 1, duplicate: false });
    },
    lecture_request_get(args, tables) {
      const row = findRequest(args, tables);
      return row ? ok(copy({ receipt: row.receipt, payload: row.payload, revision: row.revision, editable_until: row.editable_until })) : failure('not_found');
    },
    lecture_request_update(args, tables) {
      const row = findRequest(args, tables);
      if (!row) return failure('not_found');
      if (row.revision === args.p_revision + 1 && JSON.stringify(row.payload) === JSON.stringify(args.p_payload)) return ok({ ok: true, receipt: row.receipt, revision: row.revision, duplicate: true });
      if (row.revision !== args.p_revision) return failure('conflict');
      if (row.revision >= 100) return failure('limit');
      row.payload = copy(args.p_payload); row.revision += 1; row.updated_at = new Date().toISOString();
      tables.lecture_request_revisions.push({ receipt: row.receipt, revision: row.revision, payload: copy(row.payload) });
      return ok({ ok: true, receipt: row.receipt, revision: row.revision });
    },
    lecture_request_ensure_survey(args, tables) {
      const lecture = tables.proposal_cases.find(row => row.id === args.p_case_id);
      if (!lecture || args.p_admin !== ADMIN_ID) return failure('not_found');
      let survey = tables.training_need_surveys.find(row => row.case_id === args.p_case_id);
      if (!survey) {
        survey = { id: randomUUID(), case_id: lecture.id, created_by: ADMIN_ID, public_code: randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase(), institution_label: lecture.institution_name, title: lecture.project_name || '교육생 사전 수요조사', audience_label: lecture.audience, lecture_date: lecture.lecture_date, expected_response_count: lecture.audience_size, status: 'open', is_sample: true, response_deadline: null, created_at: new Date().toISOString() };
        tables.training_need_surveys.push(survey);
      }
      return ok({ survey: copy(survey) });
    },
    lecture_request_attachment_reserve(args, tables) {
      if (!findRequest(args, tables)) return failure('not_found');
      const existing = tables.lecture_request_attachments.find(row => row.id === args.p_upload_id);
      if (existing) {
        if (existing.receipt !== args.p_receipt || existing.original_name !== args.p_name || existing.mime_type !== args.p_mime || existing.byte_size !== args.p_size || existing.sha256 !== args.p_sha256) return failure('conflict');
        return ok({ attachment: copy(existing) });
      }
      const rows = tables.lecture_request_attachments.filter(row => row.receipt === args.p_receipt);
      if (rows.length >= 3 || rows.reduce((sum, row) => sum + row.byte_size, 0) + args.p_size > 6 * 1024 * 1024) return failure('limit');
      const row = { id: args.p_upload_id, receipt: args.p_receipt, original_name: args.p_name, mime_type: args.p_mime, byte_size: args.p_size, sha256: args.p_sha256, object_path: `${args.p_receipt}/${args.p_upload_id}`, status: 'pending', created_at: new Date().toISOString() };
      tables.lecture_request_attachments.push(row);
      return ok({ attachment: copy(row) });
    },
    lecture_request_attachment_ready(args, tables) {
      if (!findRequest(args, tables)) return failure('not_found');
      const row = tables.lecture_request_attachments.find(value => value.receipt === args.p_receipt && value.id === args.p_attachment_id);
      if (!row) return failure('not_found');
      row.status = 'ready';
      return ok({ attachment: copy(row) });
    },
  } });
  db.storage = createMemoryStorage();
  return db;
}

function decorateResponse(res) {
  res.status = (status) => { res.statusCode = status; return res; };
  res.json = (data) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); return res; };
  res.send = (data) => { res.end(data); return res; };
  return res;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8' };

export async function createLocalServer({ handler, attachmentHandler, db, port = 0 } = {}) {
  if (typeof handler !== 'function' || !db) throw new Error('Explicit synthetic handler and database are required.');
  const server = http.createServer(async (req, originalRes) => {
    const res = decorateResponse(originalRes);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Local-Synthetic-Fixture', 'true');
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
        return res.status(403).json({ error: 'Loopback fixture only' });
      }
      if (['/api/lecture-request', '/api/lecture-request-attachments', '/api/cardnews-generate'].includes(url.pathname)) {
        const attachments = url.pathname === '/api/lecture-request-attachments';
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > (attachments ? 3 * 1024 * 1024 : 65536)) return res.status(413).json({ error: 'Fixture request too large' });
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        try { req.body = text ? JSON.parse(text) : {}; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
        if (attachments && req.body.action !== 'upload' && bytes > 65536) return res.status(413).json({ error: 'Fixture request too large' });
        req.query = Object.fromEntries(url.searchParams);
        if (attachments) {
          const handle = attachmentHandler || (await import('../lib/lecture-request-attachments.js')).handleLectureRequestAttachments;
          return await handle(req, res, { db, rateSecret: 'synthetic-rate-secret-not-production' });
        }
        if (url.pathname === '/api/cardnews-generate') {
          if (req.body.engine !== 'training_needs_public') return res.status(403).json({ error: 'Only synthetic public learner survey enabled' });
          const { handleTrainingNeedsPublic } = await import('../lib/training-needs.js');
          return await handleTrainingNeedsPublic(req, res, { db });
        }
        return await handler(req, res, { db });
      }
      if (url.pathname === '/api/config') return res.json({ supabaseUrl: origin, supabaseAnonKey: 'local-fixture-no-privileges' });
      if (url.pathname === '/pay-config.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end('window.BCC_API_BASE=location.origin;window.BCC_GA_ID="";');
      }
      if (url.pathname === '/api/my-enrollments') return res.json({ is_admin: req.headers.authorization === `Bearer ${ADMIN_TOKEN}`, enrollments: [] });
      if (url.pathname === '/auth/v1/user') {
        const result = await db.auth.getUser(req.headers.authorization?.replace(/^Bearer /, ''));
        return result.error ? res.status(401).json(result.error) : res.json(result.data.user);
      }
      if (url.pathname === '/__fixture/sign-in') {
        const session = { access_token: ADMIN_TOKEN, refresh_token: 'synthetic-no-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: ADMIN_ID, email: 'synthetic@example.invalid', role: 'authenticated' } };
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>로컬 합성 관리자</title><p>실제 계정·고객 데이터가 없는 로컬 검토 화면입니다.</p><button id="open">합성 관리자 화면 열기</button><script>document.getElementById('open').onclick=()=>{localStorage.setItem('sb-127-auth-token',JSON.stringify(${JSON.stringify(session)}));location.href='/admin-lecture-requests.html';};</script></html>`);
      }
      if (url.pathname === '/__fixture/mobile') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'");
        return res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>강의의뢰 모바일 합성 검토</title><style>html{background:#dfe3df;color:#183d32;font-family:system-ui,sans-serif}body{margin:0;padding:24px;display:grid;justify-content:center;gap:12px}h1{font-size:17px;margin:0}p{font-size:12px;margin:0;max-width:390px;line-height:1.6}iframe{display:block;width:390px;height:844px;border:0;background:#fff;box-shadow:0 8px 36px #15372e22}small{font-size:11px}</style></head><body><h1>로컬 합성 검토 · 390 × 844px</h1><p>아래 테두리 안이 모바일 화면의 표시 영역입니다. 실제 휴대폰·터치 키보드 검증과는 구분합니다.</p><iframe title="390px 강의의뢰 모바일 화면" src="/lecture-request/" width="390" height="844" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="clipboard-write"></iframe><small>운영 데이터·외부 API를 사용하지 않는 로컬 검토 서버</small></body></html>`);
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return res.status(404).json({ error: 'Fixture route not implemented' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.split('/').some(part => part.startsWith('.') || ['lib', 'supabase', 'test', 'scripts', 'node_modules'].includes(part))) return res.status(404).end();
      if (['/package.json', '/package-lock.json', '/vercel.json'].includes(pathname)) return res.status(404).end();
      let path = resolve(ROOT, `.${pathname}`);
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      const actual = await realpath(path);
      if (!actual.startsWith(`${ROOT}${sep}`)) return res.status(404).end();
      const extension = extname(actual);
      if (!MIME[extension]) return res.status(404).end();
      res.setHeader('Content-Type', MIME[extension]);
      let content = await readFile(actual);
      if (actual === resolve(ROOT, 'tools/training-needs/index.html')) {
        // The historical learner page uses an absolute production API fallback.
        // Pin only this served test copy to loopback and block all external I/O.
        // No production HTML or shared pay-config.js is modified.
        const bootstrap = '<script>window.BCC_API_BASE=location.origin;window.BCC_GA_ID="";window.gtag=function(){};window.dataLayer=[];</script>';
        content = Buffer.from(content.toString('utf8').replace('<head>', `<head>${bootstrap}`));
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
      }
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.writableEnded) return;
      if (error.code === 'ENOENT') return res.status(404).end();
      res.status(error.httpStatus || 500).json({ error: error.httpStatus ? error.message : 'Synthetic harness failure' });
    }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return { server, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((yes, no) => server.close(error => error ? no(error) : yes())) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { handleLectureRequest } = await import('../lib/lecture-request.js');
  const db = createLectureFixture();
  const server = await createLocalServer({ db, port: Number(process.env.PORT || 5198), handler: (req, res) => handleLectureRequest(req, res, { db, rateSecret: 'synthetic-rate-secret-not-production' }) });
  console.log(`Synthetic-only lecture-request harness: ${server.origin}/lecture-request/`);
  console.log(`Synthetic admin setup: ${server.origin}/__fixture/sign-in`);
}

