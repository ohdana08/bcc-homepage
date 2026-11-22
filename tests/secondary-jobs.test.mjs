import test from 'node:test';
import assert from 'node:assert/strict';
import {searchSecondaryWithStatus} from '../lib/job-compare-secondary.mjs';

function card(id, state, location) {
  return '<a href="/mobile2021/recruit/recruitView.do?idx='+id+'"><div class="workPlace">공공기관</div><div class="tit">간호직 채용</div><div class="date">'+location+' / 정규직 / <span>'+state+'</span></div></a>';
}

test('잡알리오 공개 검색의 국내 진행 공고만 원문 응시자격과 연결한다', async t => {
  const urls = [];
  t.mock.method(globalThis,'fetch', async input => {
    const url = new URL(input); urls.push(url);
    if (url.pathname.endsWith('recruit.do')) {
      assert.equal(url.searchParams.get('ing'),'2');
      return new Response('<div class="recruit_list">'+card(1,'진행중','대구')+card(2,'마감','부산')+card(3,'진행중','해외')+'</div>');
    }
    return new Response('<th>기관명</th><td>공공기관</td><th scope="row">응시자격</th><td>간호사 면허 소지<br/>임상 경력 2년 이상</td><th>결격사유</th><td>별도 확인</td>');
  });
  const {jobs,partial} = await searchSecondaryWithStatus(['간호','보건']);
  assert.equal(partial,false);
  assert.equal(urls.length,3);
  assert.equal(jobs.length,1);
  assert.deepEqual(jobs[0].requirements,['간호사 면허 소지','임상 경력 2년 이상']);
  assert.equal(jobs[0].location,'대구');
});

test('빈 검색 결과와 출처 장애를 구분한다',async t => {
  const upstream=t.mock.method(globalThis,'fetch',async ()=>new Response('<div class="recruit_list"></div>'));
  assert.deepEqual(await searchSecondaryWithStatus(['조리']),{jobs:[],partial:false});
  upstream.mock.mockImplementation(async ()=>new Response('서비스 점검 중'));
  await assert.rejects(searchSecondaryWithStatus(['조리']),/unavailable/);
});
