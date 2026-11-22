// Only these fixed labels may leave the browser. Other input is used locally.
const occupations = [
  // [search label, alternative job titles, skill or experience clues]
  ['데이터 분석', '데이터분석|데이터 애널리스트|데이터 사이언티스트|data analyst|bi analyst|analytics engineer|data scientist', 'SQL|Tableau|데이터 시각화|통계 분석'],
  ['데이터 엔지니어', '데이터엔지니어|data engineer', '데이터 파이프라인|Airflow|데이터 웨어하우스'],
  ['백엔드', '백엔드 개발자|서버 개발자|backend|back-end', 'Spring Boot|Django|서버 개발'],
  ['프론트엔드', '프론트엔드 개발자|frontend|front-end', 'React|Vue|프론트 개발'],
  ['앱 개발', '앱개발자|모바일 개발자|안드로이드 개발자|iOS 개발자|mobile developer', 'Swift|Kotlin|Flutter'],
  ['소프트웨어 개발', '소프트웨어 개발자|프로그래머|software engineer|software developer|풀스택|웹개발|웹 개발자', '프로그래밍|자바스크립트|JavaScript'],
  ['인공지능', 'AI 엔지니어|머신러닝 엔지니어|machine learning engineer|AI engineer', '딥러닝|PyTorch|머신러닝'],
  ['정보보안', '보안 엔지니어|보안 관제|security engineer', '보안관제|정보보호|침해사고 대응'],
  ['인프라', '클라우드 엔지니어|DevOps|SRE|시스템 엔지니어', '쿠버네티스|Kubernetes|클라우드 인프라'],
  ['품질보증', '소프트웨어 QA|QA engineer|QA 엔지니어|테스트 엔지니어', '테스트케이스|테스트 자동화'],
  ['게임 개발', '게임개발|게임 프로그래머|게임 클라이언트|game developer', '언리얼|Unity|Unreal'],
  ['서비스 기획', '서비스기획|프로덕트 매니저|product manager|서비스 기획자', '요구사항 정의|서비스 기획서'],
  ['UX 디자인', '프로덕트 디자이너|UX 디자이너|UI 디자이너|UX/UI|UI/UX|UX designer|product designer', 'Figma|와이어프레임|사용성 테스트'],
  ['그래픽 디자인', '디자이너|시각디자인|브랜드 디자인|그래픽 디자이너|graphic designer', '일러스트레이터|Photoshop|시각 디자인'],
  ['마케팅', '마케터|marketer|marketing|브랜드매니저', '캠페인 기획|광고 집행|퍼포먼스 마케팅|검색광고|GA4'],
  ['콘텐츠', '콘텐츠 기획|콘텐츠 제작|에디터|editor|카피라이터', '카피라이팅|콘텐츠 제작|원고 작성'],
  ['영상 편집', '영상편집|영상 제작|영상 PD|촬영감독', '프리미어 프로|영상 촬영|After Effects'],
  ['영업', '세일즈|영업사원|영업관리|영업담당|sales|account executive', '거래처 관리|신규 거래처|영업 실적|매출 목표'],
  ['사업 개발', '사업개발|business development|사업기획', '신사업 기획|제휴사 발굴'],
  ['고객상담', '고객지원|고객 서비스|상담원|콜센터|customer support|customer service', '고객 응대|민원 응대|전화 상담'],
  ['인사', '인사관리|인사담당|채용 담당|리크루터|recruiter|human resources|HR', '급여 관리|채용 운영|인사평가'],
  ['총무', '총무담당|경영지원', '비품 관리|총무 업무|자산 관리'],
  ['사무', '행정|사무보조|사무원|행정사무|행정지원|행정직|사무행정', '문서 수발|문서 작성|서류 정리'],
  ['회계', '재무회계|경리|회계사|회계담당|accountant|accounting', '전표 처리|전표 입력|부가세 신고|장부 기장|월 결산'],
  ['재무', '재무관리|자금 담당|finance', '자금 조달|자금 운용|재무 분석'],
  ['법무', '변호사|법무 담당|법무사|legal counsel', '계약 검토|법률 자문'],
  ['구매', '구매관리|구매담당|자재구매|procurement', '발주 관리|협력사 구매|원자재 조달'],
  ['물류', '물류관리|물류센터|창고관리|logistics', '입출고|피킹|재고 실사|WMS'],
  ['배송', '배송기사|배달|택배기사', '택배 배송|배송 경로'],
  ['운전', '운전원|운전기사|버스기사|화물기사', '대형면허|버스 운행|화물 운송'],
  ['무역', '수출입|통관|포워딩|무역사무', '선적 서류|수출 신고|통관 업무'],
  ['매장관리', '매장 매니저|매장 판매|판매직|점장|스토어 매니저', '매장 운영|상품 진열'],
  ['상품기획', '머천다이저|상품 기획|온라인 MD|상품 MD', '상품 소싱|신상품 기획'],
  ['생산', '생산직|생산관리|생산기술|제조 오퍼레이터', '생산 라인|생산 공정|조립 공정'],
  ['품질관리', '품질 관리|QC|품질검사', '불량 분석|공정 검사|수입 검사'],
  ['기계설계', '기계 설계|기구설계|기계 엔지니어', '기계 도면|SolidWorks|기구 설계'],
  ['전기', '전기기사|전기공사|전기설계|전기 정비', '전기 설비|수변전|배전반'],
  ['전자', '회로설계|전자공학|하드웨어 엔지니어', 'PCB 설계|회로 설계'],
  ['반도체', '반도체 엔지니어|공정 엔지니어', '반도체 공정|웨이퍼'],
  ['정비', '자동차정비|설비보전|시설관리', '설비 점검|차량 점검|예방 정비'],
  ['용접', '용접사|용접공', '아르곤 용접|CO2 용접'],
  ['안전관리', '산업안전|안전 관리자|안전관리자', '위험성 평가|안전 점검'],
  ['건축', '건축기사|건축설계|건축 시공|건축사', '건축 도면|건축 감리'],
  ['토목', '토목기사|토목설계|토목 시공', '토목 감리|토목 공사'],
  ['인테리어', '실내디자인|실내건축', '인테리어 시공|실내 설계'],
  ['연구개발', '연구원|연구직|R&D|연구 개발', '연구 과제|연구 실험'],
  ['간호사', '정간호사|병동 간호사|registered nurse', '간호사 면허|간호 기록|병동 간호'],
  ['간호조무사', '간호 조무사', '간호조무사 자격|진료 보조'],
  ['요양보호사', '요양 보호사|방문요양', '요양보호사 자격|어르신 돌봄'],
  ['사회복지사', '사회복지|사회 복지사', '사례 관리|복지 프로그램'],
  ['물리치료사', '물리 치료사', '물리치료|재활 치료'],
  ['작업치료사', '작업 치료사', '작업치료'],
  ['보건', '보건관리자|보건직', '산업 보건|보건 교육'],
  ['약사', '병원 약사|약국 약사', '약사 면허|복약 지도'],
  ['임상병리사', '임상 병리사', '임상병리|진단 검사'],
  ['상담사', '직업상담|심리상담|청소년상담', '진로 상담|심리 검사'],
  ['강사', '강의|강의자|교수자|instructor', '강의안|수업 설계|교육생|교수 설계'],
  ['교사', '학교 교사|초등교사|중등교사|교원', '교원 자격|교과 지도'],
  ['보육교사', '보육 교사|어린이집 교사|유치원 교사', '보육일지|영유아 보육'],
  ['교육 기획', '교육기획|교육운영|교육 운영|교육 담당', '교육 과정 개발|교육 프로그램 기획'],
  ['조리', '조리사|요리사|주방장|조리원|chef', '단체 급식|조리 기능사|메뉴 조리'],
  ['영양사', '영양 사', '식단 편성|영양 관리'],
  ['바리스타', '커피 바리스타', '에스프레소 추출|라떼아트'],
  ['제과제빵', '제빵사|제과사|파티시에', '반죽 발효|제빵 기능사'],
  ['호텔', '호텔리어|호텔 프런트|호텔 서비스', '객실 예약|프런트 데스크'],
  ['미화', '청소원|환경미화|미화원', '건물 청소|환경 미화'],
  ['사서', '도서관 사서|사서직', '자료 분류|장서 관리'],
  ['경비', '경비원|시설경비|보안요원', '시설 순찰|출입 통제'],
  ['미용', '미용사|헤어디자이너|피부관리사', '헤어 시술|피부 관리'],
];
export const OCCUPATION_LABELS = occupations.map(([label]) => label);
const allowed = new Set(OCCUPATION_LABELS);

