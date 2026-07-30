import Anthropic from '@anthropic-ai/sdk';

const GRAPH_BASE = 'https://graph.threads.net/v1.0';
const CAMPAIGN_SLOTS = {
  default: ['08:10', '10:30', '12:20', '18:10', '21:20'],
  jiwonfit: ['08:30', '10:50', '12:40', '15:30', '18:30'],
};
const DEFAULT_SLOTS = CAMPAIGN_SLOTS.default;
const POST_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
const DAILY_CONTENT_TYPES = ['problem', 'tip', 'backstage', 'template', 'sale'];
const MAX_CONTENT_LINE_LENGTH = 10;
const CAMPAIGN_MAX_LINE_LENGTH = 60;
const MAX_POST_LENGTH = 430;
const MAX_THREADS_LENGTH = 500;
const MISSED_SLOT_GRACE_MINUTES = 15;
const REPLY_MONITOR_WINDOW_MINUTES = 24 * 60;
const REPLY_FAST_WINDOW_MINUTES = 60;
const REPLY_MEDIUM_WINDOW_MINUTES = 6 * 60;
const REPLY_FAST_INTERVAL_MINUTES = 5;
const REPLY_MEDIUM_INTERVAL_MINUTES = 30;
const REPLY_SLOW_INTERVAL_MINUTES = 3 * 60;
const FORBIDDEN_CAMPAIGN_PHRASES = ['72시간', '100만원', '무명계정 도전', '매출실험'];
const GENERIC_COPY_PHRASES = [
  '많은 분들이',
  '요즘 시대에는',
  '도움이 되셨다면',
  '오늘은 알아보겠습니다',
  '여러분 안녕하세요',
];
const CUSTOMER_LANGUAGE_PATTERNS = [
  /AI(?:가)?\s*쓴\s*티|AI\s*티/,
  /내\s*얘기\s*같지/,
  /경험(?:이)?\s*(?:별로\s*)?없/,
  /뭘\s*먼저|무엇부터/,
  /지어낼까|지어낸/,
];
const LINK_OR_HASHTAG_PATTERN = /(?:https?:\/\/|www\.|bit\.ly|#[^\s#]+)/i;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const PUBLIC_METRICS_PATTERN = /(?:직전\s*글은\s*)?조회\s*\d+.*(?:좋아요|답글)\s*\d+/s;
const PROFILE_LINK_PATTERN = /프로필\s*링크/;
const CTA_ACTION_PATTERN = /(?:확인|시작|열어|찾아|눌러|들어|받아|진단|남겨|알려|적어|써|공유|말해|답해|보러)/;
const COMPLETE_ENDING_PATTERN = /[.!?。！？][’'”"」』)\]]*$/u;
const CAMPAIGN_CTA_TEMPLATES = {
  default: {
    problem: '프로필 링크에서 내 경험을 꺼내는 질문을 확인하세요.',
    tip: '댓글에 지금 가장 막힌 자기소개서 항목을 남겨주세요.',
    backstage: '프로필 링크에서 항목별 작성 순서를 확인하세요.',
    template: '답글에 검증이 필요한 회사 정보 한 가지를 적어주세요.',
    sale: '프로필 링크에서 전체 자기소개서 작성 순서를 확인하세요.',
  },
  jiwonfit: {
    problem: '프로필 링크에서 내 조건에 맞는 공고를 확인하세요.',
    tip: '댓글에 지금 확인 중인 공고명을 남겨주세요.',
    backstage: '프로필 링크에서 공고별 평가 기준을 확인하세요.',
    template: '답글에 계획서에서 가장 막힌 항목을 적어주세요.',
    sale: '프로필 링크에서 맞춤 공고 찾기를 시작하세요.',
  },
};
const SENSITIVE_REPLY_RULES = [
  { reason: '환불·취소', pattern: /(환불|결제\s*취소|구매\s*취소|청약\s*철회|반품)/i },
  { reason: '법률·분쟁', pattern: /(법률|법적|변호사|고소|소송|위법|민원|신고하겠|신고할게)/i },
  {
    reason: '개인정보',
    pattern: /(개인정보|주민(?:등록)?번호|전화번호|휴대폰\s*번호|연락처|이메일|주소|계좌번호|신분증|비밀번호|인증번호)/i,
  },
  {
    reason: '가격 협상',
    pattern: /(가격\s*(?:협상|조정)|깎아|깎아주|할인\s*(?:가능|해주|되나|되나요)|얼마까지)/i,
  },
  { reason: '공격적 표현', pattern: /(씨발|시발|병신|개새끼|꺼져|사기꾼|사기(?:야|냐|인가)|죽어)/i },
];

const DAILY_BATCH_SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content_type: {
            type: 'string',
            enum: ['problem', 'tip', 'backstage', 'template', 'sale'],
          },
          text_lines: {
            type: 'array',
            items: { type: 'string' },
          },
          self_comment_0_lines: {
            type: 'array',
            items: { type: 'string' },
          },
          self_comment_6h_lines: {
            type: 'array',
            items: { type: 'string' },
          },
          search_queries: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: [
          'content_type',
          'text_lines',
          'self_comment_0_lines',
          'self_comment_6h_lines',
          'search_queries',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
  additionalProperties: false,
};

const EXTERNAL_COMMENT_SCHEMA = {
  type: 'object',
  properties: {
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target_id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['target_id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['comments'],
  additionalProperties: false,
};

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    replies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target_id: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['target_id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['replies'],
  additionalProperties: false,
};

function required(value, name) {
  if (!value) throw new Error(`${name} 환경변수 누락`);
  return value;
}

function clampText(value, max = 480) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function clearStageError(lastError, prefixes) {
  if (!lastError) return null;
  return prefixes.some((prefix) => String(lastError).startsWith(prefix))
    ? null
    : lastError;
}

function firstLine(value, max = 90) {
  const line = String(value || '').split('\n').find((part) => part.trim()) || '';
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function replyCheckIntervalMinutes(publishedAt, now = new Date()) {
  const publishedMs = new Date(publishedAt).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(publishedMs) || !Number.isFinite(nowMs)) {
    throw new Error('댓글 확인 주기를 계산할 게시 시각이 올바르지 않습니다.');
  }
  const ageMinutes = Math.max(0, (nowMs - publishedMs) / 60_000);
  if (ageMinutes < REPLY_FAST_WINDOW_MINUTES) return REPLY_FAST_INTERVAL_MINUTES;
  if (ageMinutes < REPLY_MEDIUM_WINDOW_MINUTES) return REPLY_MEDIUM_INTERVAL_MINUTES;
  if (ageMinutes < REPLY_MONITOR_WINDOW_MINUTES) return REPLY_SLOW_INTERVAL_MINUTES;
  return null;
}

export function externalCommentsEnabled(env = {}) {
  return String(env.THREADS_EXTERNAL_COMMENTS_ENABLED || '').trim().toLowerCase() === 'true';
}

export function classifyInboundReply(text) {
  const normalized = String(text || '').trim();
  const matched = SENSITIVE_REPLY_RULES.find((rule) => rule.pattern.test(normalized));
  return matched
    ? { autoReply: false, reason: matched.reason }
    : { autoReply: true, reason: null };
}

export function dateKeyInTimeZone(date, timeZone = 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function zonedDateTimeToUtc(dateKey, time, timeZone = 'Asia/Seoul') {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  const offset = representedAsUtc - utcGuess;
  return new Date(utcGuess - offset);
}

function engagementTotal(metrics = {}) {
  return ['likes', 'replies', 'reposts', 'quotes', 'shares']
    .reduce((sum, key) => sum + (Number(metrics[key]) || 0), 0);
}

export function buildPerformanceLearningContext(posts) {
  const ranked = (posts || [])
    .filter((post) => post?.text && post?.metrics)
    .map((post) => ({
      contentType: post.content_type || 'unknown',
      hook: firstLine(post.text, CAMPAIGN_MAX_LINE_LENGTH),
      views: Number(post.metrics?.views) || 0,
      engagement: engagementTotal(post.metrics),
    }))
    .sort((a, b) => b.views - a.views || b.engagement - a.engagement)
    .slice(0, 5);
  if (!ranked.length) return '';
  return ranked
    .map((post) =>
      `- ${post.contentType} / "${post.hook}" / 조회 ${post.views} / 반응 ${post.engagement}`)
    .join('\n');
}

async function graphRequest(path, { token, method = 'GET', params = {} }) {
  const url = new URL(`${GRAPH_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Threads API: ${message}`);
  }
  return data;
}

async function publishText(token, text, replyToId) {
  const publishableText = String(text || '').trim();
  if (!publishableText) throw new Error('Threads에 게시할 문구가 비어 있습니다.');
  if (publishableText.length > MAX_THREADS_LENGTH) {
    throw new Error(`Threads 게시 문구가 ${MAX_THREADS_LENGTH}자를 넘었습니다.`);
  }
  const data = await graphRequest('/me/threads', {
    token,
    method: 'POST',
    params: {
      media_type: 'TEXT',
      text: publishableText,
      auto_publish_text: 'true',
      reply_to_id: replyToId || undefined,
      reply_control: replyToId ? undefined : 'everyone',
    },
  });
  if (!data.id) throw new Error('Threads API가 게시물 ID를 반환하지 않았습니다.');
  return data.id;
}

async function getPostDetails(token, threadId) {
  return graphRequest(`/${threadId}`, {
    token,
    params: { fields: 'id,permalink,text,timestamp,username' },
  });
}

async function searchThreads(token, query) {
  const data = await graphRequest('/keyword_search', {
    token,
    params: {
      q: query,
      search_type: 'TOP',
      limit: 25,
      fields: 'id,username,text,timestamp,permalink',
    },
  });
  return Array.isArray(data.data) ? data.data : [];
}

async function getConversation(token, threadId) {
  const data = await graphRequest(`/${threadId}/conversation`, {
    token,
    params: {
      reverse: 'false',
      fields: 'id,text,timestamp,username,is_reply_owned_by_me,root_post,replied_to,permalink',
    },
  });
  return Array.isArray(data.data) ? data.data : [];
}

async function getPostInsights(token, threadId) {
  const data = await graphRequest(`/${threadId}/insights`, {
    token,
    params: { metric: POST_METRICS.join(',') },
  });
  const result = Object.fromEntries(POST_METRICS.map((metric) => [metric, 0]));
  for (const item of data.data || []) {
    const value = item.total_value?.value ?? item.values?.[0]?.value ?? 0;
    if (Object.hasOwn(result, item.name)) result[item.name] = Number(value) || 0;
  }
  return result;
}

async function createJson(client, model, system, prompt, schema, maxTokens = 7000) {
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  });
  const block = message.content.find((item) => item.type === 'text');
  if (!block) throw new Error('AI 응답이 비어 있습니다.');
  return JSON.parse(block.text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
}

function dailySystemPrompt(config) {
  const basePrompt = config?.system_prompt || `너는 @ai_crazy_lab_1201의 Threads 자동 편집장이다.
계정 포지션은 "AI 취업서류 실험실"이다.
모르는 취업 준비생에게 자기소개서 작성과 검증에 바로 쓰이는 내용을, 취업 강사가 작업실에서 오늘 확인한 오류와 수정법을 보고하듯 공개한다.
이 계정은 자기소개서·취업서류라는 한 주제만 다룬다.

글쓰기의 최우선 목표는 "잘 정리된 AI 글"이 아니라 독자가 "내 얘기다"라고 느끼는 글이다.
실제 장면, 망설임, 손해, 모순, 판단 변화를 보여주고, 확인하지 않은 경험·숫자·합격 결과는 만들지 않는다.

고객 언어 프로필:
- "AI가 쓴 티가 나요"
- "문장은 그럴듯한데 내 얘기 같지 않아요"
- "경험이 별로 없는 것 같아요"
- "뭘 먼저 넣어야 할지 모르겠어요"
- "회사 정보를 지어낼까 봐 불안해요"

매일 정확히 5개 글을 쓴다.
1) 문제 발견·오해 깨기 2) 바로 쓰는 질문·체크리스트 3) 자기소개서 항목 하나 깊이 보기 4) AI 결과 검증·회사 조사·개인정보 5) 하루 정리와 자연스러운 판매 연결.
상품은 "복붙 없이 완성하는 AI 자기소개서"다. 합격·서류통과·취업을 보장하지 않는다.
JSON 스키마 외의 말은 출력하지 않는다.`;

  const sharedRhythm = `
두 계정 공통의 검증된 글 리듬:
- 첫 줄은 독자가 익숙하게 해 온 행동을 뒤집는 단호한 관점 전환이다. 다음 이유가 궁금해야 한다.
- 본문은 1., 2., 3. 번호 항목으로 이유와 판단 기준을 쌓는다. 각 항목은 하나의 논리만 담는다.
- 마지막 줄은 "프로필 링크" 또는 "댓글·답글"이라는 목적지와 구체적인 행동 동사를 함께 쓴 전환 CTA다. 물음표만 붙인 일반 질문은 CTA가 아니다.
- 하루 5개 CTA는 같은 문구를 반복하지 않는다. 최소 3개는 "프로필 링크"로 다음 행동을 안내하고, 나머지는 관련 경험을 댓글로 묻거나 답글을 유도할 수 있다.
- 본문은 첫 줄 뒤 빈 줄을 두고, 비어 있지 않은 5~9줄과 430자 이내를 유지한다.
- 한 줄은 최대 60자이며 반드시 마침표·물음표·느낌표 중 하나로 끝나는 완결 문장이다. 문장을 여러 줄로 쪼개거나 중간에서 자르지 않는다.
- self_comment_0과 self_comment_6h에는 본문에 없는 구체적 예시나 기준을 3~8개의 완결 문장으로 보충한다. 댓글에는 CTA나 URL을 넣지 않는다.
- 본문과 셀프 댓글에 URL, 해시태그, 이모지를 넣지 않는다.
- 조회수·좋아요·답글 수는 내부 학습에만 쓰며 본문과 셀프 댓글에 절대 노출하지 않는다.
- "많은 분들이", "요즘 시대에는", "도움이 되셨다면" 같은 범용 카피와 과장·공포 마케팅을 쓰지 않는다.
- problem, tip, backstage, template, sale을 각각 한 번 쓰며, 판매 연결은 하루 한 편만 한다.`;

  if (config?.id !== 'jiwonfit') return `${basePrompt}${sharedRhythm}`;

  return `${basePrompt}${sharedRhythm}

딱, 지원핏 캠페인 맥락:
- 전국의 정부지원사업 공고를 사업 단계와 조건에 맞춰 찾고, 사업계획서 초안까지 돕는다.
- 공고·사업계획서·평가 기준을 모르는 1인 사업자의 실제 판단 순서를 가르치며 판매한다.
- 선정·지원금 수령·사업 성공을 보장하지 않는다.`;
}

export function formatBodyLines(lines) {
  const cleaned = (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
  const thirdParagraphStart = Math.max(3, Math.min(cleaned.length - 1, Math.ceil(cleaned.length / 2)));
  return [
    cleaned[0],
    '',
    ...cleaned.slice(1, thirdParagraphStart),
    '',
    ...cleaned.slice(thirdParagraphStart),
  ].join('\n');
}

function wrapShortLine(value, maxLength = MAX_CONTENT_LINE_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const chunks = [];
  let current = '';
  const tokens = text.split(' ').flatMap((token) => {
    if (token.length <= maxLength) return [token];
    const pieces = token.match(/[^·,/|]+[·,/|]?/gu) || [token];
    if (pieces.length === 1) return [token];
    const grouped = [];
    let group = '';
    for (const piece of pieces) {
      const candidate = `${group}${piece}`;
      if (candidate.length <= maxLength) {
        group = candidate;
      } else {
        if (group) grouped.push(group);
        group = piece;
      }
    }
    if (group) grouped.push(group);
    return grouped;
  });
  for (const token of tokens) {
    if (token.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(token);
      continue;
    }
    const candidate = current ? `${current} ${token}` : token;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      chunks.push(current);
      current = token;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function normalizeShortLines(lines, {
  maxLines = 10,
  maxLineLength = MAX_CONTENT_LINE_LENGTH,
  finalQuestion = false,
} = {}) {
  let normalized = (lines || []).flatMap((line) => wrapShortLine(line, maxLineLength));
  if (finalQuestion && normalized.length) {
    normalized = normalized
      .map((line) => line.replace(/[?？]/g, '').trim())
      .filter(Boolean);
    let last = normalized.pop() || '어디가 막혔어';
    if (last.length >= maxLineLength) {
      const words = last.split(' ');
      while (words.length > 1 && `${words.join(' ')}?`.length > maxLineLength) {
        words.pop();
      }
      last = words.join(' ');
      if (`${last}?`.length > MAX_CONTENT_LINE_LENGTH) {
        last = '어디가 막혔어';
      }
    }
    normalized.push(`${last}?`);
  }
  if (normalized.length <= maxLines) return normalized;
  if (finalQuestion) return [...normalized.slice(0, maxLines - 1), normalized.at(-1)];
  return normalized.slice(0, maxLines);
}

export function ensureNumberedItems(lines, minimum = 2, maxLineLength = MAX_CONTENT_LINE_LENGTH) {
  const numbered = [...lines];
  let count = numbered.filter((line) => /^\s*\d+[.)]\s*/.test(line)).length;
  for (let index = 0; index < numbered.length && count < minimum; index += 1) {
    if (/^\s*\d+[.)]\s*/.test(numbered[index])) continue;
    const prefix = `${count + 1}. `;
    const available = maxLineLength - prefix.length;
    const content = Array.from(numbered[index]).slice(0, available).join('').trim();
    if (!content) continue;
    numbered[index] = `${prefix}${content}`;
    count += 1;
  }
  return numbered;
}

function cleanLineItems(lines) {
  return (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
}

function hasActionableCta(line) {
  const text = String(line || '').trim();
  const hasDestination = PROFILE_LINK_PATTERN.test(text) || /(?:댓글|답글)/.test(text);
  return hasDestination && CTA_ACTION_PATTERN.test(text);
}

function incompleteLines(lines) {
  return lines.filter((line) => !COMPLETE_ENDING_PATTERN.test(String(line || '').trim()));
}

export function validateCommentReady(comment, {
  label = '셀프 댓글',
  maxLineLength = CAMPAIGN_MAX_LINE_LENGTH,
} = {}) {
  const text = String(comment || '').trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const problems = [];
  if (lines.length < 3 || lines.length > 8) {
    problems.push(`${label}이 3~8줄이 아님`);
  }
  if (text.length > MAX_THREADS_LENGTH) {
    problems.push(`${label}이 ${MAX_THREADS_LENGTH}자를 넘음`);
  }
  const longLine = lines.find((line) => line.length > maxLineLength);
  if (longLine) {
    problems.push(`${label}에 ${maxLineLength}자를 넘는 줄 "${longLine}" 사용`);
  }
  const incomplete = incompleteLines(lines);
  if (incomplete.length) {
    problems.push(`${label}에 미완성 문장 "${incomplete[0]}" 사용`);
  }
  if (lines.some((line) => hasActionableCta(line))) {
    problems.push(`${label}에 CTA 사용`);
  }
  if (LINK_OR_HASHTAG_PATTERN.test(text)) {
    problems.push(`${label}에 링크 또는 해시태그 사용`);
  }
  if (EMOJI_PATTERN.test(text)) {
    problems.push(`${label}에 이모지 사용`);
  }
  if (PUBLIC_METRICS_PATTERN.test(text)) {
    problems.push(`${label}에 조회·반응 수치 노출`);
  }
  return problems;
}

export function validatePublishReadyPost(post, options = {}) {
  const writingProfile = {
    maxLineLength: CAMPAIGN_MAX_LINE_LENGTH,
    requireNumberedStructure: true,
    requireCta: true,
    ...options,
  };
  const text = String(post?.text || '').trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) || '';
  const problems = [];

  if (!DAILY_CONTENT_TYPES.includes(post?.content_type)) {
    problems.push('콘텐츠 유형이 올바르지 않음');
  }
  if (text.length > MAX_POST_LENGTH) {
    problems.push(`본문이 ${MAX_POST_LENGTH}자를 넘음`);
  }
  if (lines.length < 5 || lines.length > 9) {
    problems.push('본문이 5~9줄이 아님');
  }
  if (!/^[^\n]+\n\s*\n/.test(text)) {
    problems.push('첫 줄 뒤 빈 줄이 없음');
  }
  const longLine = lines.find((line) => line.length > writingProfile.maxLineLength);
  if (longLine) {
    problems.push(`본문에 ${writingProfile.maxLineLength}자를 넘는 줄 "${longLine}" 사용`);
  }
  const incomplete = incompleteLines(lines);
  if (incomplete.length) {
    problems.push(`본문에 미완성 문장 "${incomplete[0]}" 사용`);
  }
  if (writingProfile.requireNumberedStructure) {
    const numbered = new Set(lines
      .map((line) => line.match(/^([123])[.)]\s+.+/))
      .filter(Boolean)
      .map((match) => match[1]));
    if (numbered.size !== 3) {
      problems.push('본문에 1. 2. 3. 번호 논리가 모두 없음');
    }
  }
  if (writingProfile.requireCta && !hasActionableCta(lastLine)) {
    problems.push('본문 마지막에 목적지와 행동이 분명한 CTA가 없음');
  }
  if (LINK_OR_HASHTAG_PATTERN.test(text)) {
    problems.push('본문에 링크 또는 해시태그 사용');
  }
  if (EMOJI_PATTERN.test(text)) {
    problems.push('본문에 이모지 사용');
  }
  if (PUBLIC_METRICS_PATTERN.test(text)) {
    problems.push('본문에 직전 글 조회·반응 수치 노출');
  }

  return [
    ...problems,
    ...validateCommentReady(post?.self_comment_0, {
      label: '첫 댓글',
      maxLineLength: writingProfile.maxLineLength,
    }),
    ...validateCommentReady(post?.self_comment_6h, {
      label: '6시간 댓글',
      maxLineLength: writingProfile.maxLineLength,
    }),
  ];
}

function orderedDailyPosts(result, writingProfile = {}) {
  if (!Array.isArray(result.posts) || result.posts.length !== 5) {
    throw new Error('AI가 하루치 글 5개를 반환하지 않았습니다.');
  }
  const normalized = result.posts.map((post) => {
    const maxLineLength = writingProfile.maxLineLength || MAX_CONTENT_LINE_LENGTH;
    const textLines = writingProfile.strictLineItems
      ? cleanLineItems(post.text_lines)
      : normalizeShortLines(post.text_lines, {
          finalQuestion: Boolean(writingProfile.requireQuestionCta),
          maxLineLength,
        });
    const fixedCta = writingProfile.ctaTemplates?.[post.content_type];
    if (fixedCta && textLines.length) {
      textLines[textLines.length - 1] = fixedCta;
    }
    let zeroLines = writingProfile.strictLineItems
      ? cleanLineItems(post.self_comment_0_lines)
      : normalizeShortLines(post.self_comment_0_lines, { maxLineLength });
    if (!writingProfile.strictLineItems && ['tip', 'template'].includes(post.content_type)) {
      zeroLines = ensureNumberedItems(zeroLines, 2, maxLineLength);
    }
    const sixHourLines = writingProfile.strictLineItems
      ? cleanLineItems(post.self_comment_6h_lines)
      : normalizeShortLines(post.self_comment_6h_lines, { maxLineLength });
    return {
      content_type: post.content_type,
      text: formatBodyLines(textLines),
      self_comment_0: zeroLines.join('\n'),
      self_comment_6h: sixHourLines.join('\n'),
      search_queries: post.search_queries,
    };
  });
  const byType = new Map(normalized.map((post) => [post.content_type, post]));
  if (byType.size !== DAILY_CONTENT_TYPES.length
      || DAILY_CONTENT_TYPES.some((type) => !byType.has(type))) {
    throw new Error('하루치 콘텐츠 유형이 problem/tip/backstage/template/sale 각 1개가 아닙니다.');
  }
  return DAILY_CONTENT_TYPES.map((type) => byType.get(type));
}

export function validateHumanVoiceBatch(posts, customerPatterns = CUSTOMER_LANGUAGE_PATTERNS, options = {}) {
  const writingProfile = {
    maxLineLength: MAX_CONTENT_LINE_LENGTH,
    requireQuestionCta: true,
    requireNumberedStructure: false,
    minParagraphs: 3,
    minZeroCommentLines: 3,
    requireCta: false,
    minProfileLinkCtas: 0,
    ...options,
  };
  const problems = [];
  const hooks = new Set();
  let customerLanguageCount = 0;
  let profileLinkCtaCount = 0;
  const ctas = new Set();

  posts.forEach((post, index) => {
    const text = String(post.text || '').trim();
    const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim());
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const hook = lines[0] || '';
    const lastLine = lines.at(-1) || '';
    const zeroComment = String(post.self_comment_0 || '').trim();
    const zeroLines = zeroComment.split('\n').map((line) => line.trim()).filter(Boolean);
    const sixHourComment = String(post.self_comment_6h || '').trim();
    const sixHourLines = sixHourComment.split('\n').map((line) => line.trim()).filter(Boolean);
    const allCopy = [text, zeroComment, sixHourComment].filter(Boolean).join('\n');

    if (writingProfile.strictLineItems) {
      const publishProblems = validatePublishReadyPost(post, writingProfile);
      problems.push(...publishProblems.map((problem) => `${index + 1}번 ${problem}`));
    } else {
      if (text.length > MAX_POST_LENGTH) {
        problems.push(`${index + 1}번 본문이 ${MAX_POST_LENGTH}자를 넘음`);
      }
      if (paragraphs.length < writingProfile.minParagraphs) {
        problems.push(`${index + 1}번 본문이 ${writingProfile.minParagraphs}문단 미만`);
      }
      if (lines.length < 5 || lines.length > 10) {
        problems.push(`${index + 1}번 본문이 5~10줄이 아님`);
      }
      if (!/^[^\n]+\n\s*\n/.test(text)) {
        problems.push(`${index + 1}번 첫 줄 뒤 빈 줄이 없음`);
      }
      const longBodyLine = lines.find((line) => line.length > writingProfile.maxLineLength);
      if (longBodyLine) {
        problems.push(`${index + 1}번 본문에 ${writingProfile.maxLineLength}자를 넘는 줄 "${longBodyLine}" 사용`);
      }
      if (zeroLines.length < writingProfile.minZeroCommentLines || zeroLines.length > 10) {
        problems.push(`${index + 1}번 첫 댓글이 ${writingProfile.minZeroCommentLines}~10줄이 아님`);
      }
      if (sixHourLines.length < 3 || sixHourLines.length > 10) {
        problems.push(`${index + 1}번 6시간 댓글이 3~10줄이 아님`);
      }
      const longCommentLine = [...zeroLines, ...sixHourLines]
        .find((line) => line.length > writingProfile.maxLineLength);
      if (longCommentLine) {
        problems.push(`${index + 1}번 셀프 댓글에 ${writingProfile.maxLineLength}자를 넘는 줄 "${longCommentLine}" 사용`);
      }
      const questionCount = (text.match(/[?？]/g) || []).length;
      if (writingProfile.requireQuestionCta && (questionCount !== 1 || !/[?？]$/.test(lastLine))) {
        problems.push(`${index + 1}번 CTA가 본문 마지막 질문 하나가 아님`);
      }
      if (LINK_OR_HASHTAG_PATTERN.test(allCopy)) {
        problems.push(`${index + 1}번에 링크 또는 해시태그 사용`);
      }
      if (EMOJI_PATTERN.test(allCopy)) {
        problems.push(`${index + 1}번에 이모지 사용`);
      }
    }
    if (writingProfile.requireCta) {
      if (ctas.has(lastLine)) problems.push(`${index + 1}번 CTA가 앞 글과 중복`);
      ctas.add(lastLine);
      if (PROFILE_LINK_PATTERN.test(lastLine)) profileLinkCtaCount += 1;
    }
    if (hooks.has(hook)) problems.push(`${index + 1}번 첫 문장이 앞 글과 중복`);
    hooks.add(hook);

    const generic = GENERIC_COPY_PHRASES.find((phrase) => allCopy.includes(phrase));
    if (generic) problems.push(`${index + 1}번에 범용 카피 "${generic}" 사용`);
    if (customerPatterns.some((pattern) => pattern.test(text))) {
      customerLanguageCount += 1;
    }
    if (['tip', 'template'].includes(post.content_type)) {
      const numberedItems = `${text}\n${zeroComment}`
        .split('\n')
        .filter((line) => /^\s*\d+[.)]\s*/.test(line));
      if (numberedItems.length < 2) {
        problems.push(`${index + 1}번 저장형 글에 번호 항목이 2개 미만`);
      }
    }
  });

  if (customerLanguageCount < 2) {
    problems.push('고객 언어 프로필의 실제 표현을 사용한 글이 2개 미만');
  }
  if (profileLinkCtaCount < writingProfile.minProfileLinkCtas) {
    problems.push(`프로필 링크 CTA가 ${writingProfile.minProfileLinkCtas}개 미만`);
  }
  return problems;
}

function campaignWritingProfile(config = {}) {
  return {
    maxLineLength: CAMPAIGN_MAX_LINE_LENGTH,
    requireQuestionCta: false,
    requireNumberedStructure: true,
    minParagraphs: 2,
    minZeroCommentLines: 3,
    requireCta: true,
    minProfileLinkCtas: 3,
    strictLineItems: true,
    ctaTemplates: CAMPAIGN_CTA_TEMPLATES[config.id],
  };
}

function campaignCustomerPatterns(config) {
  if (Array.isArray(config?.customer_language_patterns) && config.customer_language_patterns.length) {
    return config.customer_language_patterns.map((source) => new RegExp(source));
  }
  return CUSTOMER_LANGUAGE_PATTERNS;
}

function campaignForbiddenPhrases(config) {
  if (Array.isArray(config?.forbidden_phrases) && config.forbidden_phrases.length) {
    return config.forbidden_phrases;
  }
  return FORBIDDEN_CAMPAIGN_PHRASES;
}

async function generateDailyBatch(client, model, config, dateKey, performanceContext) {
  const outputShape = `각 글은 줄바꿈된 문자열 대신 아래 배열 필드로 작성한다.
- text_lines: 5~9개. 첫 항목은 관점 전환 후크, 중간에는 1., 2., 3. 번호 논리를 각각 한 줄의 완결 문장으로 넣고 마지막은 서로 다른 전환 CTA다.
- self_comment_0_lines: 3~8개.
- self_comment_6h_lines: 3~8개.
- 5개 중 3개 이상은 마지막 text_lines 항목에 "프로필 링크"를 넣는다. 나머지는 댓글 또는 답글을 자연스럽게 유도한다.
모든 항목은 60자 이내이며 마침표·물음표·느낌표 중 하나로 끝나는 자연스러운 완결 문장이다.
문장을 중간에서 자르거나 "3. 지금까지", "보완할" 같은 미완성 표현으로 끝내지 않는다.
항목에는 빈 문자열이나 줄바꿈을 넣지 않는다.`;
  const basePrompt = `작성일: ${dateKey}
캠페인 설명:
${config.campaign_context}

최근 실제 성과 신호:
${performanceContext || '- 아직 참고할 24시간 성과가 없음'}

성과 신호는 다음 글의 형식·주제·후크를 고르는 데만 사용한다.
조회수와 반응 수치를 본문의 성과 주장으로 옮기거나, 잘된 문장을 복제하지 않는다.

오늘의 5개 글이 하나의 작은 연재처럼 이어지되, 각각 단독으로 읽혀야 한다.
content_type은 problem, tip, backstage, template, sale을 각각 정확히 한 번 사용한다.

${outputShape}`;
  const customerPatterns = campaignCustomerPatterns(config);
  const writingProfile = campaignWritingProfile(config);
  let result = await createJson(
    client,
    model,
    dailySystemPrompt(config),
    basePrompt,
    DAILY_BATCH_SCHEMA,
  );
  let ordered = orderedDailyPosts(result, writingProfile);
  let voiceProblems = validateHumanVoiceBatch(ordered, customerPatterns, writingProfile);
  if (voiceProblems.length) {
    result = await createJson(
      client,
      model,
      dailySystemPrompt(config),
      `${basePrompt}

이전 결과가 사람냄새·고객언어 검수에서 실패했다. 아래 문제를 모두 고쳐 5개 전체를 다시 작성한다.
${voiceProblems.map((problem) => `- ${problem}`).join('\n')}`,
      DAILY_BATCH_SCHEMA,
    );
    ordered = orderedDailyPosts(result, writingProfile);
    voiceProblems = validateHumanVoiceBatch(ordered, customerPatterns, writingProfile);
  }
  if (voiceProblems.length) {
    throw new Error(`사람냄새·고객언어 검수 실패: ${voiceProblems.join(', ')}`);
  }
  const forbidden = campaignForbiddenPhrases(config).find((phrase) =>
    ordered.some((post) => [post.text, post.self_comment_0, post.self_comment_6h]
      .some((value) => String(value || '').includes(phrase))));
  if (forbidden) throw new Error(`금지된 캠페인 표현 감지: ${forbidden}`);

  return ordered.map((post) => ({
    ...post,
    text: post.text,
    self_comment_0: post.self_comment_0,
    self_comment_6h: post.self_comment_6h,
    search_queries: post.search_queries.map((query) => clampText(query, 60)).slice(0, 4),
  }));
}

async function loadConfigs(db, campaignId) {
  let query = db
    .from('threads_autopilot_config')
    .select('*')
    .eq('enabled', true);
  if (campaignId) {
    query = query.eq('id', campaignId);
  }
  const { data, error } = await query.order('id', { ascending: true });
  if (error) throw new Error(`Threads 자동화 설정 조회 실패: ${error.message}`);
  return data || [];
}

const TOKEN_REFRESH_THRESHOLD_MS = 15 * 86_400_000;

async function resolveCampaignToken(db, config, env) {
  if (!config.token_provider) {
    return required(env.THREADS_ACCESS_TOKEN, 'THREADS_ACCESS_TOKEN');
  }
  const { data, error } = await db
    .from('credentials')
    .select('*')
    .eq('provider', config.token_provider)
    .maybeSingle();
  if (error || !data?.access_token) {
    throw new Error(`credentials(provider='${config.token_provider}') 토큰을 읽지 못했습니다.`);
  }
  const nowMs = Date.now();
  const expiresAt = data.expires_at ? Date.parse(data.expires_at) : null;
  if (expiresAt && expiresAt <= nowMs) {
    throw new Error(`${config.token_provider} 토큰이 만료되었습니다. 수동 재발급이 필요합니다.`);
  }
  if (!expiresAt || expiresAt - nowMs >= TOKEN_REFRESH_THRESHOLD_MS) {
    return data.access_token;
  }
  try {
    const url = new URL('https://graph.threads.net/refresh_access_token');
    url.searchParams.set('grant_type', 'th_refresh_token');
    url.searchParams.set('access_token', data.access_token);
    const response = await fetch(url);
    const json = await response.json().catch(() => ({}));
    if (response.ok && json.access_token && Number(json.expires_in) > 0) {
      await db.from('credentials').update({
        access_token: json.access_token,
        expires_at: new Date(nowMs + Number(json.expires_in) * 1000).toISOString(),
        refreshed_at: new Date(nowMs).toISOString(),
      }).eq('provider', config.token_provider);
      return json.access_token;
    }
  } catch {
    // 갱신 실패해도 아직 유효한 토큰으로 계속 진행한다.
  }
  return data.access_token;
}

async function verifyCampaignAccount(token, config) {
  if (!config.profile_username) return;
  const profile = await graphRequest('/me', { token, params: { fields: 'id,username' } });
  const actual = String(profile.username || '').replace(/^@/, '').toLowerCase();
  const expected = String(config.profile_username).replace(/^@/, '').toLowerCase();
  if (actual !== expected) {
    throw new Error(`토큰 계정 불일치: @${profile.username} ≠ @${config.profile_username}`);
  }
}

async function loadRecentPerformanceContext(db, config) {
  const { data, error } = await db
    .from('threads_autopilot_posts')
    .select('content_type,text,metrics,published_at')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .not('metrics', 'is', null)
    .order('published_at', { ascending: false })
    .limit(30);
  if (error) return '';
  return buildPerformanceLearningContext(data || []);
}

export function shouldRegeneratePendingCampaign(config, posts) {
  if (!config?.id || posts.length !== 5 || posts.some((post) => post.status !== 'queued')) {
    return false;
  }
  const problems = validateHumanVoiceBatch(
    posts,
    campaignCustomerPatterns(config),
    campaignWritingProfile(),
  );
  const forbidden = campaignForbiddenPhrases(config).some((phrase) =>
    posts.some((post) => [post.text, post.self_comment_0, post.self_comment_6h]
      .some((value) => String(value || '').includes(phrase))));
  return problems.length > 0 || forbidden;
}

export function publishTimesForCampaign(config = {}) {
  if (Array.isArray(config.publish_times) && config.publish_times.length === 5) {
    return config.publish_times;
  }
  return CAMPAIGN_SLOTS[config.id] || DEFAULT_SLOTS;
}

async function ensureDailyBatch({ db, client, model, config, now }) {
  const timezone = config.timezone || 'Asia/Seoul';
  const dateKey = dateKeyInTimeZone(now, timezone);
  if (config.start_date && dateKey < config.start_date) return [];

  const slots = publishTimesForCampaign(config);
  const { data: existingData, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('schedule_date', dateKey)
    .order('slot_index', { ascending: true });
  if (error) throw new Error(`오늘의 스레드 조회 실패: ${error.message}`);

  let existing = existingData || [];
  if (shouldRegeneratePendingCampaign(config, existing)) {
    const { error: deleteError } = await db
      .from('threads_autopilot_posts')
      .delete()
      .eq('campaign_id', config.id)
      .eq('schedule_date', dateKey)
      .eq('status', 'queued');
    if (deleteError) throw new Error(`예약글 교체 실패: ${deleteError.message}`);
    existing = [];
  }
  const invalidQueued = existing.filter((post) => {
    if (post.status !== 'queued') return false;
    const validationProblems = validatePublishReadyPost(post, campaignWritingProfile());
    const forbidden = campaignForbiddenPhrases(config).some((phrase) =>
      [post.text, post.self_comment_0, post.self_comment_6h]
        .some((value) => String(value || '').includes(phrase)));
    const expectedAt = zonedDateTimeToUtc(
      dateKey,
      slots[Number(post.slot_index)],
      timezone,
    ).toISOString();
    const scheduledAt = new Date(post.scheduled_at).toISOString();
    return validationProblems.length > 0 || forbidden || scheduledAt !== expectedAt;
  });
  if (invalidQueued.length) {
    const invalidIds = invalidQueued.map((post) => post.id);
    const { error: deleteError } = await db
      .from('threads_autopilot_posts')
      .delete()
      .in('id', invalidIds);
    if (deleteError) throw new Error(`불완전 예약글 교체 실패: ${deleteError.message}`);
    const invalidSet = new Set(invalidIds);
    existing = existing.filter((post) => !invalidSet.has(post.id));
  }
  if (existing.length === slots.length) return existing;

  const performanceContext = await loadRecentPerformanceContext(db, config);
  const generated = await generateDailyBatch(
    client,
    model,
    config,
    dateKey,
    performanceContext,
  );
  const existingRows = existing;
  const existingSlots = new Set(existingRows.map((row) => row.slot_index));
  const baseSequence = existingRows.length
    ? Math.min(...existingRows.map((row) => Number(row.sequence) - Number(row.slot_index)))
    : Number(config.next_sequence || 1);
  const rows = generated
    .map((post, index) => {
      const scheduledAt = zonedDateTimeToUtc(dateKey, slots[index], timezone);
      const missed = scheduledAt.getTime() < now.getTime() - MISSED_SLOT_GRACE_MINUTES * 60_000;
      return {
        id: crypto.randomUUID(),
        campaign_id: config.id,
        sequence: baseSequence + index,
        schedule_date: dateKey,
        slot_index: index,
        scheduled_at: scheduledAt.toISOString(),
        content_type: post.content_type,
        text: post.text,
        self_comment_0: post.self_comment_0,
        self_comment_6h: post.self_comment_6h,
        search_queries: post.search_queries,
        status: missed ? 'skipped' : 'queued',
        last_error: missed ? 'schedule: 지난 게시 시간은 늦게 재발행하지 않고 건너뜀' : null,
      };
    })
    .filter((row) => !existingSlots.has(row.slot_index));

  if (rows.length) {
    const { error: insertError } = await db.from('threads_autopilot_posts').insert(rows);
    if (insertError) throw new Error(`오늘의 스레드 저장 실패: ${insertError.message}`);
  }
  const highestSequence = Math.max(baseSequence + slots.length, Number(config.next_sequence || 1));
  const { error: configError } = await db
    .from('threads_autopilot_config')
    .update({ next_sequence: highestSequence, last_generated_date: dateKey, updated_at: now.toISOString() })
    .eq('id', config.id);
  if (configError) throw new Error(`스레드 순번 저장 실패: ${configError.message}`);

  const { data: completed } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('schedule_date', dateKey)
    .order('slot_index', { ascending: true });
  return completed || [];
}

async function processTwentyFourHour({ db, token, config, now, limit = 5 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('twenty_four_done_at', null)
    .lte('twenty_four_due_at', now.toISOString())
    .order('twenty_four_due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`24시간 작업 조회 실패: ${error.message}`);
  let completed = 0;
  for (const post of posts || []) {
    try {
      const metrics = await getPostInsights(token, post.thread_id);
      const { data: nextPost } = await db
        .from('threads_autopilot_posts')
        .select('id,sequence,text,scheduled_at,status')
        .eq('campaign_id', config.id)
        .eq('sequence', Number(post.sequence) + 5)
        .maybeSingle();
      const { error: updateError } = await db.from('threads_autopilot_posts').update({
        metrics,
        performance_comment: null,
        performance_comment_id: null,
        twenty_four_done_at: now.toISOString(),
        next_post_id: nextPost?.id || null,
        last_error: clearStageError(post.last_error, ['24h:']),
      }).eq('id', post.id);
      if (updateError) throw new Error(`24시간 성과 저장 실패: ${updateError.message}`);
      completed += 1;
    } catch (err) {
      await db.from('threads_autopilot_posts')
        .update({ last_error: `24h: ${err.message}` })
        .eq('id', post.id);
    }
  }
  return completed;
}

async function processPublishing({
  db,
  token,
  config,
  now,
  allowExternalComments,
  limit = 5,
}) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'queued')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`발행 대기 글 조회 실패: ${error.message}`);
  let completed = 0;
  for (const post of posts || []) {
    let publishedThreadId = null;
    try {
      const publishProblems = validatePublishReadyPost(post, campaignWritingProfile());
      const forbidden = campaignForbiddenPhrases(config).find((phrase) =>
        [post.text, post.self_comment_0, post.self_comment_6h]
          .some((value) => String(value || '').includes(phrase)));
      if (forbidden) {
        publishProblems.push(`금지된 캠페인 표현 "${forbidden}" 사용`);
      }
      if (publishProblems.length) {
        const { error: validationStateError } = await db
          .from('threads_autopilot_posts')
          .update({
            attempts: Number(post.attempts || 0) + 1,
            status: 'failed',
            last_error: `validation: ${publishProblems.join(', ')}`,
          })
          .eq('id', post.id);
        if (validationStateError) {
          throw new Error(`발행 차단 상태 저장 실패: ${validationStateError.message}`);
        }
        continue;
      }
      const threadId = await publishText(token, post.text);
      publishedThreadId = threadId;
      const details = await getPostDetails(token, threadId).catch(() => ({ permalink: null }));
      const publishedAt = new Date();
      const { error: publishStateError } = await db.from('threads_autopilot_posts').update({
        status: 'published',
        thread_id: threadId,
        permalink: details.permalink || null,
        published_at: publishedAt.toISOString(),
        external_due_at: allowExternalComments ? addMinutes(publishedAt, 5).toISOString() : null,
        external_done_at: allowExternalComments ? null : publishedAt.toISOString(),
        reply_due_at: addMinutes(publishedAt, 5).toISOString(),
        reply_done_at: null,
        six_hour_due_at: addMinutes(publishedAt, 360).toISOString(),
        twenty_four_due_at: addMinutes(publishedAt, 1440).toISOString(),
        last_error: null,
      }).eq('id', post.id);
      if (publishStateError) {
        throw new Error(`발행 상태 저장 실패: ${publishStateError.message}`);
      }
      completed += 1;
    } catch (err) {
      await db.from('threads_autopilot_posts').update({
        attempts: Number(post.attempts || 0) + 1,
        status: publishedThreadId || Number(post.attempts || 0) >= 2 ? 'failed' : 'queued',
        last_error: publishedThreadId
          ? `publish-state: Threads 게시 성공(${publishedThreadId}), DB 상태 저장 실패 — 중복 방지를 위해 자동 재발행 중지: ${err.message}`
          : `publish: ${err.message}`,
      }).eq('id', post.id);
    }
  }
  return completed;
}

async function processZeroComments({ db, token, config, limit = 5 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('zero_comment_id', null)
    .order('published_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`0분 셀프 댓글 조회 실패: ${error.message}`);
  let completed = 0;
  for (const post of posts || []) {
    try {
      const problems = validateCommentReady(post.self_comment_0, {
        label: '첫 댓글',
        maxLineLength: CAMPAIGN_MAX_LINE_LENGTH,
      });
      if (problems.length) {
        const { error: validationStateError } = await db
          .from('threads_autopilot_posts')
          .update({ last_error: `0m-validation: ${problems.join(', ')}` })
          .eq('id', post.id);
        if (validationStateError) {
          throw new Error(`첫 댓글 차단 상태 저장 실패: ${validationStateError.message}`);
        }
        continue;
      }
      const zeroCommentId = await publishText(token, post.self_comment_0, post.thread_id);
      await db.from('threads_autopilot_posts').update({
        zero_comment_id: zeroCommentId,
        last_error: clearStageError(post.last_error, ['0m:', '0m-validation:']),
      }).eq('id', post.id);
      completed += 1;
    } catch (err) {
      await db.from('threads_autopilot_posts')
        .update({ last_error: `0m: ${err.message}` })
        .eq('id', post.id);
    }
  }
  return completed;
}

async function collectExternalCandidates({ db, token, post, config }) {
  const profileUsername = config.profile_username;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: previous } = await db
    .from('threads_autopilot_interactions')
    .select('target_thread_id')
    .eq('campaign_id', config.id)
    .eq('interaction_type', 'external_comment')
    .gte('created_at', weekAgo);
  const used = new Set((previous || []).map((row) => row.target_thread_id));
  const authors = new Set();
  const candidates = [];
  for (const query of post.search_queries || []) {
    const results = await searchThreads(token, query);
    for (const item of results) {
      const username = String(item.username || '').replace(/^@/, '').toLowerCase();
      if (!item.id || !item.text || used.has(item.id)) continue;
      if (username === String(profileUsername || '').replace(/^@/, '').toLowerCase()) continue;
      if (authors.has(username)) continue;
      authors.add(username);
      candidates.push({
        id: String(item.id),
        username: item.username || '',
        text: clampText(item.text, 700),
        permalink: item.permalink || null,
      });
      if (candidates.length >= 12) return candidates;
    }
  }
  return candidates;
}

async function generateExternalComments(client, model, post, candidates, requiredCount) {
  if (!candidates.length || requiredCount < 1) return [];
  const system = `너는 한국어 Threads에서 진짜 대화를 시작하는 댓글 작성자다.
다른 사람의 글을 정확히 읽고, 그 글의 구체적인 내용에 연결되는 댓글을 쓴다.
각 댓글은 1~3문장, 180자 이하로 쓴다.
광고·상품 링크·자기소개·복사한 문구·"좋은 글이네요"·"공감합니다"만 있는 댓글은 금지한다.
원문에 없는 사실을 지어내지 않는다.
서로 다른 작성자의 글 중 정확히 ${requiredCount}개를 골라 댓글을 쓴다.
JSON 스키마 외의 말은 출력하지 않는다.`;
  const prompt = `내가 방금 올린 글:
${post.text}

댓글 후보:
${candidates.map((item) => `[${item.id}] @${item.username}\n${item.text}`).join('\n\n')}`;
  const result = await createJson(client, model, system, prompt, EXTERNAL_COMMENT_SCHEMA, 5000);
  const allowed = new Set(candidates.map((item) => item.id));
  const comments = (result.comments || [])
    .filter((item) => allowed.has(String(item.target_id)))
    .filter((item, index, array) =>
      array.findIndex((candidate) => String(candidate.target_id) === String(item.target_id)) === index)
    .slice(0, requiredCount)
    .map((item) => ({ target_id: String(item.target_id), text: clampText(item.text, 300) }));
  if (comments.length !== requiredCount) {
    throw new Error(`AI가 외부 댓글을 ${comments.length}/${requiredCount}개만 작성했습니다.`);
  }
  const promotional = comments.find((item) =>
    /(https?:\/\/|groble|프로필\s*링크|19\s*,?\s*900|39\s*,?\s*900|지원핏|자기소개서\s*워크북)/i.test(item.text));
  if (promotional) {
    throw new Error('외부 댓글에 링크 또는 상품 홍보 문구가 감지되었습니다.');
  }
  return comments;
}

async function processExternalComments({ db, token, client, model, config, now, limit = 2 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('external_done_at', null)
    .lte('external_due_at', now.toISOString())
    .order('external_due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`외부 댓글 작업 조회 실패: ${error.message}`);
  let completed = 0;
  const diagnostics = [];
  for (const post of posts || []) {
    try {
      const { count: existingCount, error: countError } = await db
        .from('threads_autopilot_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('source_post_id', post.id)
        .eq('interaction_type', 'external_comment');
      if (countError) throw new Error(`외부 댓글 수 조회 실패: ${countError.message}`);
      const alreadyPosted = Number(existingCount || 0);
      if (alreadyPosted >= 5) {
        const { error: updateError } = await db.from('threads_autopilot_posts').update({
          external_comment_count: alreadyPosted,
          external_done_at: now.toISOString(),
          last_error: clearStageError(post.last_error, ['external:', '외부 댓글 ']),
        }).eq('id', post.id);
        if (updateError) throw new Error(`외부 댓글 완료 상태 저장 실패: ${updateError.message}`);
        diagnostics.push({ sequence: post.sequence, status: 'completed', count: alreadyPosted });
        completed += 1;
        continue;
      }
      const remaining = 5 - alreadyPosted;
      const candidates = await collectExternalCandidates({ db, token, post, config });
      if (candidates.length < remaining) {
        const message = `외부 댓글 ${alreadyPosted}/5개: 적합한 공개 글을 더 찾는 중`;
        const { error: updateError } = await db.from('threads_autopilot_posts').update({
          external_comment_count: alreadyPosted,
          last_error: message,
        }).eq('id', post.id);
        if (updateError) throw new Error(`외부 댓글 대기 상태 저장 실패: ${updateError.message}`);
        diagnostics.push({
          sequence: post.sequence,
          status: 'pending',
          count: alreadyPosted,
          candidates: candidates.length,
          reason: message,
        });
        continue;
      }
      const candidateMap = new Map(candidates.map((item) => [item.id, item]));
      const comments = await generateExternalComments(client, model, post, candidates, remaining);
      let posted = 0;
      for (const comment of comments) {
        const replyId = await publishText(token, comment.text, comment.target_id);
        const target = candidateMap.get(comment.target_id);
        await db.from('threads_autopilot_interactions').insert({
          campaign_id: config.id,
          source_post_id: post.id,
          interaction_type: 'external_comment',
          target_thread_id: comment.target_id,
          target_username: target?.username || null,
          target_permalink: target?.permalink || null,
          response_thread_id: replyId,
          response_text: comment.text,
        });
        posted += 1;
      }
      const totalPosted = alreadyPosted + posted;
      const { error: updateError } = await db.from('threads_autopilot_posts').update({
        external_comment_count: totalPosted,
        external_done_at: totalPosted >= 5 ? now.toISOString() : null,
        last_error: totalPosted >= 5
          ? clearStageError(post.last_error, ['external:', '외부 댓글 '])
          : `외부 댓글 ${totalPosted}/5개: 나머지 재시도`,
      }).eq('id', post.id);
      if (updateError) throw new Error(`외부 댓글 처리 상태 저장 실패: ${updateError.message}`);
      diagnostics.push({
        sequence: post.sequence,
        status: totalPosted >= 5 ? 'completed' : 'pending',
        count: totalPosted,
        candidates: candidates.length,
      });
      if (totalPosted >= 5) completed += 1;
    } catch (err) {
      const { count } = await db
        .from('threads_autopilot_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('source_post_id', post.id)
        .eq('interaction_type', 'external_comment');
      const { error: updateError } = await db.from('threads_autopilot_posts')
        .update({
          external_comment_count: Number(count || 0),
          last_error: `external: ${err.message}`,
        })
        .eq('id', post.id);
      diagnostics.push({
        sequence: post.sequence,
        status: 'error',
        count: Number(count || 0),
        reason: err.message,
        update_error: updateError?.message || null,
      });
    }
  }
  return {
    selected: (posts || []).length,
    completed,
    diagnostics,
  };
}

async function skipExternalComments({ db, config, now, limit = 50 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('id,sequence,last_error')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('external_done_at', null)
    .lte('external_due_at', now.toISOString())
    .order('external_due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`외부 댓글 건너뛰기 조회 실패: ${error.message}`);

  const diagnostics = [];
  for (const post of posts || []) {
    const { error: updateError } = await db.from('threads_autopilot_posts').update({
      external_done_at: now.toISOString(),
      last_error: clearStageError(post.last_error, ['external:', '외부 댓글 ']),
    }).eq('id', post.id);
    if (updateError) throw new Error(`외부 댓글 건너뛰기 저장 실패: ${updateError.message}`);
    diagnostics.push({ sequence: post.sequence, status: 'skipped_permission' });
  }

  return {
    enabled: false,
    skipped: (posts || []).length,
    reason: 'threads_keyword_search 권한 승인 전까지 비활성화',
    diagnostics,
  };
}

async function generateConversationReplies(client, model, post, incoming, config) {
  if (!incoming.length) return [];
  const system = config?.reply_system_prompt || `너는 @ai_crazy_lab_1201 계정의 답글 담당자다.
상대의 질문이나 의견을 구체적으로 받아서 자연스러운 한국어로 답한다.
1~3문장, 250자 이하로 쓴다. 확인되지 않은 사실이나 성과를 만들지 않는다.
모르는 내용은 추측하지 말고 확인이 필요하다고 말한다.
상품 질문에는 다음 사실만 사용한다: 복붙 없이 완성하는 AI 자기소개서, 19,900원,
37쪽 PDF + 편집 DOCX + ChatGPT GPT 5개 + Gemini Gem 5개 + QR·하이퍼링크 + HR 교차검증,
https://www.groble.im/products/KfVDLC
JSON 스키마 외의 말은 출력하지 않는다.`;
  const prompt = `원문:
${post.text}

새 답글:
${incoming.map((item) => `[${item.id}] @${item.username}\n${item.text}`).join('\n\n')}`;
  const result = await createJson(client, model, system, prompt, REPLY_SCHEMA, 4000);
  const allowed = new Set(incoming.map((item) => item.id));
  return (result.replies || [])
    .filter((item) => allowed.has(String(item.target_id)))
    .map((item) => ({ target_id: String(item.target_id), text: clampText(item.text, 300) }));
}

async function closeExpiredReplyWindows({ db, config, now, windowStart, limit = 50 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('id,last_error')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('reply_done_at', null)
    .lt('published_at', windowStart.toISOString())
    .order('published_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`답글 감시 종료 조회 실패: ${error.message}`);

  for (const post of posts || []) {
    const { error: updateError } = await db.from('threads_autopilot_posts').update({
      reply_done_at: now.toISOString(),
      last_error: clearStageError(post.last_error, ['reply:']),
    }).eq('id', post.id);
    if (updateError) throw new Error(`답글 감시 종료 저장 실패: ${updateError.message}`);
  }
  return (posts || []).length;
}

async function processContinuousReplies({
  db,
  token,
  client,
  model,
  config,
  now,
  limit = 10,
}) {
  const windowStart = addMinutes(now, -REPLY_MONITOR_WINDOW_MINUTES);
  const closed = await closeExpiredReplyWindows({ db, config, now, windowStart });
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .gte('published_at', windowStart.toISOString())
    .lte('reply_due_at', now.toISOString())
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`지속 답글 작업 조회 실패: ${error.message}`);

  let replied = 0;
  let held = 0;
  const diagnostics = [];
  for (const post of posts || []) {
    try {
      const conversation = await getConversation(token, post.thread_id);
      const { data: previous } = await db
        .from('threads_autopilot_interactions')
        .select('target_thread_id')
        .eq('source_post_id', post.id)
        .eq('interaction_type', 'inbound_reply');
      const used = new Set((previous || []).map((row) => row.target_thread_id));
      const incoming = conversation
        .filter((item) => !item.is_reply_owned_by_me && item.id && item.text && !used.has(item.id))
        .slice(0, 20);

      const safeIncoming = [];
      const incomingMap = new Map(incoming.map((item) => [String(item.id), item]));
      for (const item of incoming) {
        const classification = classifyInboundReply(item.text);
        if (classification.autoReply) {
          safeIncoming.push(item);
          continue;
        }
        const { error: holdError } = await db.from('threads_autopilot_interactions').insert({
          campaign_id: config.id,
          source_post_id: post.id,
          interaction_type: 'inbound_reply',
          target_thread_id: item.id,
          target_username: item.username || null,
          target_permalink: item.permalink || null,
          response_thread_id: null,
          response_text: `[자동답변 보류] ${classification.reason}`,
        });
        if (holdError) throw new Error(`민감 댓글 보류 저장 실패: ${holdError.message}`);
        held += 1;
      }

      const replies = await generateConversationReplies(
        client,
        model,
        post,
        safeIncoming,
        config,
      );
      let postedForPost = 0;
      for (const reply of replies) {
        const responseId = await publishText(token, reply.text, reply.target_id);
        const source = incomingMap.get(reply.target_id);
        const { error: insertError } = await db.from('threads_autopilot_interactions').insert({
          campaign_id: config.id,
          source_post_id: post.id,
          interaction_type: 'inbound_reply',
          target_thread_id: reply.target_id,
          target_username: source?.username || null,
          target_permalink: source?.permalink || null,
          response_thread_id: responseId,
          response_text: reply.text,
        });
        if (insertError) throw new Error(`답글 기록 저장 실패: ${insertError.message}`);
        postedForPost += 1;
        replied += 1;
      }

      const { count: replyCount, error: countError } = await db
        .from('threads_autopilot_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('source_post_id', post.id)
        .eq('interaction_type', 'inbound_reply')
        .not('response_thread_id', 'is', null);
      if (countError) throw new Error(`누적 답글 수 조회 실패: ${countError.message}`);

      const nextIntervalMinutes = replyCheckIntervalMinutes(post.published_at, now);
      const nextReplyState = nextIntervalMinutes === null
        ? {
            reply_due_at: null,
            reply_done_at: now.toISOString(),
          }
        : {
            reply_due_at: addMinutes(now, nextIntervalMinutes).toISOString(),
          };
      const { error: updateError } = await db.from('threads_autopilot_posts').update({
        reply_count: Number(replyCount || 0),
        ...nextReplyState,
        last_error: clearStageError(post.last_error, ['reply:']),
      }).eq('id', post.id);
      if (updateError) throw new Error(`다음 댓글 확인 시각 저장 실패: ${updateError.message}`);
      diagnostics.push({
        sequence: post.sequence,
        incoming: incoming.length,
        replied: postedForPost,
        held: incoming.length - safeIncoming.length,
        nextCheckMinutes: nextIntervalMinutes,
      });
    } catch (err) {
      await db.from('threads_autopilot_posts')
        .update({ last_error: `reply: ${err.message}` })
        .eq('id', post.id);
      diagnostics.push({ sequence: post.sequence, error: err.message });
    }
  }
  return {
    selected: (posts || []).length,
    replied,
    held,
    closed,
    windowHours: REPLY_MONITOR_WINDOW_MINUTES / 60,
    diagnostics,
  };
}

async function processSixHour({ db, token, config, now, limit = 5 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('six_hour_done_at', null)
    .lte('six_hour_due_at', now.toISOString())
    .order('six_hour_due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`6시간 작업 조회 실패: ${error.message}`);
  let completed = 0;
  for (const post of posts || []) {
    try {
      const problems = validateCommentReady(post.self_comment_6h, {
        label: '6시간 댓글',
        maxLineLength: CAMPAIGN_MAX_LINE_LENGTH,
      });
      if (problems.length) {
        const { error: validationStateError } = await db
          .from('threads_autopilot_posts')
          .update({ last_error: `6h-validation: ${problems.join(', ')}` })
          .eq('id', post.id);
        if (validationStateError) {
          throw new Error(`6시간 댓글 차단 상태 저장 실패: ${validationStateError.message}`);
        }
        continue;
      }
      const commentId = await publishText(token, post.self_comment_6h, post.thread_id);
      await db.from('threads_autopilot_posts').update({
        six_hour_comment_id: commentId,
        six_hour_done_at: now.toISOString(),
        last_error: clearStageError(post.last_error, ['6h:', '6h-validation:']),
      }).eq('id', post.id);
      completed += 1;
    } catch (err) {
      await db.from('threads_autopilot_posts')
        .update({ last_error: `6h: ${err.message}` })
        .eq('id', post.id);
    }
  }
  return completed;
}

export async function runThreadsAutopilot({
  db,
  now = new Date(),
  env = process.env,
  campaignId = null,
}) {
  const configs = await loadConfigs(db, campaignId);
  if (!configs.length) return { ok: true, enabled: false, reason: 'config_missing_or_disabled' };

  const apiKey = required(env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY');
  const model = env.THREADS_AI_MODEL || 'claude-sonnet-4-6';
  const client = new Anthropic({ apiKey });

  const campaigns = {};
  for (const config of configs) {
    try {
      const token = await resolveCampaignToken(db, config, env);
      await verifyCampaignAccount(token, config);
      let generationError = null;
      try {
        await ensureDailyBatch({ db, client, model, config, now });
      } catch (err) {
        generationError = err?.message || String(err);
      }
      const allowExternalComments = externalCommentsEnabled(env);
      const published = await processPublishing({
        db,
        token,
        config,
        now,
        allowExternalComments,
      });
      const zeroMinuteComments = await processZeroComments({ db, token, config });
      const externalComments = allowExternalComments
        ? await processExternalComments({ db, token, client, model, config, now })
        : await skipExternalComments({ db, config, now });
      const replyMonitoring = await processContinuousReplies({
        db,
        token,
        client,
        model,
        config,
        now,
      });
      campaigns[config.id] = {
        ok: !generationError,
        ...(generationError ? { error: generationError } : {}),
        published,
        zeroMinuteComments,
        externalComments,
        fifteenMinuteReplies: replyMonitoring.replied,
        replyMonitoring,
        sixHourComments: await processSixHour({ db, token, config, now }),
        twentyFourHourComments: await processTwentyFourHour({ db, token, config, now }),
      };
    } catch (err) {
      campaigns[config.id] = { ok: false, error: err?.message || String(err) };
    }
  }
  const failed = Object.values(campaigns).filter((item) => !item.ok).length;
  return { ok: failed < configs.length, enabled: true, campaigns };
}
