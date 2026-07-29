import Anthropic from '@anthropic-ai/sdk';

const GRAPH_BASE = 'https://graph.threads.net/v1.0';
const DEFAULT_SLOTS = ['08:30', '11:30', '14:30', '18:30', '21:30'];
const POST_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];
const DAILY_CONTENT_TYPES = ['problem', 'tip', 'backstage', 'template', 'sale'];
const MAX_CONTENT_LINE_LENGTH = 10;
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
          text: { type: 'string' },
          self_comment_0: { type: 'string' },
          self_comment_6h: { type: 'string' },
          search_queries: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['content_type', 'text', 'self_comment_0', 'self_comment_6h', 'search_queries'],
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

export function buildPerformanceComment(metrics, nextPost) {
  const rows = [
    '24시간 기록',
    `조회 ${metrics.views || 0} · 좋아요 ${metrics.likes || 0} · 답글 ${metrics.replies || 0}`,
    `재게시 ${metrics.reposts || 0} · 인용 ${metrics.quotes || 0} · 공유 ${metrics.shares || 0}`,
  ];
  if (nextPost?.text) rows.push('', `다음 글: ${firstLine(nextPost.text)}`);
  return clampText(rows.join('\n'), 480);
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
      hook: firstLine(post.text, MAX_CONTENT_LINE_LENGTH),
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
  const data = await graphRequest('/me/threads', {
    token,
    method: 'POST',
    params: {
      media_type: 'TEXT',
      text: clampText(text),
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
  if (config?.system_prompt) return config.system_prompt;
  return `너는 @ai_crazy_lab_1201의 Threads 자동 편집장이다.
계정 포지션은 "AI 취업서류 실험실"이다.
모르는 취업 준비생에게 자기소개서 작성과 검증에 바로 쓰이는 내용을, 취업 강사가 작업실에서 오늘 확인한 오류와 수정법을 보고하듯 공개한다.
이 계정은 자기소개서·취업서류라는 한 주제만 다룬다. 갑자기 다른 주제나 유행을 끼워 넣지 않는다.

글쓰기의 최우선 목표는 "잘 정리된 AI 글"이 아니라 독자가 "내 얘기다"라고 느끼는 글이다.
사람냄새는 맞춤법을 일부러 틀리는 것이 아니다. 실제 장면, 망설임, 손해, 모순, 판단 변화를 보여주는 것이다.

고객 언어 프로필:
- "AI가 쓴 티가 나요"
- "문장은 그럴듯한데 내 얘기 같지 않아요"
- "경험이 별로 없는 것 같아요"
- "뭘 먼저 넣어야 할지 모르겠어요"
- "회사 정보를 지어낼까 봐 불안해요"

위 표현은 특정 개인의 말투를 복제하기 위한 것이 아니다.
고객들이 반복해서 겪는 상황과 두려움을 이해하는 참고 자료로만 사용하고, 문장은 새로 쓴다.
참고 글은 첫 줄·전개·목록·질문 같은 구조만 학습한다. 문구, 사례, 숫자는 베끼지 않는다.

매일 정확히 5개 글을 쓴다.
1) 문제 발견·오해 깨기 2) 바로 쓰는 질문·체크리스트 3) 자기소개서 항목 하나 깊이 보기 4) AI 결과 검증·회사 조사·개인정보 5) 하루 정리와 자연스러운 판매 연결.

5개 콘텐츠 형식:
- problem: 경고·오해 깨기형 정보 글
- tip: 저장할 수 있는 질문·체크리스트형 정보 글
- backstage: 실제 작업 과정과 판단 변화를 보여주는 일상·빌드인퍼블릭 글
- template: 독자가 바로 바꿔 쓸 수 있는 구조·예시형 정보 글
- sale: 후크 → 문제 → 해결법 → 상품 연결 순서의 구매 글
- 모집·DB 수집용 프로모션은 개인정보 동의와 별도 승인 없이는 만들지 않는다.

모든 글은 SSA 흐름을 따른다.
- Stop: 첫 줄에서 결과·실패·반전·고백으로 멈추게 한다.
- Save: 본문이나 첫 셀프 댓글에 오늘 적용할 기준·질문·체크리스트를 준다.
- Act: 본문 마지막에 맥락에 맞는 질문 하나만 둔다.

규칙:
- 각 본문은 430자 안쪽, 비어 있지 않은 5~10줄로 쓴다.
- 띄어쓰기와 문장부호를 포함해 모든 줄을 10자 이내로 쓴다.
- 단어 중간에서 줄을 자르지 말고, 한 줄에 완결된 문장이나 구를 둔다.
- 본문은 정확히 3문단으로 나눈다. 첫 줄만 1문단, 상황·차이를 2문단, 판단·행동·질문을 3문단에 둔다.
- 첫 줄 뒤와 2·3문단 사이에는 빈 줄을 하나씩 둔다. 빈 줄은 5~10줄 계산에서 제외한다.
- 본문 마지막 줄은 이 글의 경험과 연결된 질문형 CTA 하나로 끝낸다.
- 첫 문장은 결과·실패·반전·고백 중 하나로 10자 이내에 구체적으로 쓴다.
- 본문은 구체적인 상황 → 예상과 실제의 차이 → 다음 행동이 달라지는 판단 순서로 쓴다.
- 감정 형용사로 설명하지 말고 그 감정을 만든 행동이나 장면을 보여준다.
- 5개 중 최소 2개에는 고객 언어의 핵심 표현을 짧고 자연스럽게 사용한다.
- 최소 1개에는 AI나 상품이 해결하지 못하는 한계를 솔직하게 쓴다.
- 작성자가 실제로 겪었다고 입력되지 않은 사건을 1인칭 경험으로 만들지 않는다.
- 사례를 만들 필요가 있으면 반드시 "가상 예시"라고 밝힌다.
- 조언만 나열하지 말고 독자가 오늘 바로 확인할 한 장면이나 문장을 넣는다.
- tip과 template은 본문 또는 self_comment_0에 1., 2. 형식의 항목을 최소 2개 넣는다.
- CTA는 self_comment가 아니라 본문에서 다룬 경험을 묻고, 모든 글에 같은 질문을 붙이지 않는다.
- 72시간, 100만원, 무명계정 도전, 매출실험, 기관 AI 강의 수주 표현을 사용하지 않는다.
- 확인되지 않은 숫자·성과·합격·계약을 만들지 않는다.
- 본문 5개가 같은 훅이나 설명을 반복하지 않는다.
- 판매글은 하루 1개만 허용하고, 나머지 4개는 가치 제공에 집중한다.
- 상품은 "복붙 없이 완성하는 AI 자기소개서", 가격은 19,900원이다.
- 상품 구성은 37쪽 PDF 워크북, 편집 가능한 DOCX, ChatGPT GPT 5개, Gemini Gem 5개, QR·하이퍼링크, HR 관점 교차검증이다.
- 구매 링크는 https://www.groble.im/products/KfVDLC 이다.
- 합격·서류통과·취업을 보장하지 않는다.
- 본문과 셀프 댓글에 URL을 직접 쓰지 않는다. 판매글도 필요하면 "프로필 링크"라고만 쓴다.
- self_comment_0은 본문에 없는 구체적 예시나 체크리스트를 5~10줄로 추가한다.
- self_comment_6h는 6시간 뒤 붙일 실전 보충 정보를 3~10줄로 쓴다.
- 두 셀프 댓글도 모든 줄을 10자 이내로 쓰고, CTA를 추가하지 않는다.
- search_queries는 다른 사람의 취업·자기소개서·면접·AI 활용 글을 찾는 짧은 한국어 검색어 2~4개다.
- "많은 분들이", "요즘 시대에는", "도움이 되셨다면" 같은 범용 카피를 쓰지 않는다.
- 링크, 해시태그, 이모지, 과장, 공포 마케팅, 영혼 없는 공감 문구를 금지한다.
JSON 스키마 외의 말은 출력하지 않는다.`;
}

function orderedDailyPosts(result) {
  if (!Array.isArray(result.posts) || result.posts.length !== 5) {
    throw new Error('AI가 하루치 글 5개를 반환하지 않았습니다.');
  }
  const byType = new Map(result.posts.map((post) => [post.content_type, post]));
  if (byType.size !== DAILY_CONTENT_TYPES.length
      || DAILY_CONTENT_TYPES.some((type) => !byType.has(type))) {
    throw new Error('하루치 콘텐츠 유형이 problem/tip/backstage/template/sale 각 1개가 아닙니다.');
  }
  return DAILY_CONTENT_TYPES.map((type) => byType.get(type));
}

export function validateHumanVoiceBatch(posts, customerPatterns = CUSTOMER_LANGUAGE_PATTERNS) {
  const problems = [];
  const hooks = new Set();
  let customerLanguageCount = 0;

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

    if (text.length > 430) problems.push(`${index + 1}번 본문이 430자를 넘음`);
    if (paragraphs.length < 3) problems.push(`${index + 1}번 본문이 3문단 미만`);
    if (lines.length < 5 || lines.length > 10) {
      problems.push(`${index + 1}번 본문이 5~10줄이 아님`);
    }
    if (!/^[^\n]+\n\s*\n/.test(text)) {
      problems.push(`${index + 1}번 첫 줄 뒤 빈 줄이 없음`);
    }
    const longBodyLine = lines.find((line) => line.length > MAX_CONTENT_LINE_LENGTH);
    if (longBodyLine) {
      problems.push(`${index + 1}번 본문에 10자를 넘는 줄 "${longBodyLine}" 사용`);
    }
    if (zeroLines.length < 5 || zeroLines.length > 10) {
      problems.push(`${index + 1}번 첫 댓글이 5~10줄이 아님`);
    }
    if (sixHourLines.length < 3 || sixHourLines.length > 10) {
      problems.push(`${index + 1}번 6시간 댓글이 3~10줄이 아님`);
    }
    const longCommentLine = [...zeroLines, ...sixHourLines]
      .find((line) => line.length > MAX_CONTENT_LINE_LENGTH);
    if (longCommentLine) {
      problems.push(`${index + 1}번 셀프 댓글에 10자를 넘는 줄 "${longCommentLine}" 사용`);
    }
    const questionCount = (text.match(/[?？]/g) || []).length;
    if (questionCount !== 1 || !/[?？]$/.test(lastLine)) {
      problems.push(`${index + 1}번 CTA가 본문 마지막 질문 하나가 아님`);
    }
    if (LINK_OR_HASHTAG_PATTERN.test(allCopy)) {
      problems.push(`${index + 1}번에 링크 또는 해시태그 사용`);
    }
    if (EMOJI_PATTERN.test(allCopy)) {
      problems.push(`${index + 1}번에 이모지 사용`);
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
  return problems;
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
  const basePrompt = `작성일: ${dateKey}
캠페인 설명:
${config.campaign_context}

최근 실제 성과 신호:
${performanceContext || '- 아직 참고할 24시간 성과가 없음'}

성과 신호는 다음 글의 형식·주제·후크를 고르는 데만 사용한다.
조회수와 반응 수치를 본문의 성과 주장으로 옮기거나, 잘된 문장을 복제하지 않는다.

오늘의 5개 글이 하나의 작은 연재처럼 이어지되, 각각 단독으로 읽혀야 한다.
content_type은 problem, tip, backstage, template, sale을 각각 정확히 한 번 사용한다.

각 text는 반드시 아래 줄 구조를 지킨다.
1줄: 10자 이내 후크
빈 줄
2~4줄: 상황과 차이
빈 줄
2~4줄: 판단, 행동, 마지막 질문
self_comment_0은 5~10줄, self_comment_6h는 3~10줄이며 두 댓글도 모든 줄이 10자 이내다.`;
  const customerPatterns = campaignCustomerPatterns(config);
  let result = await createJson(
    client,
    model,
    dailySystemPrompt(config),
    basePrompt,
    DAILY_BATCH_SCHEMA,
  );
  let ordered = orderedDailyPosts(result);
  let voiceProblems = validateHumanVoiceBatch(ordered, customerPatterns);
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
    ordered = orderedDailyPosts(result);
    voiceProblems = validateHumanVoiceBatch(ordered, customerPatterns);
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
    text: clampText(post.text, 480),
    self_comment_0: clampText(post.self_comment_0, 480),
    self_comment_6h: clampText(post.self_comment_6h, 480),
    search_queries: post.search_queries.map((query) => clampText(query, 60)).slice(0, 4),
  }));
}

async function loadConfigs(db) {
  const { data, error } = await db
    .from('threads_autopilot_config')
    .select('*')
    .eq('enabled', true)
    .order('id', { ascending: true });
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

async function ensureDailyBatch({ db, client, model, config, now }) {
  const timezone = config.timezone || 'Asia/Seoul';
  const dateKey = dateKeyInTimeZone(now, timezone);
  if (config.start_date && dateKey < config.start_date) return [];

  const slots = Array.isArray(config.publish_times) && config.publish_times.length === 5
    ? config.publish_times
    : DEFAULT_SLOTS;
  const { data: existing, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('schedule_date', dateKey)
    .order('slot_index', { ascending: true });
  if (error) throw new Error(`오늘의 스레드 조회 실패: ${error.message}`);
  if ((existing || []).length === slots.length) return existing;

  const performanceContext = await loadRecentPerformanceContext(db, config);
  const generated = await generateDailyBatch(
    client,
    model,
    config,
    dateKey,
    performanceContext,
  );
  const existingRows = existing || [];
  const existingSlots = new Set(existingRows.map((row) => row.slot_index));
  const baseSequence = existingRows.length
    ? Math.min(...existingRows.map((row) => Number(row.sequence) - Number(row.slot_index)))
    : Number(config.next_sequence || 1);
  const rows = generated
    .map((post, index) => ({
      id: crypto.randomUUID(),
      campaign_id: config.id,
      sequence: baseSequence + index,
      schedule_date: dateKey,
      slot_index: index,
      scheduled_at: zonedDateTimeToUtc(dateKey, slots[index], timezone).toISOString(),
      content_type: post.content_type,
      text: post.text,
      self_comment_0: post.self_comment_0,
      self_comment_6h: post.self_comment_6h,
      search_queries: post.search_queries,
      status: 'queued',
    }))
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
      const comment = buildPerformanceComment(metrics, nextPost);
      const resultCommentId = await publishText(token, comment, post.thread_id);
      await db.from('threads_autopilot_posts').update({
        metrics,
        performance_comment: comment,
        performance_comment_id: resultCommentId,
        twenty_four_done_at: now.toISOString(),
        next_post_id: nextPost?.id || null,
        last_error: clearStageError(post.last_error, ['24h:']),
      }).eq('id', post.id);
      completed += 1;
    } catch (err) {
      await db.from('threads_autopilot_posts')
        .update({ last_error: `24h: ${err.message}` })
        .eq('id', post.id);
    }
  }
  return completed;
}

async function processPublishing({ db, token, config, now, limit = 5 }) {
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
      const publishTextValue = post.text;
      const threadId = await publishText(token, publishTextValue);
      publishedThreadId = threadId;
      const details = await getPostDetails(token, threadId).catch(() => ({ permalink: null }));
      const publishedAt = new Date();
      const { error: publishStateError } = await db.from('threads_autopilot_posts').update({
        text: publishTextValue,
        status: 'published',
        thread_id: threadId,
        permalink: details.permalink || null,
        published_at: publishedAt.toISOString(),
        external_due_at: addMinutes(publishedAt, 5).toISOString(),
        reply_due_at: addMinutes(publishedAt, 15).toISOString(),
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
      const zeroCommentId = await publishText(token, post.self_comment_0, post.thread_id);
      await db.from('threads_autopilot_posts').update({
        zero_comment_id: zeroCommentId,
        last_error: clearStageError(post.last_error, ['0m:']),
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

async function processFifteenMinuteReplies({ db, token, client, model, config, now, limit = 5 }) {
  const { data: posts, error } = await db
    .from('threads_autopilot_posts')
    .select('*')
    .eq('campaign_id', config.id)
    .eq('status', 'published')
    .is('reply_done_at', null)
    .lte('reply_due_at', now.toISOString())
    .order('reply_due_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`15분 답글 작업 조회 실패: ${error.message}`);
  let completed = 0;
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
      const replies = await generateConversationReplies(client, model, post, incoming, config);
      const incomingMap = new Map(incoming.map((item) => [String(item.id), item]));
      for (const reply of replies) {
        const responseId = await publishText(token, reply.text, reply.target_id);
        const source = incomingMap.get(reply.target_id);
        await db.from('threads_autopilot_interactions').insert({
          campaign_id: config.id,
          source_post_id: post.id,
          interaction_type: 'inbound_reply',
          target_thread_id: reply.target_id,
          target_username: source?.username || null,
          target_permalink: source?.permalink || null,
          response_thread_id: responseId,
          response_text: reply.text,
        });
      }
      await db.from('threads_autopilot_posts').update({
        reply_count: replies.length,
        reply_done_at: now.toISOString(),
        last_error: clearStageError(post.last_error, ['reply:']),
      }).eq('id', post.id);
      completed += 1;
    } catch (err) {
      await db.from('threads_autopilot_posts')
        .update({ last_error: `reply: ${err.message}` })
        .eq('id', post.id);
    }
  }
  return completed;
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
      const commentId = await publishText(token, post.self_comment_6h, post.thread_id);
      await db.from('threads_autopilot_posts').update({
        six_hour_comment_id: commentId,
        six_hour_done_at: now.toISOString(),
        last_error: clearStageError(post.last_error, ['6h:']),
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
}) {
  const configs = await loadConfigs(db);
  if (!configs.length) return { ok: true, enabled: false, reason: 'config_missing_or_disabled' };

  const apiKey = required(env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY');
  const model = env.THREADS_AI_MODEL || 'claude-sonnet-4-6';
  const client = new Anthropic({ apiKey });

  const campaigns = {};
  for (const config of configs) {
    try {
      const token = await resolveCampaignToken(db, config, env);
      await verifyCampaignAccount(token, config);
      await ensureDailyBatch({ db, client, model, config, now });
      campaigns[config.id] = {
        ok: true,
        published: await processPublishing({ db, token, config, now }),
        zeroMinuteComments: await processZeroComments({ db, token, config }),
        externalComments: await processExternalComments({ db, token, client, model, config, now }),
        fifteenMinuteReplies: await processFifteenMinuteReplies({ db, token, client, model, config, now }),
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