export function parseOccupationQuery(value) {
  if (typeof value !== 'string' || value.length > 150) return [];
  return [...new Set(value.split(',').filter(label => allowed.has(label)))].slice(0,3);
}

function expression(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll(' ', '\\s*');
  let prefix = '';
  if (/^[a-z]/i.test(text)) prefix = '(?<![a-z0-9])';
  else if (text.length <= 2) prefix = '(?<![가-힣])';
  const suffix = /^[a-z]/i.test(text) ? '(?![a-z0-9])' : '';
  return new RegExp(prefix+escaped+suffix, 'iu');
}
const patterns = occupations.map(([label,names,clues]) => ({
  label, names:[label,...names.split('|')].map(expression), clues:clues.split('|').map(expression)
}));

function classify(text, useClues) {
  const normalized = text.normalize('NFKC');
  const hits = patterns.map(({label,names,clues})=>{
    const matches = names.map(pattern => normalized.match(pattern)).filter(Boolean);
    const signals = useClues ? clues.filter(pattern=>pattern.test(normalized)).length : 0;
    return {label,matches,signals};
  });
  const spans = hits.flatMap(hit=>hit.matches);
  const ranked = hits.map(({label,matches,signals})=>{
    // A specific title like “UX 디자이너” takes precedence over a shorter title inside it.
    const distinct = matches.filter(match=>!spans.some(other=>
      other[0].length>match[0].length && other.index<=match.index &&
      other.index+other[0].length>=match.index+match[0].length));
    const name = Math.max(0,...distinct.map(match=>match[0].length));
    return {label, score:(name ? 12 + Math.min(8,name) : 0) + signals*2};
  }).filter(entry=>entry.score>0);
  return ranked.sort((a,b)=>b.score-a.score);
}

export function titleOccupations(title) {
  return classify(title.trim()==='간호' ? '간호사' : title,false).slice(0,3).map(entry=>entry.label);
}

export function inferOccupations(resume, role='') {
  // Explicit target occupations take priority over previous experience.
  const explicit = classify(role.trim()==='간호' ? '간호사' : role,false);
  const ranked = explicit.length ? explicit : classify(resume,true);
  if (!ranked.length) return [];
  const minimum = ranked[0].score >= 12 ? 12 : 2;
  return ranked.filter(entry=>entry.score>=minimum).slice(0,3).map(entry=>entry.label);
}
