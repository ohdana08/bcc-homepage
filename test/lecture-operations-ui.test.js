import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

// Execute the actual UI logic with synthetic DOM/auth/network boundaries.
// This does not claim browser rendering, real Supabase auth or production coverage.
const appSource = readFileSync(new URL('../lecture-operations/app.js', import.meta.url), 'utf8');
const intakeSource = readFileSync(new URL('../admin-lecture-requests.html', import.meta.url), 'utf8');
const caseId = '33333333-3333-4333-8333-333333333333';

function runtime(source = appSource.replace(/\nboot\(\);\s*$/, '')) {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) {
      const events = new Map();
      elements.set(id, {
        id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
        fields: {}, elements: { password: { value: '' }, reason: { value: '' } },
        classList: { add() {}, remove() {}, toggle() {} },
        querySelectorAll() { return []; }, querySelector() { return el(`${id}:button`); },
        closest() { return null; }, append() {},
        addEventListener(name, handler, options) { events.set(name, [...(events.get(name) || []), { handler, once: options?.once }]); },
        replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
        setAttribute() {}, scrollIntoView() {},
        showModal() { this.open = true; },
        close(value) {
          if (!this.open) return;
          if (value !== undefined) this.returnValue = value;
          this.open = false;
          const listeners = events.get('close') || [];
          events.set('close', listeners.filter(entry => !entry.once));
          listeners.forEach(entry => entry.handler());
        },
      });
    }
    return elements.get(id);
  };
  class SyntheticFormData {
    constructor(form) { this.values = new Map(Object.entries(form.fields)); }
    get(key) { return this.values.get(key) ?? null; }
    has(key) { return this.values.has(key); }
    [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  }
  const context = vm.createContext({
    document: { getElementById: el, querySelectorAll: () => [], createElement: tag => el(`created-${tag}`) }, window: { addEventListener() {} },
    Intl, Date, Number, String, Map, Set, JSON, URL, console, Buffer,
    crypto: { randomUUID }, FormData: SyntheticFormData,
    setTimeout: () => 1, clearTimeout() {}, confirm: () => true,
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(source, context);
  return { context, el, run: script => vm.runInContext(script, context) };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('lecture operations UI: calendar does not inherit an invisible inquiry-only filter', () => {
  const ui = runtime();
  ui.el('status-filter').value = 'inquiry';
  ui.run(`state.view='calendar';state.cases=[{id:'confirmed',status:'won',institution_name:'A'},{id:'new',status:'inquiry',institution_name:'B'}]`);
  assert.deepEqual(plain(ui.run('filteredCases().map(c=>c.id)')), ['confirmed', 'new']);
  ui.run("state.view='cases'");
  assert.deepEqual(plain(ui.run('filteredCases().map(c=>c.id)')), ['new']);
});

test('lecture operations UI: older finance response cannot replace newer data for the same case', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    const replies=[];api=()=>new Promise(resolve=>replies.push(resolve));renderTab=()=>{};
    state.selected='same';state.tab='finance';
    const first=loadFinanceDetail('same'),second=loadFinanceDetail('same');
    replies[1]({settlement:{revision:2},payments:[{id:'latest'}]});await second;
    replies[0]({settlement:{revision:1},payments:[]});await first;
  })()`);
  assert.equal(ui.run('state.financeData.settlement.revision'), 2);
  assert.equal(ui.run('state.financeData.payments[0].id'), 'latest');
});

test('lecture operations UI: delayed finance reads preserve dirty input and completed mutations', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    let reply;api=()=>new Promise(resolve=>reply=resolve);renderTab=()=>{throw new Error('dirty form rendered');};
    state.selected='same';state.tab='finance';state.financeData={settlement:{revision:2}};
    const read=loadFinanceDetail('same');state.dirty=true;
    reply({settlement:{revision:1}});await read;
    state.dirty=false;const beforeMutation=loadFinanceDetail('same');
    await saving($('synthetic-form'),async()=>{state.financeData={settlement:{revision:3}};});
    reply({settlement:{revision:2}});await beforeMutation;
  })()`);
  assert.equal(ui.run('state.financeData.settlement.revision'), 3);
  assert.equal(ui.run('state.busy'), false);
});

