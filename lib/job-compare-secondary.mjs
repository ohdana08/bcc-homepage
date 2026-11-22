// JOB-ALIO's public mobile search and its linked public employer postings.
const base = 'https://job.alio.go.kr';
const listPath = '/mobile2021/recruit/recruit.do';
const maxDetails = 9;

async function readPage(url, signal) {
  const response = await fetch(url, {signal, redirect:'error'});
  if (!response.ok) throw new Error('Job-ALIO unavailable');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 650_000) throw new Error('Job-ALIO response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function plain(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&')
    .replace(/\s+/g,' ').trim();
}

function readListings(html) {
  if (!html.includes('class="recruit_list"')) throw new Error('Job-ALIO list unavailable');
  const listings = [];
  for (const row of html.matchAll(/<a\b[^>]*href="(\/mobile2021\/recruit\/recruitView\.do\?idx=\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const card = row[2];
    if (!/<span\b[^>]*>\s*진행중\s*<\/span>/i.test(card)) continue;
    const company = plain(card.match(/<div class="workPlace">([\s\S]*?)<\/div>/i)?.[1] || '');
    const title = plain(card.match(/<div class="tit">([\s\S]*?)<\/div>/i)?.[1] || '');
    const date = plain(card.match(/<div class="date">([\s\S]*?)<\/div>/i)?.[1] || '');
    const location = date.split('/')[0].trim();
    if (!company || !title || !location || /해외|국외/.test(location)) continue;
    listings.push({company, title, location, url:base + row[1]});
  }
  return listings;
}

function readRequirements(html) {
  if (!/<th[^>]*>\s*기관명\s*<\/th>/i.test(html)) throw new Error('Job-ALIO detail unavailable');
  const cell = html.match(/<th[^>]*>\s*응시자격\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] || '';
  const lines = cell.split(/<br\s*\/?\s*>|<\/p>|\n/i).map(plain)
    .filter(line => line.length >= 4 && !/^(?:※\s*)?(?:붙임|첨부|공고문|채용공고문|공고)\s*(?:파일|문서)?\s*(?:참조|참고|확인)[.\s]*$/.test(line));
  return [...new Set(lines)].slice(0, 14).map(line=>line.length > 650 ? line.slice(0, 649) + '…' : line);
}

export async function searchSecondaryWithStatus(terms) {
  const signal = AbortSignal.timeout(8500);
  const keywords = [...new Set(terms)].slice(0, 3);
  if (!keywords.length) keywords.push('');
  const lists = await Promise.allSettled(keywords.map(async keyword => {
    const url = new URL(listPath,base);
    url.search = new URLSearchParams({keyword, ing:'2', search_yn:'Y', order:'REG_DATE'});
    return readListings(await readPage(url, signal));
  }));
  const successful = lists.filter(list => list.status === 'fulfilled').map(list => list.value);
  if (!successful.length) throw new Error('Job-ALIO search unavailable');

  // Interleave terms so that a popular first term cannot fill every detail slot.
  const candidates = new Map();
  const count = Math.max(0, ...successful.map(list=>list.length));
  for (let index = 0; index < count && candidates.size < maxDetails; index++) {
    for (const list of successful) {
      const posting = list[index];
      if (posting && candidates.size < maxDetails) candidates.set(posting.url, posting);
    }
  }
  const details = await Promise.allSettled([...candidates.values()].map(async listing => {
    const requirements = readRequirements(await readPage(listing.url, signal));
    return requirements.length ? {...listing, requirements} : null;
  }));
  if (details.length && details.every(result=>result.status === 'rejected')) throw new Error('Job-ALIO details unavailable');
  return {
    jobs: details.filter(result=>result.status === 'fulfilled' && result.value).map(result=>result.value),
    partial: successful.length < lists.length || details.some(result=>result.status === 'rejected')
  };
}

export async function searchSecondary(terms) {
  return (await searchSecondaryWithStatus(terms)).jobs;
}
