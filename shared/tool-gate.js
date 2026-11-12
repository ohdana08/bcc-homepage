/* BCC 잇툴즈 공통 입구 — 처음 한 번 이름·휴대전화를 받고, 그 기기에서는 모든 AI 코치를 연다.
 * 사용: <script src="/shared/tool-gate.js" data-tool="bmc" data-hide="main"></script>  (head 안, defer 없이)
 *       data-tool="query:bot" 이면 주소의 ?bot= 값을 도구 이름으로 쓴다.
 * 도구에 입력하는 내용은 이 모듈이 다루지 않는다. 이름·연락처는 /api/tool-leads 로만 보낸다. */
(function () {
  'use strict';
  var ACCESS = 'bcc_tool_access_v1', TOUCH = 'bcc_first_touch', CONSENT = '2026-11-12-v1';
  var me = document.currentScript;
  if (!me) return;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // 처음 들어온 경로 기록
  (function () {
    if (lsGet(TOUCH)) return;
    try {
      var p = new URLSearchParams(location.search), t = { landing: location.pathname };
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { var v = p.get(k); if (v) t[k] = v.slice(0, 100); });
      var r = document.referrer ? new URL(document.referrer).hostname : '';
      if (r && !/(^|\.)bccconsulting\.kr$/.test(r)) t.ref = r;
      lsSet(TOUCH, JSON.stringify(t));
    } catch (e) {}
  })();


  /* 신청 보내기: 서버 장애·한도 초과면 도구는 열고, 신청은 이 기기에 잠시 보관했다가 다음에 다시 보낸다(최대 14일). */
  var PENDING='bcc_tool_lead_pending';
  function postLead(payload){
    return fetch('/api/tool-leads',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(payload)})
      .then(function(r){return r.json().catch(function(){return{}}).then(function(j){return{status:r.status,ok:r.ok,j:j}})});
  }
  function flushPending(){
    var p;try{p=JSON.parse(lsGet(PENDING)||'null')}catch(e){p=null}
    if(!p||!p.payload){return}
    if(Date.now()-(p.at||0)>14*86400000){try{localStorage.removeItem(PENDING)}catch(e){}return}
    postLead(p.payload).then(function(x){if(x.ok||(x.status>=400&&x.status<500&&x.status!==429)){try{localStorage.removeItem(PENDING)}catch(e){}}}).catch(function(){});
  }
  flushPending();

  function hasAccess() { try { var a = JSON.parse(lsGet(ACCESS) || 'null'); return !!(a && a.ok); } catch (e) { return false; } }
  if (hasAccess()) return;

  var raw = me.getAttribute('data-tool') || '';
  var tool = raw.indexOf('query:') === 0 ? (new URLSearchParams(location.search).get(raw.slice(6)) || '') : raw;
  if (!/^[a-z0-9-]{1,40}$/.test(tool)) return; // 도구를 알 수 없는 화면(목록 오류 등)은 막지 않는다
  var hideSel = me.getAttribute('data-hide') || 'main';

  var lockStyle = document.createElement('style');
  lockStyle.textContent = hideSel + '{display:none!important}';
  document.head.appendChild(lockStyle);

  var P = '질문에 답하면 바로 결과물 초안이 나옵니다';
  var PROMPT = '내 ChatGPT·Claude·Gemini에 붙여넣는 완성 프롬프트';
  var T = {
    'business-process': ['내 사업이 굴러가는 순서, 6단계로 그려 보세요', '아이템·첫 고객·시장조사·고객의 말·지원사업 기간을 차례로 정리하면 예산까지 이어지는 사업프로세스가 나옵니다.', ['질문 5개로 아이템부터 지원사업 기간까지 정리', '아이템부터 예산까지 6단계 사업프로세스 초안', '사업계획서에 옮겨 쓸 수 있는 순서표', PROMPT], '사업프로세스 초안', ['1단계 · 아이템을 한 줄로', '2단계 · 첫 고객을 만나는 방법', '3단계 · 시장조사로 확인할 것', '4단계 · 고객에게 들은 말', '5단계 · 일정', '6단계 · 예산']],
    'customer-persona': ['지갑을 여는 고객, 3가지 버전으로 그려 보세요', '상품과 생각하는 타겟만 적으면, 서로 다른 고객 3명을 비교해 볼 수 있습니다.', ['질문 2개, 5분이면 끝', '서로 다른 고객 페르소나 3가지', '어느 고객부터 공략할지 비교 포인트', PROMPT], '고객 페르소나 3가지', ['페르소나 A · 하루 일과와 고민', '페르소나 B · 사는 이유와 망설이는 이유', '페르소나 C · 자주 보는 채널', '비교 · 먼저 공략할 고객']],
    'customer-interview': ['AI가 고객이 되어 내 아이템의 빈틈을 찔러 드립니다', '아이템·고객·문제·지금의 해결 방법을 적으면, AI 고객과 나눌 10단계 인터뷰가 준비됩니다.', ['아이템·고객·문제·지금의 해결 방법 정리', 'AI 고객과 나누는 10단계 인터뷰 흐름', '고객이 망설일 지점 확인', PROMPT], '고객 인터뷰 10단계', ['1단계 · 고객의 하루', '2단계 · 지금 쓰는 해결 방법', '3단계 · 가장 불편한 순간', '…', '10단계 · 돈을 낼지 묻기']],
    'business-filter': ['고객이 돈 내고 해결할 문제인지 먼저 걸러 보세요', '아이템이 현실 기준을 통과하는지, 1~2주 안에 작게 시험해 볼 방법까지 함께 정리합니다.', ['아이템·문제·지금 쓰는 돈·작은 시험 4가지 점검', '전문가 기준 사업 필터링 결과', '1~2주 안에 해볼 작은 시험 아이디어', PROMPT], '사업 필터링 결과', ['문제의 크기', '고객이 지금 쓰는 돈', '작게 시험할 방법', '다음에 할 일']],
    'bmc': ['고객부터 수익까지 9칸, 내 사업 모델을 한 장에', '9칸을 순서대로 채우고, 가진 자료로 AI 초안을 만든 뒤 고객에게 확인할 것까지 정리합니다.', ['9칸을 순서대로 채우는 질문', '가진 자료로 만드는 AI 초안', '고객에게 확인할 것 정리', 'A4 한 장 PDF'], '비즈니스 모델 캔버스', ['① 고객', '② 가치 제안', '③ 채널', '④ 고객 관계', '⑤ 수익', '⑥~⑨ 자원·활동·파트너·비용']],
    'ppt-plan': ['발표 자료, 만들기 전에 흐름부터 잡으세요', '주제·대상·목적·규칙을 정하면 장표 순서가 담긴 기획 흐름이 나옵니다.', ['주제·대상·목적·지킬 규칙 정리', '장표 순서가 담긴 PPT 기획 흐름', 'AI로 슬라이드 만들 때 쓸 지시문', PROMPT], 'PPT 기획 흐름', ['1장 · 표지와 한 줄 메시지', '2장 · 듣는 사람의 문제', '3장 · 해결 방법', '4장 · 근거', '5장 · 요청할 행동']],
    'press-release': ['기관·행사 소식, 기사체 보도자료로 바로', '유형·기관·행사·일시·강조점을 단계별로 적으면 배포용 보도자료 형식으로 정리됩니다.', ['유형·기관·행사·일시·강조점 정리', '기사체 보도자료 초안(제목·부제·본문)', '담당자 연락처가 들어간 배포용 형식', PROMPT], '보도자료 초안', ['제목', '부제', '첫 문단 · 언제·어디서·누가', '본문', '담당자']],
    'cardnews-plan': ['질문 6개면 4장 카드뉴스 기획서', '무엇을, 누구에게, 왜 필요한지 답하면 장별 문구가 담긴 기획서가 나옵니다.', ['소개할 것·고객의 답답함·쉬워지는 점·마지막 행동 정리', '4장 카드뉴스 기획서(장별 문구)', '이미지 만들 때 쓸 설명', PROMPT], '카드뉴스 기획서', ['1장 · 멈춰 세우는 첫 문장', '2장 · 고객의 답답함', '3장 · 해결', '4장 · 다음 행동']],
    'instagram-profile': ['팔로우를 부르는 인스타 프로필 4줄', '하는 일과 보이고 싶은 모습, 고객이 찾아오는 상황을 고르면 4줄 프로필이 완성됩니다.', ['질문·선택 4번이면 끝', '4줄 프로필 초안', '프로필 링크에 둘 것 정리', PROMPT], '4줄 프로필', ['1줄 · 누구인지', '2줄 · 무엇을 주는지', '3줄 · 믿을 근거', '4줄 · 눌러야 할 곳']],
    'video-storyboard': ['머릿속 영상을 4컷 콘티로 꺼내세요', '시작·전개·터지는 순간·마무리를 답하면 컷별 콘티와 이미지 프롬프트가 나옵니다.', ['4컷 흐름과 분위기 정리', '4컷 콘티표', '컷마다 쓸 이미지 프롬프트', PROMPT], '4컷 콘티', ['1컷 · 첫 화면', '2컷 · 변화', '3컷 · 터지는 순간', '4컷 · 마무리']],
    'storyboard-caption': ['4컷 콘티에 딱 맞는 자막 잡기', '컷마다 보이는 장면과 분위기를 적으면 컷별 자막 아이디어를 함께 잡습니다.', ['컷별 장면과 분위기 정리', '컷마다 자막 아이디어', '첫 3초에 멈추게 할 자막 후보', PROMPT], '컷별 자막', ['1컷 자막', '2컷 자막', '3컷 자막', '4컷 자막']],
    'customer-psychology': ['고객이 망설이는 진짜 이유를 찾으세요', '아이템과 고객, 고객의 힘든 점을 넣으면 욕구와 심리 장벽, 그 장벽을 넘는 전략을 정리합니다.', ['아이템·페르소나·정보·시장자료·힘든 점 정리', '고객 욕구와 심리 장벽 분석', '장벽을 넘는 전략과 문구 방향', PROMPT], '고객 심리 분석', ['고객이 원하는 것', '망설이게 하는 장벽', '장벽별 대응 전략', '문구 방향']],
    'detail-page': ['고객 단계에 맞춘 상세페이지 기획안', '아이템·고객·힘든 점·마케팅 경로를 넣으면 섹션 순서가 담긴 기획안이 나옵니다.', ['아이템·페르소나·힘든 점·마케팅 경로 정리', '섹션 순서가 담긴 상세페이지 기획안', '제작 도구에 넣을 구조', PROMPT], '상세페이지 기획안', ['첫 화면 · 한 줄 약속', '문제 공감', '해결과 근거', '구매 버튼 문구']],
    'cover-motivation': ['회사와 직무를 이해한 지원동기 1000자', '조사한 회사·직무 내용과 내 경험을 이어 지원동기를 씁니다.', ['회사·직무 조사 내용 정리', '내 경험과 회사·직무 연결', '지원동기 1000자 초안', PROMPT], '지원동기 초안', ['① 회사·직무에 끌린 이유', '② 나와 맞물리는 경험', '③ 입사 후 기여']],
    'cover-aspiration': ['직무가 실제 하는 일로 쓰는 입사 후 포부', '채용공고의 실제 업무와 내 실천 계획 3가지로 1000자를 씁니다.', ['채용공고 속 실제 업무 정리', '신입이 해낼 실천 계획 3가지', '입사 후 포부 1000자 초안', PROMPT], '입사 후 포부 초안', ['① 직무가 하는 일', '② 실천 계획 3가지', '③ 3년 뒤 모습']],
    'cover-growth': ['관심이 생긴 계기부터 쓰는 직무 성장과정', '계기·첫 행동·공부·연습·극복 경험을 맞춤 질문으로 꺼내 1000자로 정리합니다.', ['계기부터 극복 경험까지 7가지 질문', '성장 포인트 정리', '직무 성장과정 1000자 초안', PROMPT], '직무 성장과정 초안', ['① 관심의 계기', '② 스스로 해본 것', '③ 극복과 성장']],
    'cover-strength': ['내 장점을 이야기 하나로 증명하는 1000자', '장점 한 단어와 경험 하나를 꺼내 STAR 구조로 씁니다.', ['장점 한 단어와 경험 하나 꺼내기', '숫자·주변 반응으로 근거 보강', 'STAR 구조 1000자 초안', PROMPT], '성격의 장점 초안', ['S · 상황', 'T · 과제', 'A · 행동', 'R · 결과']],
    'self-development': ['자기개발 경험, 기억을 꺼내는 질문으로 정리', '계기·목표·방법·어려움·결과·지속 계획을 차례로 답하면 자기소개서 초안이 나옵니다.', ['계기·목표·방법·어려움 정리', '결과와 앞으로의 계획 정리', '자기개발 경험 자기소개서 초안', PROMPT], '자기개발 경험 초안', ['① 시작한 계기', '② 실제로 한 것', '③ 달라진 점', '④ 앞으로의 계획']],
    'issue-opinion': ['국내외 이슈, 내 생각으로 1000자', '이슈를 쉽게 풀어 이해하고, 내 입장과 이유·해결책을 직무와 이어 정리합니다.', ['이슈를 쉽게 이해하고 내 입장 정하기', '원인·영향·해결책 정리', '이슈 자기소개서 1000자 초안', PROMPT], '이슈 자기소개서 초안', ['① 이슈 한 줄 요약', '② 내 생각과 이유', '③ 직무와 연결']],
    'conflict-collab': ['협업·갈등 경험을 STAR 1000자로', '경험 하나를 흐름대로 풀어 놓으면 갈등 지점과 내 행동·기준을 맞춤 질문으로 정리합니다.', ['경험 하나를 흐름대로 풀기', '갈등 지점과 내 행동·기준 정리', '협업 자기소개서 1000자 초안', PROMPT], '협업과 갈등 극복 초안', ['S · 상황', 'T · 갈등', 'A · 내 행동', 'R · 결과와 배운 점']],
    'job-analysis': ['채용공고로 만드는 직무분석 5요소와 매핑표', '공고에서 과업과 지식·기술·태도를 뽑고, 내가 가진 것과 나란히 비교합니다.', ['채용공고에서 과업·KSA 뽑기', '직무 5요소 정리', '공고 요구 vs 내 KSA 매핑표', PROMPT], '직무분석 매핑표', ['과업', '지식(K)', '기술(S)', '태도(A)', '평가 지표·성장 경로']],
    'ksa-extract': ['내 경험에서 지식·기술·태도 뽑아내기', '경험 3가지를 카테고리별로 꺼내 지식(K)·기술(S)·태도(A)로 나눕니다.', ['경험 3가지를 카테고리별로 꺼내기', '경험별 K·S·A 추출표', '자기소개서·면접에 쓸 근거 정리', PROMPT], 'KSA 추출표', ['경험 1 · K / S / A', '경험 2 · K / S / A', '경험 3 · K / S / A']],
    'value-worldcup': ['둘 중 하나씩, 나에게 진짜 중요한 직업 가치', '11번의 양자택일로 내가 고른 가치 순위와 직장 고르는 기준을 찾습니다.', ['11번의 양자택일', '내가 고른 직업 가치 순위', '가치에 맞는 직장 고르는 기준', PROMPT], '직업가치관 결과', ['1위 가치', '2위 가치', '3위 가치', '직장 고르는 기준']],
    'self-awareness': ['잘 안 풀리는 이유, 아이템 문제인지 내 생각 문제인지', '탐색→인정→전환 순서로 지금 당장 할 한 가지를 찾습니다.', ['요즘 가장 답답한 것 꺼내기', '내가 할 수 있는 것과 바라는 것 구분', '지금 당장 할 한 가지', PROMPT], '정리 결과', ['답답한 것', '마음에 걸리는 단어', '할 수 있는 것', '지금 할 한 가지']]
  };
  var d = T[tool] || ['BCC 잇툴즈 AI 코치, 무료로 시작하세요', P + '.', ['질문에 하나씩 답하기', '정리된 결과물 초안', PROMPT], '결과 화면', ['결과물 초안', '완성 프롬프트']];

  var css = '' +
    '.bccg{max-width:760px;margin:0 auto;padding:18px 16px 40px;font-family:inherit;color:#1b2333;line-height:1.5}' +
    '.bccg *{box-sizing:border-box}.bccg [hidden]{display:none!important}' +
    '.bccg .ey{font-size:13px;font-weight:700;color:#2457d6;margin:6px 0 4px}' +
    '.bccg h2.hero{font-size:28px;line-height:1.3;margin:0 0 10px;color:#14213d}' +
    '.bccg .lead{font-size:16px;color:#3a4357;margin:0 0 16px}' +
    '.bccg form{background:#fff;border:1px solid #cfd6e4;border-radius:14px;padding:20px}' +
    '.bccg form h3{font-size:19px;margin:0 0 6px}.bccg .once{font-size:13.5px;color:#667089;margin:0 0 14px}' +
    '.bccg .f{margin-bottom:12px}.bccg .f label{display:block;font-size:14px;font-weight:700;margin-bottom:4px;color:#1b2333}.bccg .f label em{font-style:normal;color:#667089;font-weight:400}' +
    '.bccg .f input{width:100%;padding:12px 14px;border:1px solid #cfd6e4;border-radius:10px;font-size:17px;background:#fff;color:#1b2333;font-family:inherit}' +
    '.bccg .nt{background:#f4f6fb;border-radius:10px;padding:12px 14px;font-size:13px;color:#4a5368;margin:4px 0 12px}.bccg .nt b{color:#1b2333}.bccg .nt a{color:#2457d6}' +
    '.bccg .ag{display:flex;gap:8px;align-items:flex-start;font-size:14.5px;margin:8px 0;cursor:pointer;font-weight:400}.bccg .ag input{width:18px;height:18px;margin-top:2px;flex:none}' +
    '.bccg .go{width:100%;font-size:18px;font-weight:700;padding:15px;border-radius:10px;background:#14213d;border:1px solid #14213d;color:#fff;margin-top:8px;cursor:pointer;font-family:inherit}.bccg .go:disabled{opacity:.6}' +
    '.bccg .err{color:#b3261e;font-size:14px;font-weight:700;margin:8px 0 0}' +
    '.bccg .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}' +
    '.bccg .tz{background:#fff;border:1px solid #cfd6e4;border-radius:14px;padding:20px;margin-top:14px}.bccg .tz h3{font-size:20px;margin:0 0 4px}.bccg .tz>p{font-size:14px;color:#667089;margin:0 0 10px}' +
    '.bccg .toc{list-style:none;margin:0;padding:0}.bccg .toc li{display:grid;grid-template-columns:30px 1fr;gap:8px;padding:11px 0;border-bottom:1px solid #eef0f5;font-size:15.5px;font-weight:700}' +
    '.bccg .toc .n{width:26px;height:26px;border-radius:50%;background:#e9f0ff;color:#1d3f99;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}' +
    '.bccg .sm{position:relative;margin-top:16px;border:1px solid #cfd6e4;border-radius:12px;padding:14px;overflow:hidden;max-height:300px;background:#fff}' +
    '.bccg .sm .tag{position:absolute;right:10px;top:10px;font-size:12px;font-weight:700;background:#fff4d6;color:#8a5a00;border-radius:6px;padding:2px 8px}' +
    '.bccg .sm h4{margin:0 0 10px;font-size:16px}.bccg .sm .ln{border:1px solid #e3e7ef;border-left:4px solid #2457d6;border-radius:8px;padding:9px 12px;margin-bottom:8px;font-size:14.5px;font-weight:700}' +
    '.bccg .sm .ln i{display:block;height:8px;border-radius:4px;background:#eef1f7;margin-top:7px;width:80%}.bccg .sm .ln i+i{width:55%}' +
    '.bccg .sm .bl{filter:blur(3px);user-select:none}' +
    '.bccg .sm .fd{position:absolute;left:0;right:0;bottom:0;height:140px;background:linear-gradient(rgba(255,255,255,0),#fff 75%);display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;font-weight:700;color:#14213d;font-size:14.5px;text-align:center}' +
    '@media(max-width:700px){.bccg h2.hero{font-size:23px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function build() {
    var host = document.querySelector(hideSel);
    var box = document.createElement('section');
    box.className = 'bccg'; box.id = 'bcc-tool-gate';
    var toc = d[2].map(function (t, i) { return '<li><span class="n">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>'; }).join('');
    var lines = d[4].map(function (t, i) { return '<div class="ln">' + esc(t) + '<i></i>' + (i < 1 ? '<i></i>' : '') + '</div>'; });
    box.innerHTML =
      '<p class="ey">무료 · BCC 잇툴즈 AI 코치</p>' +
      '<h2 class="hero">' + esc(d[0]) + '</h2>' +
      '<p class="lead">' + esc(d[1]) + ' 오예림 강사의 강의에서 교육생이 쓰는 도구입니다.</p>' +
      '<form novalidate><h3>무료로 시작하기</h3><p class="once">처음 한 번만 입력하면 이 기기에서는 잇툴즈 AI 코치 24개를 모두 바로 쓸 수 있습니다.</p>' +
      '<div class="f"><label for="bccgName">이름 (필수)</label><input id="bccgName" autocomplete="name" maxlength="40"></div>' +
      '<div class="f"><label for="bccgPhone">휴대전화 번호 (필수)</label><input id="bccgPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678" maxlength="13"></div>' +
      '<div class="f"><label for="bccgEmail">이메일 <em>(선택)</em></label><input id="bccgEmail" type="email" autocomplete="email" maxlength="254"></div>' +
      '<div class="hp" aria-hidden="true"><label for="bccgWeb">웹사이트</label><input id="bccgWeb" tabindex="-1" autocomplete="off"></div>' +
      '<div class="nt"><b>개인정보 수집·이용 안내</b><br>수집 항목: 이름, 휴대전화 번호, 이메일(선택), 들어온 경로 표시. 이용 목적: 도구 이용자 확인, 이용 안내·문의 응대, 도구 개선 통계. 보유 기간: 신청일부터 1년(삭제 요청 시 바로 삭제). 동의를 거부할 수 있으며, 거부하면 도구를 이용할 수 없습니다.<br>신청 내용은 미국 Vercel 서버를 거쳐 처리되고 대한민국 서울의 Supabase DB에 저장됩니다. 도구에 입력하는 답은 서버로 보내지 않고 이 기기에만 저장됩니다. <a href="/privacy.html#tool-leads" target="_blank" rel="noopener">개인정보처리방침</a></div>' +
      '<label class="ag"><input type="checkbox" id="bccgC1"> <span>[필수] 개인정보 수집·이용에 동의합니다.</span></label>' +
      '<label class="ag"><input type="checkbox" id="bccgC2"> <span>[필수] 신청 내용이 미국 Vercel 서버를 거쳐 처리되는 국외 처리에 동의합니다.</span></label>' +
      '<label class="ag"><input type="checkbox" id="bccgC3"> <span>[선택] BCC 강의·무료 도구 소식을 문자·이메일로 받겠습니다. 동의하지 않아도 도구를 쓸 수 있습니다.</span></label>' +
      '<button type="submit" class="go">무료로 시작하기</button><p class="err" role="alert" hidden></p></form>' +
      '<div class="tz"><h3>시작하면 이런 걸 받아요</h3><p>' + esc(P) + '. 휴대폰으로도 됩니다.</p><ol class="toc">' + toc + '</ol>' +
      '<div class="sm" aria-label="결과 화면 예시"><span class="tag">결과 화면 예시</span><h4>' + esc(d[3]) + '</h4>' + lines.slice(0, 2).join('') + '<div class="bl">' + lines.slice(2).join('') + '</div><div class="fd">시작하면 내 결과물이 바로 만들어집니다 ↑</div></div></div>';
    host.parentNode.insertBefore(box, host);

    var form = box.querySelector('form'), err = box.querySelector('.err'), btn = box.querySelector('.go');
    var phone = box.querySelector('#bccgPhone');
    phone.addEventListener('input', function () {
      var v = this.value.replace(/\D/g, '').slice(0, 11);
      this.value = v.length < 4 ? v : v.length < 8 ? v.slice(0, 3) + '-' + v.slice(3) : v.slice(0, 3) + '-' + v.slice(3, v.length - 4) + '-' + v.slice(-4);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      function show(m) { err.textContent = m; err.hidden = false; }
      err.hidden = true;
      var name = box.querySelector('#bccgName').value.trim(), ph = phone.value.replace(/\D/g, ''), email = box.querySelector('#bccgEmail').value.trim();
      if (!name) { show('이름을 입력해 주세요.'); box.querySelector('#bccgName').focus(); return; }
      if (!/^01[0-9]{8,9}$/.test(ph)) { show('휴대전화 번호를 확인해 주세요. 예: 010-1234-5678'); phone.focus(); return; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show('이메일 주소를 확인해 주세요.'); return; }
      if (!box.querySelector('#bccgC1').checked || !box.querySelector('#bccgC2').checked) { show('[필수] 동의 2개에 체크해 주세요.'); return; }
      var src = {}; try { src = JSON.parse(lsGet(TOUCH) || '{}') || {}; } catch (x) {}
      btn.disabled = true; btn.textContent = '확인하는 중…';
      var payload = { action: 'submit', tool: tool, name: name, phone: ph, email: email, consent: true, overseas_consent: true,
          marketing_consent: box.querySelector('#bccgC3').checked, consent_version: CONSENT, website: box.querySelector('#bccgWeb').value, source: src };
      function open() {
        lsSet(ACCESS, JSON.stringify({ ok: true, at: new Date().toISOString(), tool: tool }));
        box.parentNode.removeChild(box);
        if (lockStyle.parentNode) lockStyle.parentNode.removeChild(lockStyle);
        window.scrollTo(0, 0);
      }
      function queue() { lsSet(PENDING, JSON.stringify({ at: Date.now(), payload: payload })); open(); }
      postLead(payload)
        .then(function (x) {
          if (x.ok) { open(); return; }
          if (x.status >= 500 || x.status === 429) { queue(); return; }
          show(x.j.error || '신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        })
        .catch(function () { queue(); })
        .then(function () { btn.disabled = false; btn.textContent = '무료로 시작하기'; });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
