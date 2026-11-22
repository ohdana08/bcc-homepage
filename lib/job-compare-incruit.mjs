// Occupational feeds published in https://people.incruit.com/rss/rss.asp .
const categories = {
  100: ['인사','총무','사무','사업 개발','구매','서비스 기획'],
  101: ['회계','재무'], 210: ['재무'], 102: ['마케팅','콘텐츠','상품기획'],
  160: ['무역','영업','매장관리','상품기획','사업 개발'], 106: ['고객상담'],
  130: ['법무','상담사'], 190: ['간호사','간호조무사','요양보호사','사회복지사','물리치료사','작업치료사','보건','약사','임상병리사','영양사','상담사'],
  103: ['강사','교사','보육교사','교육 기획'], 200: ['콘텐츠','영상 편집'],
  140: ['조리','바리스타','제과제빵','호텔','미화','경비','미용'],
  110: ['구매','물류','배송','운전'],
  104: ['그래픽 디자인','UX 디자인','인테리어'],
  150: ['데이터 분석','데이터 엔지니어','백엔드','프론트엔드','앱 개발','소프트웨어 개발','인공지능','정보보안','인프라','품질보증','게임 개발','서비스 기획'],
  120: ['기계설계','전기','전자','반도체','연구개발','품질보증'],
  107: ['안전관리','건축','토목','인테리어'], 170: ['생산','품질관리','정비','용접','전기']
};
const regions = /^(전국|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남광주|전남|경북|경남|제주)(?:>|$)/;
const field = (xml,key) => (xml.match(new RegExp('<'+key+'>([\\s\\S]*?)</'+key+'>','i'))?.[1] || '')
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const info = (description,key) => description.match(new RegExp('▨\\s*'+key+'\\s*:\\s*([^<▨]+)'))?.[1].trim() || '';

function isExpired(end,published,now) {
  const date = /^(\d{1,2})\/(\d{1,2})/.exec(end);
  if (!date) return false;
  const publishedAt = Date.parse(published);
  if (!Number.isFinite(publishedAt)) return true;
  const posted = new Date(publishedAt+9*36e5);
  let year = posted.getUTCFullYear();
  if (+date[1] < posted.getUTCMonth()+1) year++;
  return now >= Date.UTC(year,+date[1]-1,+date[2]+1)-9*36e5;
}
export function parseIncruit(xml, now=Date.now()) {
  if (!/<rss\b/i.test(xml) || !/<\/rss>/i.test(xml)) throw new Error('Invalid Incruit RSS');
  const jobs = [];
  for (const [,item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const description = field(item,'description');
    const company = info(description,'회사명') || field(item,'author');
    const fullTitle = field(item,'title');
    const prefix = '['+company+']';
    const title = fullTitle.startsWith(prefix) ? fullTitle.slice(prefix.length).trim() : fullTitle;
    const url = field(item,'link');
    if (!/^https:\/\/job\.incruit\.com\/jobdb_info\/jobpost\.asp\?job=\d+$/i.test(url) || !company || !title || /인재\s*풀|talent pool/i.test(title)) continue;
    const locations = info(description,'지역').split('|').map(s=>s.trim()).filter(s=>regions.test(s));
    if (!locations.length || isExpired(info(description,'마감일'),field(item,'pubDate'),now)) continue;
    const requirements = ['경력','학력'].map(key=>[key,info(description,key)]).filter(([,value])=>value).map(([key,value])=>key+' : '+value);
    if (requirements.length) jobs.push({company,title,location:locations.map(s=>s.replace(/>/g,' ')).join(', '),url,requirements,source:'인크루트'});
  }
  return jobs;
}
async function readFeed(code) {
  const response = await fetch('https://www.incruit.com/rss/job.asp?occ1='+code, {signal:AbortSignal.timeout(6500),redirect:'error'});
  if (!response.ok) throw new Error('Incruit feed unavailable');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 768_000) throw new Error('Feed too large');
    chunks.push(chunk);
  }
  return parseIncruit(Buffer.concat(chunks).toString('utf8'));
}
export async function searchIncruit(terms) {
  const codes = Object.keys(categories).filter(code => !terms.length || terms.some(term=>categories[code].includes(term)));
  const selected = codes.length ? codes : Object.keys(categories);
  const results = await Promise.allSettled(selected.map(readFeed));
  const healthy = results.filter(r=>r.status==='fulfilled');
  if (!healthy.length) throw new Error('Incruit unavailable');
  const unique = new Map(healthy.flatMap(r=>r.value).map(job=>[job.url,job]));
  return {jobs:[...unique.values()],partial:healthy.length<selected.length};
}
