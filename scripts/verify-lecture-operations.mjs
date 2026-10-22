// Independent synthetic PostgreSQL verification. Never reads app env or production credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const existingRuntime = '/Users/jinjoopwer/Documents/Codex/2026-10-22/ai-github-com-paperclipai-paperclip/work/paperclip-install/node_modules';
const pgBin = process.env.LECTURE_SRE_PG_BIN || path.join(existingRuntime, '@embedded-postgres/darwin-arm64/native/bin');
const pgModule = process.env.LECTURE_SRE_PG_MODULE || path.join(existingRuntime, 'pg');
const work = process.env.LECTURE_SRE_WORK_DIR || path.resolve(root, '..', 'lecture-operations-sre');
const { Client } = createRequire(import.meta.url)(pgModule);
const admin = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const caseA = '33333333-3333-4333-8333-333333333333';
const caseB = '44444444-4444-4444-8444-444444444444';
const lectureA = '55555555-5555-4555-8555-555555555555';
const lectureB = '66666666-6666-4666-8666-666666666666';
let sequence = 0;
const mutation = () => `77777777-7777-4777-8777-${String(++sequence).padStart(12, '0')}`;
const checks = [];
const clients = [];
let dataDirectory;
let started = false;
let port;

function command(executable, args) {
  const run = spawnSync(executable, args, { encoding: 'utf8', timeout: 30000 });
  if (run.status !== 0) throw new Error(`${path.basename(executable)} failed: ${run.error?.message || run.stderr || run.stdout}`);
  return run.stdout;
}

async function connect(database) {
  const client = new Client({ host: '127.0.0.1', port, database, user: 'sre', connectionTimeoutMillis: 4000 });
  await client.connect();
  clients.push(client);
  return client;
}

async function check(name, action) {
  const start = performance.now();
  try {
    await action();
    checks.push({ name, passed: true, ms: Math.round((performance.now() - start) * 100) / 100 });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}

async function asRole(client, role, uid, action) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    const value = await action();
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function call(client, name, args) {
  assert.match(name, /^lecture_(ops|finance)_[a-z_]+$/);
  const result = await client.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args);
  return result.rows[0].value;
}

