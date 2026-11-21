import { createHash } from 'node:crypto';

export const EXPERIENCE_SCHEMA = 'ai_experience_v2';
export const MAX_PORTFOLIO_BYTES = 1024 * 1024;
export const EXPERIENCE_QUESTIONS = [
  { id: 'experience_tasks', title: 'AI로 어떤 일을 해보셨나요?', help: '해본 것을 모두 골라주세요. 처음이어도 괜찮아요.', type: 'multi', required: true, max: 9, options: [
    ['search', '질문·검색'], ['writing', '글쓰기'], ['image', '이미지 만들기'], ['cardnews', '카드뉴스 만들기'], ['video', '영상 만들기'], ['documents', '문서·자료 정리'], ['development', '프로그램·자동화 제작'], ['other', '기타'], ['none', '아직 해본 것이 없어요'],
  ] },
  { id: 'creation_process', title: '그중 하나는 어떻게 만들어보셨나요?', help: '해당하는 경험을 모두 골라주세요. 첫 결과를 고친 경험도 좋아요.', type: 'multi', required: true, max: 4, skip_when: { question: 'experience_tasks', includes: 'none' }, options: [
    ['follow', '설명을 보며 따라 해봤어요'], ['direct', '내 목적에 맞게 직접 요청했어요'], ['revise', '결과를 여러 번 수정했어요'], ['use', '실제 업무·게시 등에 사용했어요'], ['none', '아직 제작까지는 해보지 않았어요'],
  ] },
  { id: 'portfolio', title: '보여줄 수 있는 결과물이 있나요?', help: 'AI 활용 경험을 이해하고 수업을 기획하기 위한 참고 자료입니다. 공유 가능한 파일·화면 캡처·링크를 보내주세요. 없거나 공유하기 어려우면 건너뛰어도 됩니다.', type: 'portfolio', required: false, max_bytes: MAX_PORTFOLIO_BYTES, accepted_types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  { id: 'desired_work', title: '이번에는 무엇을 만들어보고 싶나요?', help: '관심 있는 것을 3개까지 골라주세요. 하고 싶은 일을 한 문장으로 덧붙여도 좋아요.', type: 'multi', required: true, max: 3, options: [
    ['writing', '글·홍보 문구'], ['image', '이미지·포스터'], ['cardnews', '카드뉴스·SNS 콘텐츠'], ['video', '짧은 영상'], ['documents', '문서·기획서·자료 정리'], ['development', '프로그램·챗봇·자동화'], ['other', '기타'], ['undecided', '아직 정하지 못했어요'],
  ] },
  { id: 'support_needs', title: '수업에서 어떤 부분의 도움이 필요하신가요?', help: '필요한 도움을 모두 골라주세요. 잘 모르겠어도 괜찮아요.', type: 'multi', required: true, max: 9, options: [
    ['files', '파일 저장·업로드'], ['prompt', 'AI에 요청하기'], ['ideas', '아이디어 정리'], ['visual', '이미지·영상 제작'], ['revise', '결과 수정하기'], ['verify', '사실·출처·사용 조건 확인'], ['setup', '계정·로그인·설치'], ['pace', '한 단계씩 조작 안내'], ['other', '기타'], ['unsure', '아직 잘 모르겠어요'], ['none', '지금은 특별히 없어요'],
  ] },
];

const invalid = (message) => Object.assign(new Error(message), { httpStatus: 400 });
const clean = (value, max = 240) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const freeText = (value, max = 240) => clean(value, max).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일 삭제]').replace(/(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[전화번호 삭제]');
export function safePortfolioUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.length > 2000 || /[\u0000-\u0020\u007f]/.test(raw)) throw invalid('작품 링크를 확인해 주세요.');
  let url;
  try { url = new URL(raw); } catch { throw invalid('http 또는 https로 시작하는 작품 링크를 넣어주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid('http 또는 https로 시작하는 공개 가능한 작품 링크만 넣어주세요.');
  return url.href;
}

export function normalizePortfolioFile(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw invalid('첨부 파일을 다시 선택해 주세요.');
  const mime = String(input.mime_type || '');
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) throw invalid('JPG, PNG, WebP 이미지 또는 PDF 파일을 선택해 주세요.');
  const base64 = input.data_base64;
  if (typeof base64 !== 'string' || !base64 || base64.length > Math.ceil(MAX_PORTFOLIO_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw invalid('첨부 파일은 1MB 이하로 선택해 주세요.');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_PORTFOLIO_BYTES) throw invalid('첨부 파일은 1MB 이하로 선택해 주세요.');
  if (!bytes.length || bytes.toString('base64') !== base64) throw invalid('첨부 파일을 읽을 수 없습니다.');
  const matches = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/webp' ? bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    : bytes.toString('ascii', 0, 5) === '%PDF-';
  if (!matches) throw invalid('파일 형식과 내용이 일치하지 않습니다. 다른 파일을 선택해 주세요.');
  const suffix = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'application/pdf':'pdf' }[mime];
  // Normalize the download name; never trust extensions or path segments supplied by a client.
  const stem = freeText(input.name || '나의-작품', 100).replace(/[/\\<>:"|?*]/g, '_').replace(/\.[^.]*$/, '').replace(/^\.+/, '').trim() || '나의-작품';
  return { name: `${stem}.${suffix}`, mime_type: mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data_base64: base64 };
}

export function normalizeExperienceAnswers(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('응답 내용을 확인해 주세요.');
  const answers = { schema_version: EXPERIENCE_SCHEMA, others: {} };
  for (const question of EXPERIENCE_QUESTIONS) {
    if (question.type === 'portfolio') continue;
    if (question.id === 'creation_process' && answers.experience_tasks.includes('none')) { answers.creation_process = []; continue; }
    const raw = input[question.id];
    if (!Array.isArray(raw) || raw.some(value => typeof value !== 'string')) throw invalid(`‘${question.title}’에 답해주세요.`);
    const allowed = new Set(question.options.map(([id]) => id));
    if (raw.some(value => !allowed.has(value))) throw invalid(`‘${question.title}’의 선택 항목을 확인해 주세요.`);
    const values = [...new Set(raw)];
    if (!values.length) throw invalid(`‘${question.title}’에 답해주세요.`);
    if (values.length > question.max) throw invalid(`‘${question.title}’은 ${question.max}개까지 선택할 수 있습니다.`);
    if (values.some(value => ['none','undecided','unsure'].includes(value)) && values.length > 1) throw invalid('아직 없음·미정·잘 모르겠음은 다른 항목과 함께 선택할 수 없습니다.');
    answers[question.id] = values;
    if (values.includes('other')) {
      const detail = freeText(input.others?.[question.id]);
      if (!detail) throw invalid(`‘${question.title}’의 기타 내용을 적어주세요.`);
      answers.others[question.id] = detail;
    }
  }
  answers.desired_detail = freeText(input.desired_detail, 400);
  const supportDetail = freeText(input.support_detail, 800);
  if (supportDetail) answers.support_detail = supportDetail;
  answers.tools_detail = freeText(input.tools_detail, 160);
  const portfolio = input.portfolio && typeof input.portfolio === 'object' ? input.portfolio : {};
  const url = safePortfolioUrl(portfolio.url);
  const attachment = normalizePortfolioFile(portfolio.file);
  if ((url || attachment) && portfolio.consent !== true) throw invalid('작품 공유 안내를 확인하고 동의해 주세요. 공유하지 않고 건너뛰어도 됩니다.');
  const { data_base64: _bytes, ...metadata } = attachment || {};
  answers.portfolio = { url, consent: Boolean(url || attachment), ...(attachment ? { file: metadata } : {}) };
  return { answers, attachment };
}

function labels(id, values = []) {
  const question = EXPERIENCE_QUESTIONS.find(q => q.id === id);
  const mapping = new Map(question?.options || []);
  return (Array.isArray(values) ? values : []).map(value => mapping.get(value) || value);
}

export function experienceResponseCard(row) {
  const a = row?.answers || {};
  if (a.schema_version !== EXPERIENCE_SCHEMA) return null;
  return {
    response_id: row.id == null ? null : String(row.id), submitted_at: row.submitted_at || null,
    experience_tasks: labels('experience_tasks', a.experience_tasks),
    creation_process: labels('creation_process', a.creation_process),
    desired_work: labels('desired_work', a.desired_work), support_needs: labels('support_needs', a.support_needs),
    support_detail: a.support_detail || '', desired_detail: a.desired_detail || '', tools_detail: a.tools_detail || '', others: a.others || {},
    portfolio: { url: a.portfolio?.url || '', ...(a.portfolio?.file ? { file: { name: a.portfolio.file.name, mime_type: a.portfolio.file.mime_type, size: a.portfolio.file.size } } : {}) },
  };
}

export function summarizeExperienceResponses(rows = []) {
  const cohort = rows.filter(row => row?.answers?.schema_version === EXPERIENCE_SCHEMA);
  const distributions = {}; const answered_counts = {};
  for (const q of EXPERIENCE_QUESTIONS.filter(q => q.type === 'multi')) {
    const answering = cohort.filter(row => Array.isArray(row.answers[q.id]) && row.answers[q.id].length);
    answered_counts[q.id] = answering.length;
    const counts = new Map();
    for (const row of answering) for (const value of new Set(row.answers[q.id])) counts.set(value, (counts.get(value) || 0) + 1);
    const mapping = new Map(q.options);
    distributions[q.id] = [...counts].map(([value,count]) => ({ value, label: mapping.get(value) || value, count, percentage: answering.length ? Math.round(count / answering.length * 1000) / 10 : 0 })).sort((a,b) => b.count-a.count);
  }
  return { sample_size: cohort.length, distributions, answered_counts, support_details: cohort.map(row => freeText(row.answers.support_detail, 800)).filter(Boolean).slice(0, 80) };
}
