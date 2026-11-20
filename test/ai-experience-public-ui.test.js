import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleChoice, validShareUrl, cardText, isAmbiguousSubmission } from '../tools/training-needs/app.js';

test('experience choices replace exclusive answers without discarding other multi-selects',()=>{
  assert.deepEqual(toggleChoice(['none'],'image',9),['image']);
  assert.deepEqual(toggleChoice(['image','writing'],'none',9),['none']);
  assert.deepEqual(toggleChoice(['image'],'writing',9),['image','writing']);
  assert.deepEqual(toggleChoice(['image','writing'],'image',9),['writing']);
  assert.deepEqual(toggleChoice(['image'],'undecided',3),['undecided']);
  assert.throws(()=>toggleChoice(['a','b','c'],'d',3),/3개/);
});
test('portfolio URL cannot be executable, contain credentials or be a relative path',()=>{
  assert.equal(validShareUrl(''), '');
  assert.equal(validShareUrl('https://example.com/work'), 'https://example.com/work');
  for(const url of ['javascript:alert(1)','data:text/html,test','//example.com','https://user:secret@example.com/','https://example.com/with space']) assert.throws(()=>validShareUrl(url));
});
test('local card export reflects the person’s answers without interpreting missing sharing as skill',()=>{
  const text=cardText({experience_tasks:['이미지 만들기'],creation_process:[],desired_work:['짧은 영상'],support_needs:['파일 저장·업로드'],others:{},portfolio:{}},{institution_label:'기관 A',title:'강의 A'});
  assert.match(text,/기관 A\n강의 A/);assert.match(text,/이미지 만들기/);assert.match(text,/공유하지 않음/);assert.match(text,/능력 평가나 등급은 아닙니다/);assert.doesNotMatch(text,/초보|중급|상급|점수:/);
});


test('definitive 429 rejection remains editable while unknown submission outcomes retry the frozen payload',()=>{
  assert.equal(isAmbiguousSubmission({status:429,message:'응답 저장 한도에 도달했습니다.'}),false);
  assert.equal(isAmbiguousSubmission({status:400}),false);
  assert.equal(isAmbiguousSubmission({status:409}),false);
  assert.equal(isAmbiguousSubmission({status:500}),true);
  assert.equal(isAmbiguousSubmission(new Error('Failed to fetch')),true);
});