test('lecture operations UI: failed save preserves inputs and pending retry identity', async () => {
  const ui = runtime();
  ui.el('synthetic-form').fields = { notes: '다시 작성하지 않을 메모' };
  await ui.run(`(async()=>{state.dirty=true;globalThis.first=mutation('case', {case_id:'same',fields:{notes:'메모'}});await saving($('synthetic-form'),async()=>{throw new Error('network lost');});globalThis.second=mutation('case',{case_id:'same',fields:{notes:'메모'}});})()`);
  assert.equal(ui.el('synthetic-form').fields.notes, '다시 작성하지 않을 메모');
  assert.equal(ui.run('state.dirty'), true);
  assert.equal(ui.run('first.mutation_id'), ui.run('second.mutation_id'));
  assert.match(ui.el('error').textContent, /network lost/);
});

test('lecture operations UI: load-more cancellation preserves an edited ledger connection form', async () => {
  const ui = runtime();
  ui.run(`state.detail={case:{id:'same',institution_name:'합성 기관'}};state.financeNext=1;renderLinkFinance($('tab-content'),'new');state.dirty=true;confirm=()=>false;loadFinanceList=async()=>{throw new Error('must not load');};`);
  const original = ui.el('tab-content').innerHTML;
  await ui.el('finance-more').onclick();
  assert.equal(ui.el('tab-content').innerHTML, original);
  assert.equal(ui.run('state.dirty'), true);
});

test('lecture operations UI: rejected saved finance identity can return to the login dialog', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    state.config={finance:{enabled:true}};globalThis.signedOut=null;
    state.finance={auth:{getSession:async()=>({data:{session:{user:{id:'wrong'}}}}),signOut:async options=>{signedOut=options;}}};
    loadFinanceList=async()=>{const e=new Error('재무 소유자 권한 없음');e.status=403;throw e;};
    await connectFinance();
  })()`);
  assert.equal(ui.el('finance-login').open, true);
  assert.equal(ui.run('signedOut.scope'), 'local');
  assert.equal(ui.run('state.financeReady'), false);
  assert.match(ui.el('finance-login-error').textContent, /권한 없음/);
});

test('lecture operations UI: logout clears private state and a late case list cannot restore it', async () => {
  const ui = runtime();
  ui.el('detail').innerHTML = 'private contact';
  await ui.run(`(async()=>{
    let reply;api=()=>new Promise(resolve=>reply=resolve);
    state.cases=[{id:'private'}];state.detail={case:{id:'private'}};
    const read=loadList();clearPrivate();
    reply({cases:[{id:'late-private'}],operations:[],next_page:null});await read;
  })()`);
  assert.deepEqual(plain(ui.run('state.cases')), []);
  assert.equal(ui.run('state.detail'), null);
  assert.equal(ui.el('app').hidden, true);
  assert.equal(ui.el('detail').innerHTML, '');
});

test('lecture operations UI: disconnect invalidates a late financial list response', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    let reply;api=()=>new Promise(resolve=>reply=resolve);
    state.financeReady=true;const read=loadFinanceList();clearFinance();
    reply({lectures:[{id:'private-ledger'}],settlements:[],next_page:null});await read;
  })()`);
  assert.equal(ui.run('state.financeReady'), false);
  assert.deepEqual(plain(ui.run('state.lectures')), []);
});

