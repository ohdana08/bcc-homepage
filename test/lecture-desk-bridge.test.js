import test from 'node:test';
import assert from 'node:assert/strict';
import { eventSQL } from '../scripts/lecture-desk-event-sql.mjs';
const base = () => ({event_id:'11111111-1111-4111-8111-111111111111',case_id:null,expected_revision:0,kind:'inquiry',occurred_on:'2026-11-18',source_ref:'codex:synthetic',raw_text:"O'Brien 요청'); delete from proposal_cases; --",fields:{institution_name:'합성 기관'}});
test('chat original text is contained in one escaped SQL JSON literal',()=>{
  const sql=eventSQL(base());
  assert.match(sql,/O''Brien/);
  assert.match(sql,/요청''\); delete/);
  assert.match(sql,/count\(\*\) = 1/);
  assert.match(sql,/else null/);
  // Decode PostgreSQL string quoting; all inquiry text remains inside valid JSON.
  const literal=sql.match(/apply\('((?:[^']|'')*)'::jsonb,/)[1];
  assert.deepEqual(JSON.parse(literal.replaceAll("''","'")),base());
});
test('malformed event or actor cannot be emitted to the DB',()=>{
 assert.throws(()=>eventSQL({...base(),occurred_on:'2026-02-30'}));
 assert.throws(()=>eventSQL(base(),"x');drop table profiles;--"));
 assert.throws(()=>eventSQL({...base(),fields:{institution_name:'합성',is_paid:true}}));
});
