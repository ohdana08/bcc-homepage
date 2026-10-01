// Isolated browser integration verification. Synthetic auth only; no real DB,
// session, key, deployment, or user birth data is used.
// This local allowlist server is NOT evidence of Vercel static-file isolation.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { handleSajuAdmin } from '../lib/saju-preview/handler.js';
import { sajuRelease } from '../lib/saju-preview/release.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(process.env.SAJU_PLAYWRIGHT_PROJECT || '/Users/jinjoopwer/saju-onepage-20261002', 'package.json'));
const { chromium, expect } = require('@playwright/test');
const output = resolve(root, 'test-results-saju-admin');
await mkdir(output, { recursive: true });
// Load ignored local release bytes, never an embedded public-repository payload.
assert.match(sajuRelease.objectPath, /^[a-f0-9]{64}\.html\.gz$/);
const packed = await readFile(resolve(root, '.private-saju', sajuRelease.objectPath));
assert.equal(packed.length, sajuRelease.gzipBytes, 'Local artifact compressed size');
const htmlBytes = gunzipSync(packed, { maxOutputLength: 4_400_000 });
assert.equal(htmlBytes.length, sajuRelease.htmlBytes, 'Local artifact HTML size');
assert.equal(createHash('sha256').update(htmlBytes).digest('hex'), sajuRelease.sha256, 'Local artifact integrity');
const html = htmlBytes.toString('utf8');
const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
const base = 'http://127.0.0.1:5190';
const paths = new Map([
  ['/admin-saju.html', ['admin-saju.html', 'text/html; charset=utf-8']],
  ['/assets/saju-admin.js', ['assets/saju-admin.js', 'application/javascript; charset=utf-8']],
  ['/assets/saju-admin.css', ['assets/saju-admin.css', 'text/css; charset=utf-8']],
]);
const serverState = { apiCalls: 0, completed: 0, probes: 0, delayed: 0, release: null };
const fakeDb = token => ({
  auth: { getUser: async actual => {
    assert.equal(actual, token);
    if (token === 'slow-admin') {
      serverState.delayed++;
      await new Promise(resolveDelay => { serverState.release = resolveDelay; });
    }
    if (token === 'expired') return { data: null, error: { message: 'synthetic expiration' } };
    if (token === 'auth-error') throw new Error('synthetic provider failure');
    return { data: { user: { id: 'synthetic-user', user_metadata: { is_admin: true } } }, error: null };
  } },
  from(name) {
    assert.equal(name, 'profiles');
    return { select(columns) {
      assert.equal(columns, 'is_admin');
      return { eq(column, id) {
        assert.equal(column, 'id'); assert.equal(id, 'synthetic-user');
        return { maybeSingle: async () => ({ data: { is_admin: token !== 'member' }, error: token === 'profile-error' ? { message: 'synthetic DB failure' } : null }) };
      } };
    } };
  },
});
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    const rewrite = config.rewrites.find(item => item.source === url.pathname);
    const target = rewrite ? new URL(rewrite.destination, base) : url;
    if (target.pathname === '/api/claude101-suite' && target.searchParams.get('fn') === 'saju-admin') {
      serverState.apiCalls++;
      req.query = Object.fromEntries(target.searchParams);
      res.status = code => { res.statusCode = code; return res; };
      res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
      res.send = data => res.end(data);
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
      try { await handleSajuAdmin(req, res, { db: fakeDb(token), loadHtml: () => html }); }
      finally { serverState.completed++; }
      return;
    }
    if (url.pathname === '/api/config') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ supabaseUrl: 'https://jhjxrkypnigcohgnzhvq.supabase.co', supabaseAnonKey: 'synthetic-anon-key' }));
      return;
    }
    if (url.pathname === '/__network-probe') serverState.probes++;
    const file = paths.get(url.pathname);
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    for (const item of config.headers.filter(item => item.source === url.pathname)) {
      for (const header of item.headers) res.setHeader(header.key, header.value);
    }
    res.setHeader('Content-Type', file[1]); res.end(await readFile(resolve(root, file[0])));
  } catch (error) {
    res.statusCode = 500; res.end('Local harness error');
    console.error('Harness server failed:', error.message);
  }
});

