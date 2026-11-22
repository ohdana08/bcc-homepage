import assert from 'node:assert/strict';
import test from 'node:test';
import { compareJobs } from '../tools/job-compare/match.mjs';

const jobs = [
  {title:'Data Analyst', requirements:['SQL and Python experience', 'Professional English']},
  {title:'UX Designer', requirements:['Figma experience']},
  {title:'Backend Engineer', requirements:['JavaScript experience']},
  {title:'BI Analyst', requirements:['SQL and reporting experience']},
  {title:'Analytics Engineer', requirements:['Data analysis and SQL experience']},
];
test('희망 직무와 이력서 근거를 대조해 최대 3건과 실제 문장을 반환한다', () => {
  const sentence = 'SQL과 파이썬으로 데이터를 분석했습니다.';
  const ranked = compareJobs(jobs, sentence, '데이터 분석');
  assert.equal(ranked.length, 3);
  assert.ok(ranked.some(({job})=>job.title==='Data Analyst'));
  for(const {ranked: rows} of ranked) {
    assert.ok(rows.length > 0);
    for(const row of rows) assert.equal(row.line,sentence);
  }
  const english = ranked.find(({job})=>job.title==='Data Analyst').pairs.find(row=>row.text==='Professional English');
  assert.equal(english.score,0);
});
test('관련 근거가 부족하면 임의로 세 자리를 채우지 않는다', () => {
  assert.equal(compareJobs(jobs, '도자기를 굽고 유약을 배합했습니다.').length,0);
  assert.equal(compareJobs(jobs, 'Figma를 활용했습니다.').length,1);
});
