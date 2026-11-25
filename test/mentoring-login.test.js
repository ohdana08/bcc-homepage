// Google 계정이 둘일 때 등록하지 않은 계정을 고르는 경우와, 지난 계정 선택 화면에서 다시 골라 인증 상태가 틀어진 경우를 가상으로 재현한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import enter from '../api/mentoring-entry.js';

const read = name => fs.readFileSync(new URL('../assets/' + name, import.meta.url), 'utf8');
const store = initial => { const data = new Map(Object.entries(initial)); return {getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data}; };

test('the server passes the unregistered reason to the confirmation screen', async t => {
  Object.assign(process.env, {MENTORING_ORIGIN: 'https://private.example', MENTORING_ADMIN_SECRET: 'm'.repeat(40), SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'public-fixture'});
  const previous = globalThis.fetch; t.after(() => globalThis.fetch = previous);
  globalThis.fetch = async url => String(url).includes('auth.example')
    ? {ok: true, json: async () => ({email: 'other@example.test', email_confirmed_at: '2026-11-25'})}
    : {ok: false, status: 403, json: async () => ({code: 'unregistered'})};
  const res = {code: 200, status(n) { this.code = n; return this; }, json(d) { this.body = d; return this; }, setHeader() {}};
  await enter({method: 'POST', headers: {origin: 'https://bccconsulting.kr', authorization: 'Bearer ' + 'a'.repeat(40), 'content-type': 'application/json'}, body: {flow: 'f'.repeat(43)}}, res);
  assert.equal(res.code, 403);
  assert.equal(res.body.code, 'unregistered');
  assert.match(res.body.error, /이 계정은 등록되지 않았습니다/);
});

test('picking the unregistered account shows why and offers the account chooser again', async () => {
  const elements = {};
  const element = id => elements[id] ??= {id, hidden: true, textContent: '', dataset: {}};
  const storage = store({'bcc-mentoring-flow': 'f'.repeat(43), 'bcc-mentoring-pkce': 'v'.repeat(48)});
  let submitted = false;
  const answers = {
    '/api/config': {supabaseUrl: 'https://auth.example', supabaseAnonKey: 'public'},
    '/auth/v1/token': {access_token: 't', user: {email: 'other@example.test'}},
    '/api/mentoring-entry': {code: 'unregistered', error: '이 계정은 등록되지 않았습니다. 등록한 이메일의 계정으로 로그인해 주세요.'},
  };
  const context = {
    URL, URLSearchParams, Uint8Array, TextEncoder, btoa, crypto, sessionStorage: storage,
    location: {search: '?code=abc', pathname: '/student-works/mentoring-auth.html', origin: 'https://bccconsulting.kr', assign() {}},
    history: {replaceState() {}},
    document: {getElementById: element, createElement: () => ({append() {}, submit() { submitted = true; }}), body: {append() {}}},
    fetch: async url => { const path = new URL(String(url), 'https://bccconsulting.kr').pathname; return {ok: path !== '/api/mentoring-entry', json: async () => answers[path]}; },
  };
  vm.runInNewContext(read('mentoring-auth.js'), context);
  await new Promise(r => setTimeout(r, 30));
  assert.match(elements.status.textContent, /이 계정은 등록되지 않았습니다/);
  assert.equal(elements.methods.hidden, false);
  assert.equal(elements.google.textContent, '다른 Google 계정 고르기');
  assert.ok(storage.getItem('bcc-mentoring-flow'), '같은 입장 흐름으로 다시 고를 수 있어야 한다');
  assert.equal(submitted, false);
});

test('a stale account chooser returns to the mentoring flow, and other admin visits are untouched', () => {
  for (const [initial, search, expected] of [
    [{'bcc-mentoring-done': String(Date.now())}, '?error=invalid_request&error_code=bad_oauth_state', 'https://bcc-modu-mentoring.vercel.app/student-works/mentoring/'],
    [{'bcc-mentoring-done': String(Date.now() - 3600000)}, '?error_code=bad_oauth_state', undefined],
    [{'bcc-mentoring-flow': 'x'}, '?error_code=bad_oauth_state', '/student-works/mentoring-auth.html'],
    [{}, '?error_code=bad_oauth_state', undefined],
    [{'bcc-mentoring-done': '1'}, '?code=abc', undefined],
  ]) {
    let moved;
    vm.runInNewContext(read('mentoring-callback.js'), {URLSearchParams, Date, sessionStorage: store(initial), location: {search, hash: '', replace: to => { moved = to; }}});
    assert.equal(moved, expected);
  }
});