const results = [];
const report = {
  generatedAt: new Date().toISOString(), base,
  environment: 'Local HTTP with actual shell/CSP/handler and integrity-checked ignored release artifact; synthetic Supabase auth module and handler DB dependencies',
  notVerified: ['Vercel deployment routing/static-file exclusion (parent-owned)', 'Real private Storage download/bucket access control', 'Real Supabase accounts/RLS', 'Physical printing or generated PDF output'],
  payload: { htmlBytes: htmlBytes.length, gzipBytes: packed.length, sha256: sajuRelease.sha256, source: 'ignored local .private-saju release artifact' },
  results,
};
report.sourceHashes = Object.fromEntries(await Promise.all(['api/claude101-suite.js', 'lib/saju-preview/handler.js', 'lib/saju-preview/load.js', 'lib/saju-preview/release.js', 'assets/saju-admin.js', 'admin-saju.html', 'vercel.json', '.gitignore', '.vercelignore'].map(async name => [name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')])));
let browser;
async function run(name, task) {
  const started = performance.now();
  try { const evidence = await task(); results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started), evidence }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'failed', durationMs: Math.round(performance.now() - started), error: error.stack }); console.error('FAIL', name, error.message); }
}
async function session(token = 'admin', options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 }, acceptDownloads: true });
  const requests = [], errors = [], violations = [];
  const page = await context.newPage();
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), hasBody: request.postData() !== null }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (/Content Security Policy|connect-src|Refused to connect/.test(message.text())) violations.push(message.text());
    else if (!/Failed to load resource: the server responded with a status of (401|403|503)/.test(message.text())) errors.push(message.text());
  });
  await context.addInitScript(({ token, refreshToken }) => {
    if (window !== window.top) return;
    window.__testAuth = { token, refreshToken, listeners: [], refreshCalls: 0 };
    localStorage.setItem('saju-parent-sentinel', 'synthetic-parent-only');
  }, { token, refreshToken: options.refreshToken || null });
  await page.route('https://esm.sh/@supabase/supabase-js@2.108.2', route => route.fulfill({
    contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
    body: `export function createClient() {
      const s = window.__testAuth;
      const session = () => s.token ? {access_token:s.token,user:{id:'synthetic-user'}} : null;
      s.signOut = () => { s.token=null; for(const cb of s.listeners)cb('SIGNED_OUT',null); };
      s.switchUser = () => { for(const cb of s.listeners)cb('SIGNED_IN',{access_token:'other-admin',user:{id:'other-user'}}); };
      return {auth:{getSession:async()=>({data:{session:session()},error:null}),
        refreshSession:async()=>{s.refreshCalls++; if(s.refreshToken)s.token=s.refreshToken; return {data:{session:s.refreshToken?session():null},error:s.refreshToken?null:{message:'synthetic refresh denied'}};},
        onAuthStateChange:cb=>{s.listeners.push(cb);return {data:{subscription:{unsubscribe(){}}}};}}};
    }`,
  }));
  await page.goto(base + '/admin-saju.html');
  return { context, page, requests, errors, violations };
}
async function app(page) {
  await expect(page.locator('#workspace iframe')).toHaveCount(1);
  const frame = page.frameLocator('#workspace iframe');
  await expect(frame.getByRole('button', { name: '나의 사주 펼쳐보기', exact: true })).toBeVisible();
  return frame;
}
async function fill(frame, year = '1994', month = '5', day = '18') {
  await frame.getByLabel('태어난 연도', { exact: true }).fill(year);
  await frame.getByLabel('태어난 월', { exact: true }).selectOption(month);
  await frame.getByLabel('태어난 일', { exact: true }).selectOption(day);
  await frame.getByLabel('태어난 시', { exact: true }).selectOption('14');
  await frame.getByLabel('태어난 분', { exact: true }).selectOption('30');
}
async function calculate(frame) {
  await frame.getByRole('button', { name: '나의 사주 펼쳐보기', exact: true }).click();
  await expect(frame.getByRole('heading', { name: '나의 사주 원국', exact: true })).toBeVisible();
}
async function download(page, frame, name, filename) {
  const event = page.waitForEvent('download');
  await frame.getByRole('button', { name, exact: true }).click();
  const item = await event;
  assert.equal(await item.failure(), null);
  await item.saveAs(resolve(output, filename));
  return readFile(resolve(output, filename), 'utf8');
}