test('lecture operations UI: repeated load-more responses do not duplicate cases, sessions, or receivables', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    let replies=[];api=()=>new Promise(resolve=>replies.push(resolve));
    state.financeReady=true;state.financeNext=1;
    const first=loadFinanceList(true),second=loadFinanceList(true);
    const page={lectures:[{id:'same-ledger'}],settlements:[{case_id:'same-case',receivable_amount:100000}],next_page:null};
    replies.forEach(reply=>reply(page));await Promise.all([first,second]);
    replies=[];state.nextPage=1;
    const a=loadList(true),b=loadList(true);
    const cases={cases:[{id:'same-case',institution_name:'합성 기관'}],operations:[{case_id:'same-case',sessions:[{id:'same-session'}]}],next_page:null};
    replies.forEach(reply=>reply(cases));await Promise.all([a,b]);
  })()`);
  assert.equal(ui.run('state.lectures.length'), 1);
  assert.equal(ui.run('state.settlements.reduce((sum,row)=>sum+row.receivable_amount,0)'), 100000);
  assert.equal(ui.run('state.cases.length'), 1);
  assert.equal(ui.run('state.operations.length'), 1);
});

test('lecture operations UI: a financial list read started before saving cannot restore old receivables', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    let reply;api=()=>new Promise(resolve=>reply=resolve);state.financeReady=true;
    const read=loadFinanceList();
    await saving($('payment-form'),async()=>{state.settlements=[{case_id:'same-case',revision:2,receivable_amount:0}];});
    reply({lectures:[],settlements:[{case_id:'same-case',revision:1,receivable_amount:100000}],next_page:null});await read;
  })()`);
  assert.equal(ui.run('state.settlements[0].revision'), 2);
  assert.equal(ui.run('state.settlements[0].receivable_amount'), 0);
});

test('lecture operations UI: selecting a ledger does not mark an untouched form dirty but editing does', () => {
  const ui = runtime();
  ui.run(`state.tab='finance';state.financeReady=true;state.financeData={settlement:null};state.detail={case:{id:'same-case',institution_name:'합성 기관'}};globalThis.confirmCalls=0;confirm=()=>{confirmCalls++;return false;};renderTab();`);
  const target = ui.el('tab-content'), choice = ui.el('lecture-choice');
  choice.value = 'new';
  target.oninput({ target: choice });
  choice.onchange({ target: choice });
  target.onchange({ target: choice });
  assert.equal(ui.run('confirmCalls'), 0);
  assert.equal(ui.run('state.dirty'), false);
  assert.ok(target.innerHTML.includes('id="finance-link"'));
  const input = { closest: selector => selector === 'form' ? ui.el('finance-link') : null };
  target.oninput({ target: input });
  assert.equal(ui.run('state.dirty'), true);
  choice.value = '';
  choice.onchange({ target: choice });
  assert.equal(ui.run('confirmCalls'), 1);
  assert.equal(choice.value, 'new');
  assert.equal(ui.run('state.dirty'), true);
});

test('lecture operations UI: void dialog rejects blank reasons, returns trimmed text, and starts clean', async () => {
  const ui = runtime();
  const reason = ui.run('askVoidReason()');
  const form = ui.el('void-form'), dialog = ui.el('void-dialog');
  assert.equal(dialog.open, true);
  form.elements.reason.value = '   ';
  form.onsubmit({ preventDefault() {} });
  assert.equal(dialog.open, true, 'whitespace cannot confirm a financial void');
  form.elements.reason.value = '  중복 입력 취소  ';
  form.onsubmit({ preventDefault() {} });
  assert.equal(await reason, '중복 입력 취소');
  const next = ui.run('askVoidReason()');
  assert.equal(form.elements.reason.value, '');
  ui.el('close-void').onclick();
  assert.equal(await next, '');
});

function voidRuntime() {
  const ui = runtime();
  const button = { dataset: { void: 'payment-to-void' } };
  ui.el('tab-content').querySelectorAll = selector => selector === '[data-void]' ? [button] : [];
  ui.run(`state.selected='same-case';state.tab='finance';state.financeReady=true;
    state.detail={case:{id:'same-case'}};
    state.financeData={settlement:{case_id:'same-case',revision:3,contract_amount:1000000,deduction_amount:33000,received_amount:500000,receivable_amount:467000},payments:[]};
    globalThis.voidCalls=[];api=async(action,payload)=>{voidCalls.push({action,payload});return state.financeData;};renderFinance($('tab-content'));renderTab=()=>{};`);
  return { ...ui, button };
}

