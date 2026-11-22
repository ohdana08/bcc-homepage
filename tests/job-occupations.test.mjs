import test from 'node:test';
import assert from 'node:assert/strict';
import {inferOccupations, parseOccupationQuery} from '../tools/job-compare/occupations.mjs';

test('신원과 자유 입력을 제외하고 고정 직무명만 추출한다', ()=>{
  assert.deepEqual(inferOccupations('이름 홍길동, hong@example.com, 병동 간호사 경력 2년.', '물류 담당, 010-1234-5678'), ['물류']);
  assert.deepEqual(inferOccupations('SQL과 Tableau로 지표를 시각화했습니다.'), ['데이터 분석']);
  assert.deepEqual(inferOccupations('최예림 hello@example.com 010-1234-5678'), []);
  assert.deepEqual(parseOccupationQuery('물류,hong@example.com,간호사,물류,회계,마케팅'), ['물류','간호사','회계']);
});
