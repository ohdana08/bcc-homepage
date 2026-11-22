import {readDocument} from '../document-mate/files.mjs';
import {compareJobs} from './match.mjs';

const get = id => document.getElementById(id);
const form = get('compare-form');
const resume = get('resume');
const role = get('role');
const file = get('resume-file');
const result = get('results');
const button = get('compare');
const status = get('status');
let request;
let readVersion = 0;
let importing = false;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function invalidate() {
  request?.abort();
  request = null;
  button.disabled = importing;
  status.textContent = '';
  result.hidden = true;
  get('job-cards').replaceChildren();
  get('char-count').textContent = resume.value.length.toLocaleString('ko-KR') + ' / 12,000자';
}
resume.addEventListener('input', () => {
  resume.setCustomValidity('');
  get('file-status').textContent = '';
  readVersion++;
  importing = false;
  invalidate();
});
role.addEventListener('input', invalidate);
file.addEventListener('change', async () => {
  const selected = file.files[0];
  if (!selected) return;
  const version = ++readVersion;
  importing = true;
  invalidate();
  get('file-status').textContent = '파일에서 글자를 읽고 있습니다…';
  try {
    const {text,warnings} = await readDocument(selected);
    if (version !== readVersion) return;
    resume.value = text;
    resume.setCustomValidity('');
    get('file-status').textContent = '읽은 내용을 아래 비교에 사용합니다. ' + warnings.join(' ');
  } catch (error) {
    if (version !== readVersion) return;
    const message = error instanceof TypeError ? '파일을 읽지 못했습니다. 텍스트를 직접 붙여 넣어 주세요.' : error.message;
    get('file-status').textContent = resume.value.trim()
      ? message + ' 다음 비교에는 입력란에 남아 있는 기존 이력서를 사용합니다.'
      : message;
  } finally {
    if (version === readVersion) {
      importing = false;
      file.value = '';
      invalidate();
    }
  }
});
function validJob(job) {
  if (!job || ![job.company,job.title,job.location,job.url].every(v => typeof v === 'string') ||
      !job.company || !job.title || !Array.isArray(job.requirements) ||
      !job.requirements.length || !job.requirements.every(s => typeof s === 'string' && s.trim())) return false;
  try { return new URL(job.url).protocol === 'https:'; } catch { return false; }
}
function cell(label,text) {
  const el = node('div',null,'cell');
  el.append(node('strong',label),node('p',text));
  return el;
}
function jobCard({job,ranked,pairs}) {
  const article = node('article',null,'job');
  const head = node('div',null,'jobtop');
  const heading = node('div');
  heading.append(node('p',job.company+' · '+job.location,'company'),node('h3',job.title));
  const source = node('a','공고 원문 ↗','source');
  source.href = job.url;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.setAttribute('aria-label',job.company+' '+job.title+' 공고 원문 새 창에서 열기');
  head.append(heading,source);
  article.append(head);
  const shown = ranked.slice(0,2);
  if (!shown.length) {
    article.append(node('p','직무명 또는 희망 직무와 관련된 공고입니다. 요건과 직접 겹치는 이력서 표현은 찾지 못했습니다.'));
  }
  for (const pair of shown) {
    const grid = node('div',null,'grid');
    const proof = cell('이력서의 관련 문장',pair.line);
    proof.append(node('p','겹치는 표현 · '+pair.matched.join(', '),'terms'));
    grid.append(cell('공고에 나온 요건',pair.text),proof);
    article.append(grid);
  }
  const rest = pairs.filter(p=>!shown.includes(p));
  if (rest.length) {
    const more = node('details');
    more.append(node('summary','다른 공고 요건 '+rest.length+'개 보기'));
    const list = node('ul');
    for (const p of rest) {
      const li = node('li',p.text);
      li.append(node('p',p.score ? '관련 문장 · '+p.line : '이력서에서 겹치는 표현을 찾지 못했습니다.','note'));
      list.append(li);
    }
    more.append(list);
    article.append(more);
  }
  const details = node('details');
  details.append(node('summary','채용 문의 초안 보기'));
  const intro = '안녕하세요. '+job.company+'의 '+job.title+' 공고를 보고 문의드립니다.';
  const question = shown.length
    ? '제 이력서에는 다음 경험이 있습니다.\n“'+shown[0].line+'”\n이 경험을 지원서에 담을 때 어떤 업무 사례를 구체적으로 설명하면 좋을까요?'
    : '지원서를 준비하고 있습니다. 이 직무에서 가장 중요하게 살펴보시는 경험은 무엇인가요?';
  details.append(node('p',intro+'\n'+question+'\n감사합니다.','draft'),
    node('p','연락 가능한 경로는 위 공고 원문에서 확인하세요.','note'));
  article.append(details);
  return article;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (importing) return;
  if (!resume.value.trim()) {
    resume.setCustomValidity('비교할 경력이나 기술을 입력해 주세요.');
    resume.reportValidity();
    return;
  }
  invalidate();
  const controller = new AbortController();
  request = controller;
  button.disabled = true;
  status.textContent = '기업의 채용 공고를 불러오는 중입니다…';
  const timer = setTimeout(()=>controller.abort(),30000);
  try {
    const response = await fetch('/api/job-compare-list',{signal:controller.signal,credentials:'omit'});
    if (!response.ok) throw new Error();
    const payload = await response.json();
    if (!Array.isArray(payload.jobs)) throw new Error();
    if (request !== controller) return;
    const jobs = payload.jobs.filter(validJob);
    const matches = compareJobs(jobs,resume.value,role.value);
    const limited = payload.partial ? ' 일부 기업의 공고를 불러오지 못했습니다.' : '';
    if (!jobs.length || !matches.length) {
      status.textContent = (jobs.length ? '확인한 '+jobs.length+'개 공고에서 관련 표현을 찾지 못했습니다. 경력에 사용한 기술이나 희망 직무를 구체적으로 입력해 보세요.' : '현재 비교할 국내 근무 공고를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')+limited;
      return;
    }
    get('results-title').textContent = '내 이력서와 비교한 공고 '+matches.length+'개';
    get('summary').textContent = '조회한 국내 근무 공고 '+jobs.length+'개에서 희망 직무와 경력·기술 표현이 겹치는 순서입니다. 경력 연수와 필수 조건 충족 여부는 원문에서 확인하세요.'+limited;
    get('job-cards').replaceChildren(...matches.map(jobCard));
    status.textContent = '';
    result.hidden = false;
    get('results-title').focus();
  } catch {
    if (request === controller) status.textContent = '채용 공고를 불러오지 못했습니다. 이력서는 그대로 있으니 잠시 후 다시 비교해 주세요.';
  } finally {
    clearTimeout(timer);
    if (request === controller) {
      request = null;
      button.disabled = false;
    }
  }
});
