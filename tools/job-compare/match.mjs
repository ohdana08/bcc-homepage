// Shared vocabulary lets a Korean résumé find terms in English-language postings.
const vocabulary = [
  ['데이터', 'data'], ['분석', '분석가', '분석하고', 'analysis', 'analytics', 'analyst', 'analyze'],
  ['개발', '개발자', 'developer', 'development'], ['디자인', '디자이너', 'design', 'designer'],
  ['마케팅', 'marketing', 'marketer'], ['영업', 'sales'], ['고객', 'customer', 'customers'],
  ['고객지원', '고객상담', 'customer support', 'customer service'], ['콘텐츠', '컨텐츠', 'content'],
  ['제품', 'product'], ['기획', 'planning', 'planner'], ['운영', 'operations'],
  ['프로젝트관리', '프로젝트 관리', 'project management'], ['인사', 'human resources', 'hr'],
  ['채용', 'recruiting', 'recruitment'], ['회계', 'accounting'], ['재무', 'finance'],
  ['연구', 'research'], ['광고', 'advertising', 'ads'], ['캠페인', 'campaign', 'campaigns'],
  ['성과측정', 'performance measurement'], ['모바일', 'mobile'], ['서비스기획', '서비스 기획'],
  ['테스트', 'testing'], ['품질보증', 'quality assurance', 'qa'], ['게임', 'game', 'games', 'gaming'],
  ['프론트엔드', 'frontend', 'front-end', 'front end'], ['백엔드', 'backend', 'back-end', 'back end'],
  ['소프트웨어', 'software'], ['엔지니어', 'engineer', 'engineering'], ['클라우드', 'cloud'],
  ['인프라', 'infrastructure'], ['기계학습', '머신러닝', 'machine learning'],
  ['인공지능', 'ai', 'artificial intelligence'], ['데이터베이스', 'database', 'databases'],
  ['파이썬', 'python'], ['자바스크립트', 'javascript'], ['자바', 'java'], ['타입스크립트', 'typescript'],
  ['리액트', 'react'], ['엑셀', 'excel'], ['파워포인트', 'powerpoint'], ['피그마', 'figma'],
  ['통계', 'statistics', 'statistical'], ['시각화', 'visualization'], ['리포트', '보고서', 'reporting'],
  ['물류', 'logistics'], ['회화', 'conversation'], ['파트너십', 'partnerships', 'partnership'],
  ['언리얼', 'unreal'], ['유니티', 'unity'], ['보안', 'security'], ['애니메이션', 'animation'],
  ['영어', 'english'], ['한국어', 'korean'], ['일본어', 'japanese']
];
const aliases = new Map(vocabulary.flatMap(([key,...words]) => [key,...words].map(w => [w,key])));
const phrases = [...aliases.entries()].filter(([s]) => s.includes(' '));
const common = new Set(('the and are for with you your our that this from who of in to on or an as at be by is we will for have strong ability skills experience experienced years year relevant work working team teams a plus preferred required qualifications responsibilities requirements understanding knowledge proficiency excellent other etc within including deliver seeking professional role relevant related level build support can across more using field skills 회사 업무 담당 대한 관련 이상 경험 경력 능력 보유 가능 우대 이해 수준 및 있는 있으신 갖춘 분 분들 필요한 업무를 경력을 경험을 경험이 경력이 다양한 다양한 경험자 활용 통해 위한 적극적인 자격 요건 자격요건 우대사항 자격조건 주요업무 우리 팀 저희 업무 수행 경험하신 업무경험 근무 지원 지원자 지원자격 또는 경우 해당 기타 있음 보유자 경력자 가능하신 사용 대한 대한 기업 전문 프로젝트 실무 탄탄한 우수한').split(/\s+/));
function terms(text) {
  const normalized = text.normalize('NFKC').toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9+#.-]*|[가-힣]+/g) || [];
  const found = new Set();
  for (let word of words) {
    word = word.replace(/[.-]+$/, '');
    if (common.has(word)) continue;
    if (/^[가-힣]+$/.test(word) && !aliases.has(word)) {
      word = word.replace(/(?:으로부터|에서는|으로서|에서|으로|에게|까지|하고|하는|했던|하며|했고|해서|부터|에는|이나|과의|와의|들의|들을|들이|적인|하여|에는|을|를|이|가|은|는|과|와|의|에|도)$/, '');
    }
    if (word.length < 2 || common.has(word) || /^\d/.test(word)) continue;
    found.add(aliases.get(word) ?? word);
  }
  for (const [phrase,key] of phrases) if (normalized.includes(phrase)) found.add(key);
  return found;
}
function evidenceIndex(resume) {
  const lines = resume.split(/\n+|(?<=[.!?。])\s+|[•●]/u).map(text=>text.trim()).filter(Boolean);
  const index = new Map();
  for (const line of lines) {
    for (const word of terms(line)) {
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(line);
    }
  }
  return index;
}
export function compareJobs(jobs, resume, role = '') {
  const evidence = evidenceIndex(resume);
  const wanted = terms(role);
  const postings = jobs.map(job => ({
    job, title:terms(job.title),
    rows:job.requirements.map(text => ({text, words:terms(text)}))
  }));
  // Terms found in many jobs carry less weight than distinctive tools and skills.
  const freq = new Map();
  for (const p of postings) {
    const words = new Set([...p.title, ...p.rows.flatMap(r=>[...r.words])]);
    for (const word of words) freq.set(word, (freq.get(word) || 0) + 1);
  }
  const weight = word => 1 + Math.log((jobs.length + 1) / (1 + (freq.get(word) || 0)));
  const overlap = (set,other) => [...set].filter(w => other.has(w));
  const sum = words => words.reduce((n,w) => n+weight(w),0);
  return postings.map(({job,title,rows}) => {
    const pairs = rows.map(({text,words}) => {
      const hits = new Map();
      for (const word of words) {
        for (const line of evidence.get(word) || []) {
          if (!hits.has(line)) hits.set(line, []);
          hits.get(line).push(word);
        }
      }
      const best = [...hits].map(([line,matched])=>({line, matched, score:sum(matched)}))
        .sort((a,b)=>b.score-a.score)[0];
      return { text, words, ...best, score:best?.score || 0 };
    });
    const ranked = pairs.filter(p=>p.score>0).sort((a,b)=>b.score-a.score);
    const roleInTitle = sum(overlap(title,wanted));
    const roleInBody = sum([...new Set(rows.flatMap(r=>overlap(r.words,wanted)))]);
    const score = 5*roleInTitle + .5*roleInBody + 2*sum(overlap(title,evidence)) +
      ranked.slice(0,3).reduce((n,p)=>n+p.score,0);
    return { job, pairs, ranked, score };
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
}