test('lecture operations UI: confirming a void binds the selected case, payment, revision and reason', async () => {
  const ui = voidRuntime();
  const click = ui.button.onclick();
  const form = ui.el('void-form');
  form.elements.reason.value = '  실제 환급이 아닌 입력 오류  ';
  form.onsubmit({ preventDefault() {} });
  await click;
  const calls = plain(ui.run('voidCalls'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'finance_void');
  assert.equal(calls[0].payload.case_id, 'same-case');
  assert.equal(calls[0].payload.payment_id, 'payment-to-void');
  assert.equal(calls[0].payload.expected_revision, 3);
  assert.equal(calls[0].payload.reason, '실제 환급이 아닌 입력 오류');
});

test('lecture operations UI: a failed void keeps the same reason and retry identity for that payment', async () => {
  const ui = voidRuntime();
  ui.run(`const originalSaving=saving;saving=(form,task)=>(globalThis.savePromise=originalSaving(form,task));
    api=async(action,payload)=>{voidCalls.push({action,payload});if(voidCalls.length===1)throw new Error('response lost');return state.financeData;};`);
  const first = ui.button.onclick();
  ui.el('void-form').elements.reason.value = '중복 입력을 취소합니다';
  ui.el('void-form').onsubmit({ preventDefault() {} });
  await first;
  await ui.context.savePromise;
  const second = ui.button.onclick();
  const form = ui.el('void-form');
  const retained = form.elements.reason.value;
  form.onsubmit({ preventDefault() {} });
  if (ui.el('void-dialog').open) ui.el('close-void').onclick();
  await second;
  await ui.context.savePromise;
  assert.equal(retained, '중복 입력을 취소합니다');
  const calls = plain(ui.run('voidCalls'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.reason, calls[1].payload.reason);
  assert.equal(calls[0].payload.mutation_id, calls[1].payload.mutation_id);
});

test('lecture operations UI: void confirmation cannot act on another case or after identity is cleared', async () => {
  for (const change of ["state.selected='another-case'", 'clearFinance()', 'clearPrivate()']) {
    const ui = voidRuntime();
    const click = ui.button.onclick();
    ui.el('void-form').elements.reason.value = '취소 사유';
    ui.run(change);
    if (ui.el('void-dialog').open) ui.el('void-form').onsubmit({ preventDefault() {} });
    await click;
    assert.equal(ui.run('voidCalls.length'), 0, change);
  }
});

test('lecture operations UI: history tab reloads latest history without replacing editable case fields', async () => {
  const ui = runtime();
  const tab = { dataset: { tab: 'history' } };
  ui.context.document.querySelectorAll = selector => selector === '[data-tab]' ? [tab] : [];
  ui.run(`state.selected='same-case';state.tab='history';state.detail={case:{id:'same-case',next_action:'현재 행동'},operation:{revision:3},history:[{id:'old'}]};
    globalThis.historyCalls=[];api=async(action,payload)=>{historyCalls.push({action,payload});return {case:{next_action:'조회된 다른 값'},operation:{revision:2},history:[{id:'latest'}]};};renderDetail();`);
  await tab.onclick();
  assert.deepEqual(plain(ui.run('historyCalls')), [{ action: 'detail', payload: { case_id: 'same-case' } }]);
  assert.equal(ui.run('state.detail.history[0].id'), 'latest');
  assert.equal(ui.run('state.detail.case.next_action'), '현재 행동');
  assert.equal(ui.run('state.detail.operation.revision'), 3);
});

test('lecture operations UI: older history responses cannot undo newer reads or a completed save', async () => {
  const ui = runtime();
  await ui.run(`(async()=>{
    let replies=[];api=()=>new Promise(resolve=>replies.push(resolve));renderTab=()=>{};
    state.selected='same-case';state.tab='history';state.detail={case:{id:'same-case'},history:[]};
    const a=loadHistory('same-case'),b=loadHistory('same-case');
    replies[1]({history:[{id:'latest'}]});await b;
    replies[0]({history:[{id:'old'}]});await a;
    globalThis.afterReads=state.detail.history[0].id;
    replies=[];const beforeSave=loadHistory('same-case');
    await saving($('preparation-form'),async()=>{state.detail.history=[{id:'saved'}];});
    replies[0]({history:[{id:'before-save'}]});await beforeSave;
  })()`);
  assert.equal(ui.run('afterReads'), 'latest');
  assert.equal(ui.run('state.detail.history[0].id'), 'saved');
});

test('lecture operations UI: history responses after switching cases or logging out are ignored', async () => {
  for (const change of ["state.selected='another-case'", 'clearPrivate()']) {
    const ui = runtime();
    ui.context.change = change;
    await ui.run(`(async()=>{
      let reply;api=()=>new Promise(resolve=>reply=resolve);renderTab=()=>{throw new Error('stale history rendered');};
      state.selected='same-case';state.tab='history';state.detail={history:[{id:'current'}]};
      const read=loadHistory('same-case');eval(change);reply({history:[{id:'private-old'}]});await read;
    })()`);
    assert.ok(!JSON.stringify(plain(ui.run('state.detail'))).includes('private-old'), change);
  }
});

test('lecture operations UI: a lost response retries the same session and mutation IDs', async () => {
  const ui = runtime();
  ui.context.testCaseId = caseId;
  ui.run(`state.selected=testCaseId;state.detail={case:{id:testCaseId},operation:{case_id:testCaseId,revision:0,sessions:[],checklist:{materials_ready:false,venue_ready:false,documents_ready:false,completed:false,notes:''}}};renderSchedule($('tab-content'));globalThis.calls=[];renderTab=()=>{};saving=(form,task)=>{globalThis.savePromise=task();};api=async(action,payload)=>{calls.push(structuredCloneForTest(payload));if(calls.length===1)throw new Error('response lost');return {operation:{case_id:testCaseId,revision:1,sessions:payload.sessions,checklist:payload.checklist}};};`);
  ui.context.structuredCloneForTest = value => JSON.parse(JSON.stringify(value));
  const form = ui.el('session-form');
  form.fields = { title: '1회차', start_at: '2026-11-20T09:00', end_at: '2026-11-20T12:00', location: '교육실', instructor: '합성강사', status: 'confirmed' };
  form.onsubmit({ preventDefault() {}, currentTarget: form });
  await assert.rejects(ui.context.savePromise, /response lost/);
  form.onsubmit({ preventDefault() {}, currentTarget: form });
  await ui.context.savePromise;
  const calls = plain(ui.context.calls);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].sessions[0].id, calls[1].sessions[0].id);
  assert.equal(calls[0].mutation_id, calls[1].mutation_id);
  assert.equal(ui.run('state.detail.operation.sessions.length'), 1);
  assert.equal(ui.run('state.pending.size'), 0);
});

test('lecture operations UI: private inquiry values render as text rather than HTML', () => {
  const ui = runtime();
  ui.context.payload = '<img src=x onerror="alert(1)"> & \'quoted\'';
  ui.run(`state.detail={case:{id:'same',status:'inquiry',institution_name:payload,next_action:payload,goals:payload},request:{payload:{purpose:payload}},surveys:[]};renderOverview($('tab-content'));`);
  const html = ui.el('tab-content').innerHTML;
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(html.includes('&#39;quoted&#39;'));
});

test('lecture operations UI: existing inquiry card opens operations with that same case ID', () => {
  const script = intakeSource.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const bootAt = script.indexOf('    (async()=>{try{');
  assert.ok(bootAt > 0, 'existing intake boot boundary');
  const ui = runtime(script.slice(0, bootAt));
  ui.context.testCaseId = caseId;
  ui.run(`state.cases=[{id:testCaseId,institution_name:'합성 기관',project_name:'합성 강의',status:'inquiry'}];renderCases();`);
  assert.ok(ui.el('cases').innerHTML.includes(`/admin-lecture-operations.html?case=${caseId}`));
  assert.ok(ui.el('cases').innerHTML.includes(`/admin-proposals.html?case=${caseId}`));
});
