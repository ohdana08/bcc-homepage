const date=v=>v?new Date(v).toLocaleString('ko-KR'):'—';
const number=v=>Number(v||0).toLocaleString('ko-KR',{maximumFractionDigits:1});
const label={measured:'사용 후 시간: 타이머 측정',self_reported:'사용 후 시간: 자기보고',human_review:'사람 검수',reference_check:'정답 기준 대조',not_reviewed:'미검수',accepted:'승인',corrected:'수정 후 사용',rejected:'반려',completed:'완료',failed:'실패',test:'시험',live:'실사용'};
function el(tag,text){const node=document.createElement(tag);node.textContent=text;return node;}
export function renderUsageView(target,data,{summary=false}={}){
  target.replaceChildren();
  if(!data){target.append(el('p','사용 기록을 불러오지 못했습니다. 다시 조회해 주세요.'));return;}
  const s=data.stats||{};
  if(summary)target.append(el('p',`연동 신청 ${number(data.connections)}건 · 수집 활성 ${number(data.activeConnections)}건 · 실사용 수신 ${number(data.liveConnections)}건`));
  else if(!data.connection){target.append(el('p','이 업무지시서는 사용 기록 연동에 동의하지 않았습니다.'));return;}
  else target.append(el('p',data.connection.revokedAt?'사용 기록 동의 철회 · 기존 기록 삭제됨':`연동 신청 ${date(data.connection.consentAt)} · 보관 종료 ${date(data.connection.expiresAt)}`));
  const grid=el('div','');grid.className='stats';
  for(const [title,value,note] of [
    ['실사용 기록',number(s.liveCount)+'건','완료 '+number(s.completed)+' · 실패 '+number(s.failed)],
    ['평균 도구 실행 시간',s.averageDurationMs==null?'미측정':number(s.averageDurationMs/1000)+'초','사람 작업시간·절약시간이 아님'],
    ['검수된 실행',number(s.reviewed)+' / '+number(s.completed)+'건','승인 '+number(s.accepted)+' · 수정 '+number(s.corrected)+' · 반려 '+number(s.rejected)],
    ['연결 시험',number(s.testCount)+'건','실사용·성과 통계에서 제외']
  ]){const block=el('div','');block.append(el('span',title),el('strong',value),el('small',note));grid.append(block);}
  target.append(grid,el('h3','사람 작업시간 비교'));
  if(!s.timeComparisons?.length)target.append(el('p','비교 가능한 사용 전후 시간이 없어 미측정입니다.'));
  for(const t of s.timeComparisons||[]){target.append(el('p',`${label[t.source]||t.source} · ${number(t.count)}건 비교 · 사용 전 ${number(t.baselineSeconds/60)}분 → 사용 후 ${number(t.workSeconds/60)}분 · 차이 ${number(t.savedSeconds/60)}분${t.savedSeconds<0?' (시간 증가)':''}`));}
  target.append(el('p','사용 전 시간은 모두 자기보고입니다. 사람의 자료 준비·조작·검토·수정 시간만 비교하며 AI 대기시간은 제외합니다. 비교값이 없는 실행은 포함하지 않습니다.'));
  if(summary)target.append(el('p','검수 항목별 통과 수와 기준은 각 업무지시서의 ‘원문·사용 기록’ 상세에서 확인하세요. 서로 다른 도구의 기준을 합산하지 않습니다.'));
  else{
    target.append(el('h3','기준이 있는 검수 결과'));
    if(!s.checks?.length)target.append(el('p','검수 기준과 항목 수가 없어 미측정입니다. 단순 승인 여부를 정확도로 계산하지 않습니다.'));
    for(const c of s.checks||[])target.append(el('p',`${label[c.method]||c.method} · 기준 ${c.criteriaVersion} · ${number(c.runs)}회 · 통과 ${number(c.correctItems)} / 검수 ${number(c.checkedItems)}항목 (${number(c.correctItems/c.checkedItems*100)}%)`));
    if(data.events?.length){const details=el('details','');details.append(el('summary','최근 수신 기록 최대 30건'));const list=el('ul','');for(const e of data.events){const v=e.event||e;list.append(el('li',`${date(e.receivedAt)} · ${label[v.mode]} · ${label[v.outcome]} · 실행 ${number(v.durationMs/1000)}초 · ${label[v.review]}`));}details.append(list);target.append(details);}
  }
  target.append(el('p','제작 도구가 보고한 기록이며 BCC가 실제 업무 성과를 독립 검증한 자료는 아닙니다. 표본·조건·검수 기준을 확인한 뒤 활용하세요.'));
}
