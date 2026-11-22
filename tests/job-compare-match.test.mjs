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

test('필수 요건이 유사해도 희망 직종과 다른 면허 직종은 제외한다', () => {
  const requirement = ['경력 1년 이상', '병동 근무'];
  const clinical = [
    {title:'간호조무사 모집', requirements:requirement},
    {title:'병동 간호사 채용', requirements:requirement},
  ];
  const ranked = compareJobs(clinical, '병동에서 간호사로 경력 2년 근무했습니다.', '간호사');
  assert.deepEqual(ranked.map(r=>r.job.title), ['병동 간호사 채용']);
});

test('같은 직무를 채용하는 기업이 여럿이면 서로 다른 기업의 공고를 우선한다', () => {
  const original = {company:'마케팅기업',title:'브랜드 마케팅',requirements:['GA4, CRM과 캠페인 기획 경험']};
  const extra = [
    {...original,company:'(주)마케팅기업', title:'마케팅 리드'},
    {...original, title:'CRM 마케터'},
    {company:'제조기업',title:'마케팅 담당자',requirements:['경력 : 신입']},
    {company:'유통기업',title:'브랜드 마케터',requirements:['학력 : 대졸']},
    {company:'병원',title:'간호사',requirements:['캠페인 기획 경험']},
  ];
  const resume = '마케팅 담당자로 GA4와 CRM을 활용해 캠페인을 기획했습니다.';
  const ranked = compareJobs([original,...extra],resume,'마케팅');
  assert.equal(new Set(ranked.map(r=>r.job.company.replace('(주)',''))).size,3);
  assert.ok(ranked.every(r=>r.job.company!=='병원'));
  const sparse = compareJobs([original,...extra.slice(0,2)],resume,'마케팅');
  assert.equal(sparse.length,3);
});