const schema = `
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values('${admin}'),('${other}');
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function verify(business, finance) {
  // Tests are deliberately against actual Postgres functions, not a JavaScript reimplementation.
  await check('migrations expose expected RPCs', async () => {
    for (const [client, names] of [[business, ['lecture_ops_save', 'lecture_ops_case_update']], [finance, ['lecture_finance_mutate']]]) {
      const result = await client.query('select proname from pg_proc where pronamespace=\'public\'::regnamespace and proname=any($1)', [names]);
      assert.deepEqual(result.rows.map(r => r.proname).sort(), [...names].sort());
    }
  });
  const ok = value => { assert.equal(value.error, undefined, JSON.stringify(value)); return value; };
  const denied = value => { assert.equal(value.error,'forbidden',JSON.stringify(value)); };
  const checklist = { materials_ready:false, venue_ready:false, documents_ready:false, completed:false, notes:'합성 준비 기록' };
  const session = (id, start='2026-11-19T00:00:00.000Z', end='2026-11-19T03:00:00.000Z', instructor='합성 강사') => ({id,title:'합성 확정 회차',start_at:start,end_at:end,location:'합성 교육장',instructor,status:'confirmed'});
  const operations = {sessions:[session('88888888-8888-4888-8888-888888888881'),session('88888888-8888-4888-8888-888888888882','2026-11-20T00:00:00.000Z','2026-11-20T03:00:00.000Z')],checklist};
  const save = (id, revision, key, payload, actor=admin, client=business) => asRole(client,'service_role',null,()=>call(client,'lecture_ops_save',[id,actor,revision,key,payload]));
  const financeCall = (id,action,revision,key,payload,uid=admin,client=finance) => asRole(client,'authenticated',uid,()=>call(client,'lecture_finance_mutate',[id,action,revision,key,payload]));
  const settings = {contract_amount:1000000,deduction_amount:0,due_date:'2026-12-01',invoice_status:'issued',invoice_number:'SYNTHETIC-001',notes:'합성 청구 기록'};
  const candidateBefore = (await business.query('select payload from lecture_requests where case_id=$1',[caseA])).rows[0].payload;
  const saveKey=mutation();
  await check('business tables and RPCs deny direct browser roles',async()=>{
    for(const role of ['anon','authenticated']) {
      await assert.rejects(asRole(business,role,admin,()=>business.query('select * from lecture_operations')), e=>e.code==='42501');
      await assert.rejects(asRole(business,role,admin,()=>call(business,'lecture_ops_save',[caseA,admin,0,mutation(),operations])),e=>e.code==='42501');
    }
  });
  await check('business mutation validates administrator identity',async()=>{denied(await save(caseA,0,mutation(),operations,other));});
  await check('two confirmed sessions save independently of inquiry candidates',async()=>{
    ok(await save(caseA,0,saveKey,operations));
    const row=(await business.query('select * from lecture_operations where case_id=$1',[caseA])).rows[0];
    assert.equal(row.revision,1); assert.deepEqual(row.sessions,operations.sessions);
    assert.deepEqual((await business.query('select payload from lecture_requests where case_id=$1',[caseA])).rows[0].payload,candidateBefore);
  });
  await check('operation retry is idempotent and reused key cannot change payload',async()=>{
    ok(await save(caseA,0,saveKey,operations));
    const changed={...operations,checklist:{...checklist,notes:'다른 내용'}};
    assert.equal((await save(caseA,0,saveKey,changed)).error,'conflict');
    assert.equal((await business.query('select revision from lecture_operations where case_id=$1',[caseA])).rows[0].revision,1);
  });
  await check('operation stale revision cannot overwrite newer state',async()=>{
    assert.equal((await save(caseA,0,mutation(),operations)).error,'conflict');
    ok(await save(caseA,1,mutation(),{...operations,checklist:{...checklist,materials_ready:true}}));
    assert.equal((await business.query('select revision from lecture_operations where case_id=$1',[caseA])).rows[0].revision,2);
  });
  await check('same-case and cross-case instructor time overlap is rejected',async()=>{
    const overlapping={...operations,sessions:[operations.sessions[0],session('88888888-8888-4888-8888-888888888883','2026-11-19T01:00:00.000Z','2026-11-19T02:00:00.000Z')]};
    assert.equal((await save(caseA,2,mutation(),overlapping)).error,'schedule_conflict');
    assert.equal((await save(caseB,0,mutation(),{...operations,sessions:[session('88888888-8888-4888-8888-888888888884')]})).error,'schedule_conflict');
    ok(await save(caseB,0,mutation(),{...operations,sessions:[session('88888888-8888-4888-8888-888888888884','2026-11-19T03:00:00.000Z','2026-11-19T04:00:00.000Z')]}));
  });
  await check('parallel different-case bookings serialize their overlap check',async()=>{
    const caseC='33333333-3333-4333-8333-333333333334', caseD='33333333-3333-4333-8333-333333333335';
    await business.query('insert into proposal_cases(id) values($1),($2)',[caseC,caseD]);
    const peer=await connect('lecture_business');
    const a={...operations,sessions:[session('88888888-8888-4888-8888-888888888885','2026-12-12T00:00:00.000Z','2026-12-12T02:00:00.000Z','동시 강사')]};
    const b={...a,sessions:[{...a.sessions[0],id:'88888888-8888-4888-8888-888888888886'}]};
    const values=await Promise.all([save(caseC,0,mutation(),a),save(caseD,0,mutation(),b,admin,peer)]);
    assert.equal(values.filter(v=>!v.error).length,1,JSON.stringify(values));
    assert.equal(values.filter(v=>v.error==='schedule_conflict').length,1,JSON.stringify(values));
  });
  await check('case progress update uses timestamp CAS and durable retry',async()=>{
    const before=(await business.query('select updated_at::text from proposal_cases where id=$1',[caseA])).rows[0].updated_at;
    const fields={status:'won',next_action:'합성 교안 준비',next_action_at:'2026-11-15T00:00:00.000Z'};
    const key=mutation();
    const update=(id,stamp,key,payload)=>asRole(business,'service_role',null,()=>call(business,'lecture_ops_case_update',[id,admin,stamp,key,payload]));
    ok(await update(caseA,before,key,fields));
    ok(await update(caseA,before,key,fields));
    assert.equal((await update(caseA,before,mutation(),{...fields,status:'lost'})).error,'conflict');
    assert.equal((await business.query('select status from proposal_cases where id=$1',[caseA])).rows[0].status,'won');
  });
  await check('operations transaction rollback preserves revision and candidates',async()=>{
    await business.query('begin');
    await business.query('set local role service_role');
    ok(await call(business,'lecture_ops_save',[caseA,admin,2,mutation(),{...operations,checklist:{...checklist,completed:true}}]));
    await business.query('rollback');
    assert.equal((await business.query('select revision from lecture_operations where case_id=$1',[caseA])).rows[0].revision,2);
    assert.deepEqual((await business.query('select payload from lecture_requests where case_id=$1',[caseA])).rows[0].payload,candidateBefore);
  });
  await check('session cancellation retains history and releases the instructor time',async()=>{
    const changed={...operations,sessions:[{...operations.sessions[0],status:'completed'},{...operations.sessions[1],status:'cancelled'}]};
    ok(await save(caseA,2,mutation(),changed));
    const history=await business.query("select snapshot from lecture_operations_history where case_id=$1 and action='save_operations' order by created_at",[caseA]);
    assert.equal(history.rowCount,3);
    assert.equal(history.rows[0].snapshot.sessions[1].status,'confirmed');
    assert.equal(history.rows[2].snapshot.sessions[1].status,'cancelled');
    ok(await save(caseB,1,mutation(),{...operations,sessions:[session('88888888-8888-4888-8888-888888888884','2026-11-20T00:00:00.000Z','2026-11-20T03:00:00.000Z')]}));
  });
  const snapshot=await finance.query('select id,date::text,organization,topic,fee,promised_fee,actual_fee,is_paid,paid_at from lectures where id=$1',[lectureA]);
  const expectedLecture={...snapshot.rows[0],fee:Number(snapshot.rows[0].fee),promised_fee:Number(snapshot.rows[0].promised_fee),actual_fee:Number(snapshot.rows[0].actual_fee)};
  const link={lecture_id:lectureA,expected_lecture:expectedLecture,opening_received:200000,settings};
  const linkKey=mutation();
  await check('finance denies anon and authenticated non-owner',async()=>{
    await assert.rejects(asRole(finance,'anon',null,()=>call(finance,'lecture_finance_mutate',[caseA,'link',0,mutation(),link])),e=>e.code==='42501');
    denied(await financeCall(caseA,'link',0,mutation(),link,other));
  });
  await check('existing lecture link preserves historical receipt baseline without duplicate lecture',async()=>{
    ok(await financeCall(caseA,'link',0,linkKey,link));
    ok(await financeCall(caseA,'link',0,linkKey,link));
    assert.equal(Number((await finance.query('select count(*) from lectures')).rows[0].count),2);
    const row=(await finance.query('select * from lecture_finance_links where case_id=$1',[caseA])).rows[0];
    assert.equal(Number(row.received_amount),200000);assert.equal(row.lecture_id,lectureA);assert.equal(row.revision,1);
  });
  await check('linked ledger is hidden from non-owner and cannot be written directly',async()=>{
    const rows=await asRole(finance,'authenticated',other,()=>finance.query('select * from lecture_finance_links'));
    assert.equal(rows.rowCount,0);
    await assert.rejects(asRole(finance,'authenticated',admin,()=>finance.query('update lectures set actual_fee=1 where id=$1',[lectureA])));
    await assert.rejects(asRole(finance,'authenticated',admin,()=>finance.query('delete from lectures where id=$1',[lectureA])));
    assert.equal(Number((await finance.query('select actual_fee from lectures where id=$1',[lectureA])).rows[0].actual_fee),200000);
  });
  const paymentId='99999999-9999-4999-8999-999999999991';
  const refundId='99999999-9999-4999-8999-999999999992';
  const payment={id:paymentId,kind:'receipt',amount:300000,date:'2026-11-21',note:'합성 분할입금'};
  const paymentKey=mutation();
  await check('partial receipt updates the same original ledger exactly once',async()=>{
    ok(await financeCall(caseA,'payment',1,paymentKey,{payment}));
    ok(await financeCall(caseA,'payment',1,paymentKey,{payment}));
    assert.equal(Number((await finance.query('select actual_fee from lectures where id=$1',[lectureA])).rows[0].actual_fee),500000);
    assert.equal(Number((await finance.query('select count(*) from lecture_finance_payments where id=$1',[paymentId])).rows[0].count),1);
    assert.equal((await financeCall(caseA,'payment',1,mutation(),{payment:{...payment,id:mutation()}})).error,'conflict');
    assert.equal((await financeCall(caseA,'payment',1,paymentKey,{payment:{...payment,amount:400000}})).error,'conflict');
  });
  await check('refund and void maintain nonnegative net received and original receipt history',async()=>{
    ok(await financeCall(caseA,'payment',2,mutation(),{payment:{id:refundId,kind:'refund',amount:100000,date:'2026-11-22',note:'합성 부분 환불'}}));
    assert.equal(Number((await finance.query('select actual_fee from lectures where id=$1',[lectureA])).rows[0].actual_fee),400000);
    assert.equal((await financeCall(caseA,'payment',3,mutation(),{payment:{id:mutation(),kind:'refund',amount:400001,date:'2026-11-22',note:'초과 환불'}})).error,'negative_received');
    ok(await financeCall(caseA,'void',3,mutation(),{payment_id:refundId,reason:'합성 환불 기록 취소'}));
    assert.equal(Number((await finance.query('select actual_fee from lectures where id=$1',[lectureA])).rows[0].actual_fee),500000);
    const row=(await finance.query('select * from lecture_finance_payments where id=$1',[refundId])).rows[0];assert.ok(row.voided_at);assert.equal(Number(row.amount),100000);
  });
  await check('settlement deduction and final receipt reconcile the original paid flag',async()=>{
    ok(await financeCall(caseA,'settings',4,mutation(),{settings:{...settings,deduction_amount:33000}}));
    ok(await financeCall(caseA,'payment',5,mutation(),{payment:{id:mutation(),kind:'receipt',amount:467000,date:'2026-11-23',note:'합성 잔금'}}));
    const row=(await finance.query('select * from lectures where id=$1',[lectureA])).rows[0];assert.equal(Number(row.actual_fee),967000);assert.equal(row.is_paid,true);
    assert.equal((await financeCall(caseA,'settings',4,mutation(),{settings})).error,'conflict');
  });
  await check('payment mutation rollback does not change ledger or journal',async()=>{
    const before=(await finance.query('select revision,received_amount from lecture_finance_links where case_id=$1',[caseA])).rows[0];
    const count=(await finance.query('select count(*) from lecture_finance_payments')).rows[0].count;
    await finance.query('begin');await finance.query('set local role authenticated');await finance.query("select set_config('request.jwt.claim.sub',$1,true)",[admin]);
    ok(await call(finance,'lecture_finance_mutate',[caseA,'payment',6,mutation(),{payment:{id:mutation(),kind:'receipt',amount:1000,date:'2026-11-24',note:'롤백'}}]));
    await finance.query('rollback');
    assert.deepEqual((await finance.query('select revision,received_amount from lecture_finance_links where case_id=$1',[caseA])).rows[0],before);
    assert.equal((await finance.query('select count(*) from lecture_finance_payments')).rows[0].count,count);
  });
  await check('parallel payment retry is exactly once and distinct stale mutations conflict',async()=>{
    const peer=await connect('lecture_finance');
    const key=mutation(), payment={id:mutation(),kind:'receipt',amount:1000,date:'2026-11-24',note:'합성 병렬 재시도'};
    const retries=await Promise.all([financeCall(caseA,'payment',6,key,{payment}),financeCall(caseA,'payment',6,key,{payment},admin,peer)]);
    retries.forEach(ok);
    assert.equal((await finance.query('select revision from lecture_finance_links where case_id=$1',[caseA])).rows[0].revision,7);
    assert.equal(Number((await finance.query('select count(*) from lecture_finance_payments where id=$1',[payment.id])).rows[0].count),1);
    const competing=await Promise.all([
      financeCall(caseA,'payment',7,mutation(),{payment:{...payment,id:mutation()}}),
      financeCall(caseA,'payment',7,mutation(),{payment:{...payment,id:mutation()}},admin,peer)
    ]);
    assert.equal(competing.filter(v=>!v.error).length,1,JSON.stringify(competing));
    assert.equal(competing.filter(v=>v.error==='conflict').length,1,JSON.stringify(competing));
    assert.equal(Number((await finance.query('select actual_fee from lectures where id=$1',[lectureA])).rows[0].actual_fee),969000);
  });
  await check('one ledger cannot attach to another case and journal tables reject direct owner writes',async()=>{
    assert.equal((await financeCall(caseB,'link',0,mutation(),link)).error,'already_linked');
    await assert.rejects(asRole(finance,'authenticated',admin,()=>finance.query('update lecture_finance_links set received_amount=1 where case_id=$1',[caseA])),e=>e.code==='42501');
    await assert.rejects(asRole(finance,'authenticated',admin,()=>finance.query('delete from lecture_finance_payments where id=$1',[paymentId])),e=>e.code==='42501');
  });
  await check('new lecture creation and replay create exactly one original ledger row',async()=>{
    const key=mutation();
    const payload={create:{date:'2026-12-01',organization:'새 합성기관',topic:'새 합성 강의'},opening_received:0,settings:{...settings,contract_amount:100000,due_date:null}};
    const before=Number((await finance.query('select count(*) from lectures')).rows[0].count);
    ok(await financeCall(caseB,'link',0,key,payload));
    ok(await financeCall(caseB,'link',0,key,payload));
    assert.equal(Number((await finance.query('select count(*) from lectures')).rows[0].count),before+1);
    assert.equal(Number((await finance.query('select received_amount from lecture_finance_links where case_id=$1',[caseB])).rows[0].received_amount),0);
  });
  await check('void cannot make net received negative after a partial refund',async()=>{
    const id=mutation();
    ok(await financeCall(caseB,'payment',1,mutation(),{payment:{id,kind:'receipt',amount:100000,date:'2026-12-01',note:'합성'}}));
    ok(await financeCall(caseB,'payment',2,mutation(),{payment:{id:mutation(),kind:'refund',amount:90000,date:'2026-12-02',note:'합성'}}));
    assert.equal((await financeCall(caseB,'void',3,mutation(),{payment_id:id,reason:'입금 취소 시 음수 방지'})).error,'negative_received');
    assert.equal((await finance.query('select revision from lecture_finance_links where case_id=$1',[caseB])).rows[0].revision,3);
    assert.equal((await finance.query('select voided_at from lecture_finance_payments where id=$1',[id])).rows[0].voided_at,null);
  });
  await check('unlinked legacy rows still work and stale source selection cannot link',async()=>{
    const id='55555555-5555-4555-8555-555555555557',caseC='33333333-3333-4333-8333-333333333334';
    await finance.query('insert into lectures(id,user_id,date,organization,topic,fee,promised_fee,actual_fee,is_paid) values($1,$2,$3,$4,$5,$6,$6,$7,false)',[id,admin,'2026-12-03','연결 전 합성기관','합성',100000,0]);
    const expected={id,date:'2026-12-03',organization:'연결 전 합성기관',topic:'합성',fee:100000,promised_fee:100000,actual_fee:0,is_paid:false,paid_at:null};
    await asRole(finance,'authenticated',admin,()=>finance.query('update lectures set actual_fee=100 where id=$1',[id]));
    const response=await financeCall(caseC,'link',0,mutation(),{lecture_id:id,expected_lecture:expected,opening_received:0,settings:{...settings,contract_amount:100000}});
    assert.equal(response.error,'ledger_changed');
    assert.equal(Number((await finance.query('select count(*) from lecture_finance_links where case_id=$1',[caseC])).rows[0].count),0);
    assert.equal(Number((await finance.query('select actual_fee from lectures where id=$1',[id])).rows[0].actual_fee),100);
  });
}

try {
  await mkdir(work, { recursive: true });
  dataDirectory = await mkdtemp(path.join(work, 'postgres-'));
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  command(path.join(pgBin, 'initdb'), ['-D', dataDirectory, '-U', 'sre', '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--no-locale']);
  command(path.join(pgBin, 'pg_ctl'), ['-D', dataDirectory, '-l', path.join(dataDirectory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`, '-w', 'start']);
  started = true;
  const maintenance = await connect('postgres');
  await maintenance.query('create role anon; create role authenticated; create role service_role bypassrls;');
  await maintenance.query('create database lecture_business');
  await maintenance.query('create database lecture_finance');
  const business = await connect('lecture_business');
  const finance = await connect('lecture_finance');
  await business.query(schema + `
    create table public.profiles(id uuid primary key references auth.users(id), is_admin boolean not null default false);
    insert into profiles values('${admin}',true),('${other}',false);
    create table public.proposal_cases(id uuid primary key, updated_at timestamptz not null default now(), status text not null default 'inquiry', next_action text, next_action_at timestamptz, lecture_date date, institution_name text, project_name text);
    insert into proposal_cases(id,institution_name,project_name) values('${caseA}','합성기관 A','합성 강의 A'),('${caseB}','합성기관 B','합성 강의 B');
    create table public.lecture_requests(case_id uuid primary key references proposal_cases(id), payload jsonb not null);
    insert into lecture_requests values('${caseA}','{"date_candidates":[{"date":"2026-11-19","time_slots":["morning","afternoon"]}]}');
    grant select,update on public.profiles,public.proposal_cases to service_role;
  `);
  await finance.query(schema + `
    create function public.is_finance_owner() returns boolean language sql stable as $$select auth.uid()='${admin}'::uuid$$;
    create table public.lectures(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), date date not null, organization text not null, topic text, fee bigint not null, promised_fee bigint, actual_fee bigint, is_paid boolean, paid_at timestamptz, created_at timestamptz not null default now());
    insert into lectures(id,user_id,date,organization,topic,fee,promised_fee,actual_fee,is_paid) values('${lectureA}','${admin}','2026-11-19','합성기관 A','기존 강의',1000000,1000000,200000,false),('${lectureB}','${other}','2026-11-20','합성기관 B','타인 강의',900000,900000,0,false);
    alter table lectures enable row level security;
    alter table lectures force row level security;
    grant select,insert,update,delete on lectures to authenticated;
    create policy owner_lectures on lectures for all to authenticated using(user_id=auth.uid() and public.is_finance_owner()) with check(user_id=auth.uid() and public.is_finance_owner());
  `);
  await check('business migration applies in isolated database', async () => { await business.query(await readFile(path.join(root,'supabase/lecture-operations.sql'),'utf8')); });
  await check('finance migration applies in isolated database', async () => { await finance.query(await readFile(path.join(root,'supabase/lecture-operations-finance.sql'),'utf8')); });
  await verify(business, finance);
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (started) {
    try { command(path.join(pgBin,'pg_ctl'),['-D',dataDirectory,'-m','fast','-w','stop']); }
    catch(error) { checks.push({name:'isolated PostgreSQL cleanup',passed:false,error:error.message}); process.exitCode=1; }
  }
  const sources=[];
  for(const file of ['supabase/lecture-operations.sql','supabase/lecture-operations-finance.sql','scripts/verify-lecture-operations.mjs']) {
    try {sources.push({file,sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')});}catch{}
  }
  const result = { test: 'isolated synthetic PostgreSQL verification', postgres: '18.1', productionConnections: 0, syntheticDataOnly: true, clusterStopped: started && !checks.some(c=>c.name==='isolated PostgreSQL cleanup'), dataDirectory, sources, checks, passed: checks.length>0 && checks.every(c=>c.passed) && process.exitCode!==1 };
  await mkdir(work,{recursive:true});
  await writeFile(path.join(work,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({passed:result.passed,checks:checks.length,result:path.join(work,'result.json')}));
}