try {
  await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(5190, '127.0.0.1', resolveListen); });
  browser = await chromium.launch({ headless: true });
  await run('payload and CSP hash agree; response remains below Vercel 4.5 MB', async () => {
    assert.ok(report.payload.htmlBytes < 4_500_000);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.equal(scripts.length, 1);
    new Script(scripts[0][1]); // Parse exactly the bytes that the browser receives.
    const hash = createHash('sha256').update(scripts[0][1]).digest('base64');
    assert.equal(hash, sajuRelease.scriptHash);
    const shellPolicy = config.headers.find(item => item.source === '/admin-saju.html').headers.find(item => item.key === 'Content-Security-Policy').value;
    assert.ok(shellPolicy.includes(`'sha256-${hash}'`)); assert.ok(html.includes(`'sha256-${hash}'`));
    assert.ok(!/<(?:script|link)\b[^>]*(?:src|href)=/i.test(html));
    return { ...report.payload, scriptSha256: hash };
  });
  await run('actual handler denies anonymous/member/expired/error on both API paths', async () => {
    const outcomes = [];
    for (const path of ['/api/saju-admin', '/api/claude101-suite?fn=saju-admin']) {
      for (const [token, status] of [[null, 401], ['member', 403], ['expired', 401], ['profile-error', 503], ['admin', 200]]) {
        const response = await fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
        const body = await response.text(); assert.equal(response.status, status); assert.match(response.headers.get('cache-control'), /no-store/);
        assert.match(response.headers.get('x-robots-tag'), /noindex/);
        assert.equal(body.startsWith('<!doctype html>'), status === 200);
        if (status !== 200) assert.ok(!body.includes('사주로 읽는'));
        outcomes.push({ path, scenario: token || 'anonymous', status });
      }
    }
    const post = await fetch(base + '/api/saju-admin', { method: 'POST', headers: { Authorization: 'Bearer admin' } });
    assert.equal(post.status, 405); return outcomes;
  });
  await run('signed-out shell never requests the private API', async () => {
    const s = await session(null);
    try {
      await expect(s.page.locator('#login')).toBeVisible(); await expect(s.page.locator('#status')).toContainText('로그인해 주세요');
      assert.equal(s.requests.some(request => request.url.includes('/api/saju-admin')), false);
      await expect(s.page.locator('iframe')).toHaveCount(0); assert.deepEqual(s.errors, []);
    } finally { await s.context.close(); }
  });
  for (const [token, message] of [['member', '관리자만'], ['expired', '관리자 로그인'], ['profile-error', '잠시 후']]) {
    await run(`${token} UI fails closed`, async () => {
      const s = await session(token);
      try { await expect(s.page.locator('#status')).toContainText(message); await expect(s.page.locator('iframe')).toHaveCount(0); await expect(s.page.locator('#retry')).toBeVisible(); assert.deepEqual(s.errors, []); }
      finally { await s.context.close(); }
    });
  }
  await run('401 refresh retries once and succeeds with a new synthetic token', async () => {
    const s = await session('expired', { refreshToken: 'admin' });
    try { await app(s.page); assert.equal(await s.page.evaluate(() => window.__testAuth.refreshCalls), 1); assert.equal(s.requests.filter(r => r.url.endsWith('/api/saju-admin')).length, 2); assert.deepEqual(s.errors, []); }
    finally { await s.context.close(); }
  });
  await run('actual iframe solar/lunar submit, candidate roles, downloads, print hook, anchors', async () => {
    const s = await session();
    try {
      const frame = await app(s.page); const start = performance.now();
      await fill(frame); await calculate(frame);
      await expect(frame.locator('.result-heading')).toContainText('1994-05-18'); await expect(frame.locator('.character')).toHaveCount(8);
      const solarUiMs = Math.round(performance.now() - start);
      await frame.getByRole('button', { name: '음력', exact: true }).click(); await fill(frame, '2023', '2', '1');
      await frame.getByRole('checkbox', { name: /윤달에 태어났어요/ }).check(); await calculate(frame);
      await expect(frame.locator('.result-heading')).toContainText('2023-03-22');
      await frame.getByRole('button', { name: '용신·희신·기신 후보 예시', exact: true }).click();
      await expect(frame.locator('.result-heading')).toContainText('1982-01-07');
      const md = await download(s.page, frame, '리포트 저장', 'candidate.md');
      await frame.getByText('내 리포트의 계산 근거', { exact: false }).click();
      const data = JSON.parse(await download(s.page, frame, '계산 데이터 JSON 저장', 'candidate.json'));
      for (const [key, element] of [['yongshin', '수'], ['heeshin', '목'], ['gishin', '금']]) {
        assert.deepEqual(data.result.yongshin.roles[key].candidates, [element]);
        await expect(frame.locator(`.role-${key} .role-elements`)).toContainText(element);
      }
      assert.match(md, /## 용신·희신·기신/); assert.equal(data.reports.length, 4);
      const liveFrame = s.page.frames().find(item => item.url() === 'about:srcdoc'); assert.ok(liveFrame);
      await liveFrame.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
      await frame.getByRole('button', { name: '리포트 인쇄', exact: true }).click();
      assert.equal(await liveFrame.evaluate(() => window.__printCalls), 1);
      const anchor = frame.locator('a[href="#how-it-works"]').first();
      await anchor.click();
      await expect.poll(() => liveFrame.evaluate(() => Math.abs(document.getElementById('how-it-works').getBoundingClientRect().top))).toBeLessThan(150);
      assert.equal(s.page.url(), base + '/admin-saju.html'); assert.equal(liveFrame.url(), 'about:srcdoc');
      await s.page.screenshot({ path: resolve(output, 'admin-result-1440.png'), fullPage: true });
      assert.deepEqual(s.errors, []); assert.deepEqual(s.violations, []);
      assert.equal(s.requests.filter(r => !r.url.startsWith(base) && !r.url.startsWith('blob:') && !r.url.startsWith('https://esm.sh/')).length, 0);
      assert.equal(s.requests.some(r => r.hasBody || /1994|2023|1982/.test(r.url)), false);
      return { solarUiMs, network: s.requests, print: 'window.print spy only' };
    } finally { await s.context.close(); }
  });
  await run('320/390/1440 shell and iframe remain within viewport', async () => {
    const evidence = [];
    for (const width of [320, 390, 1440]) {
      const s = await session('admin', { width });
      try {
        const frame = await app(s.page);
        assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const liveFrame = s.page.frames().find(f => f.url() === 'about:srcdoc');
        assert.equal(await liveFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width === 390) await s.page.screenshot({ path: resolve(output, 'admin-initial-390.png'), fullPage: true });
        await frame.getByRole('button', { name: '먼저 예시 리포트 살펴보기' }).click();
        await expect(frame.locator('.character')).toHaveCount(8);
        assert.equal(await liveFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (width === 390) await s.page.screenshot({ path: resolve(output, 'admin-result-390.png'), fullPage: true });
        assert.deepEqual(s.errors, []); evidence.push({ width, overflow: false });
      } finally { await s.context.close(); }
    }
    return evidence;
  });
  await run('opaque iframe cannot access parent storage; CSP blocks fetch before server receipt', async () => {
    const s = await session();
    try {
      await app(s.page); const liveFrame = s.page.frames().find(f => f.url() === 'about:srcdoc');
      const sandbox = await s.page.locator('iframe').getAttribute('sandbox');
      assert.ok(!sandbox.includes('allow-same-origin')); assert.ok(sandbox.includes('allow-scripts'));
      const isolation = await liveFrame.evaluate(() => {
        const result = {};
        for (const [name, read] of [['parentStorage', () => parent.localStorage.getItem('saju-parent-sentinel')], ['ownStorage', () => localStorage.length], ['parentDocument', () => parent.document.body.innerText]]) {
          try { read(); result[name] = 'UNEXPECTED_ACCESS'; } catch (error) { result[name] = error.name; }
        }
        return result;
      });
      assert.deepEqual(isolation, { parentStorage: 'SecurityError', ownStorage: 'SecurityError', parentDocument: 'SecurityError' });
      const before = serverState.probes;
      const blocked = await liveFrame.evaluate(async url => {
        const violation = new Promise(resolveViolation => document.addEventListener('securitypolicyviolation', event => resolveViolation(event.effectiveDirective), { once: true }));
        let rejected = false; try { await fetch(url); } catch { rejected = true; }
        return { rejected, directive: await violation };
      }, base + '/__network-probe');
      assert.deepEqual(blocked, { rejected: true, directive: 'connect-src' }); assert.equal(serverState.probes, before);
      assert.deepEqual(s.errors, []); return { sandbox, isolation, blocked, receivedProbeRequests: serverState.probes - before };
    } finally { await s.context.close(); }
  });
  await run('close/reopen removes all input and results; sign-out and user change clear iframe', async () => {
    const s = await session();
    try {
      let frame = await app(s.page); await fill(frame); await calculate(frame);
      await s.page.locator('#close-preview').click(); await expect(s.page.locator('iframe')).toHaveCount(0);
      await s.page.locator('#retry').click(); frame = await app(s.page);
      await expect(frame.getByLabel('태어난 연도', { exact: true })).toHaveValue(''); await expect(frame.locator('.pillars-grid')).toHaveCount(0);
      await s.page.evaluate(() => window.__testAuth.switchUser()); await expect(s.page.locator('iframe')).toHaveCount(0);
      await s.page.locator('#retry').click(); await app(s.page);
      await s.page.evaluate(() => window.__testAuth.signOut()); await expect(s.page.locator('iframe')).toHaveCount(0);
      await expect(s.page.locator('#login')).toBeVisible(); assert.deepEqual(s.errors, []);
    } finally { await s.context.close(); }
  });
  await run('delayed authorized response cannot restore iframe after sign-out', async () => {
    const before = serverState.completed;
    const delayedBefore = serverState.delayed;
    const s = await session('slow-admin');
    try {
      await expect.poll(() => serverState.delayed).toBe(delayedBefore + 1);
      await s.page.evaluate(() => window.__testAuth.signOut());
      await expect(s.page.locator('#login')).toBeVisible(); serverState.release();
      await expect.poll(() => serverState.completed).toBeGreaterThan(before);
      await expect(s.page.locator('iframe')).toHaveCount(0); await expect(s.page.locator('#gate')).toBeVisible(); assert.deepEqual(s.errors, []);
    } finally { serverState.release?.(); await s.context.close(); }
  });
  await run('delayed admin A response cannot appear after SIGNED_IN for another user', async () => {
    const before = serverState.completed;
    const delayedBefore = serverState.delayed;
    const s = await session('slow-admin');
    try {
      await expect.poll(() => serverState.delayed).toBe(delayedBefore + 1);
      await s.page.evaluate(() => window.__testAuth.switchUser());
      await expect(s.page.locator('#login')).toBeVisible(); serverState.release();
      await expect.poll(() => serverState.completed).toBeGreaterThan(before);
      await expect(s.page.locator('iframe')).toHaveCount(0); await expect(s.page.locator('#gate')).toBeVisible(); assert.deepEqual(s.errors, []);
    } finally { serverState.release?.(); await s.context.close(); }
  });
} catch (error) {
  report.setupError = error.stack; console.error('Setup failed:', error.message);
} finally {
  await browser?.close(); serverState.release?.();
  await new Promise(resolveClose => server.close(resolveClose));
  report.passed = results.filter(item => item.status === 'passed').length;
  report.failed = results.filter(item => item.status === 'failed').length;
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, setupError: !!report.setupError, report: resolve(output, 'verification.json') }));
  if (report.failed || report.setupError) process.exitCode = 1;
}
