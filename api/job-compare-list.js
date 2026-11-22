// Public employer feeds only. Resume text is processed in the visitor's browser.
const boards = [
  ['krafton', '크래프톤'],
  ['moloco', '몰로코'],
  ['sendbird', '센드버드'],
];
const koreanLocation = /\b(?:south korea|korea|seoul|pangyo|seongnam|busan|incheon|daejeon|daegu|gyeonggi)\b|대한민국|서울|판교|성남|부산|인천|대전|대구|경기/i;
const poolListing = /인재\s*풀|채용\s*관심\s*등록|talent pool|expression of interest/i;
const qualificationHeading = /필수\s*요건|^(지원\s*자격|자격\s*요건|이런 분과 함께 하고 싶어요|(?:basic |minimum |required )?(qualifications|requirements)|required|you need to have|what you bring|what we['’]re looking for|how do i know if the role is right for me)/i;
const otherSection = /우대\s*(요건|사항)|^이런 점|^preferred|^nice to have|^what you[’']ll (?:actually )?do|^added value|^bonus|^a plus|^supporting your best|^benefits|^moloco values|^전형\s*(과정|절차)|^근무\s*조건/i;

function decode(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', ndash: '–', mdash: '—' };
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|ndash|mdash|#\d+|#x[\da-f]+);/gi, (raw, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()];
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
  });
}

function requirements(content) {
  const html = decode(content);
  const lines = html.replace(/<\/?(?:h[1-6]|p|li|ul|ol|div|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '').split(/\n/).map(line => decode(line).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const start = lines.findIndex(line => line.length < 100 && qualificationHeading.test(line));
  if (start < 0) return [];
  const result = new Set();
  for (const line of lines.slice(start + 1)) {
    if (otherSection.test(line)) break;
    if (line.length >= 10 && !qualificationHeading.test(line)) result.add(line.slice(0, 500));
    if (result.size === 8) break;
  }
  return [...result];
}

async function readBoard([slug, company]) {
  const response = await fetch('https://boards-api.greenhouse.io/v1/boards/' + slug + '/jobs?content=true', {
    signal: AbortSignal.timeout(7000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Employer board unavailable');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error('Feed exceeds limit');
    chunks.push(chunk);
  }
  const feed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const jobs = [];
  for (const post of feed.jobs) {
    const location = post.location?.name || '';
    if (!koreanLocation.test(location) || poolListing.test(post.title) || !post.internal_job_id) continue;
    if (!post.title || !post.content || !/^https:\/\//i.test(post.absolute_url)) continue;
    const items = requirements(post.content);
    if (items.length) jobs.push({ company, title: post.title.trim(), location, url: post.absolute_url, requirements: items });
    if (jobs.length >= 150) break;
  }
  return jobs;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET 요청만 지원합니다.' });
  }
  const results = await Promise.allSettled(boards.map(readBoard));
  const healthy = results.filter(result => result.status === 'fulfilled');
  const partial = healthy.length < boards.length;
  if (!healthy.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ jobs: [], partial: true, error: '채용 게시판을 불러오지 못했습니다.' });
  }
  res.setHeader('Cache-Control', partial ? 'public, max-age=0, s-maxage=60' : 'public, max-age=0, s-maxage=900');
  return res.status(200).json({ jobs: healthy.flatMap(result => result.value), partial });
}
