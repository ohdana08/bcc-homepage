// POST /api/cardnews-generate — 관리자 전용 카드뉴스 구성표 생성(② 단계)
// 프론트(admin-cardnews)가 Supabase 로그인 세션의 access_token 을 Bearer 로 전달.
// 스크립트 + 목적 + 의도를 받아 Claude 로 "분석 + 5~8장 구성표 JSON" 을 만든다.
// ★ ANTHROPIC_API_KEY 는 이 서버 함수의 환경변수에만 존재한다(브라우저로 절대 안 내려감).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';
import { BENCHMARK_COPYRIGHT_BLOCK, COPYRIGHT_GUARDRAIL, normalizeImages, buildBenchmarkContent } from '../lib/benchmark.js';

// Opus 호출이 길어질 수 있으므로 함수 타임아웃을 넉넉히 둔다(Vercel Hobby 최대 60s).
export const maxDuration = 60;

const PURPOSES = { lecture_inquiry: '강의문의', challenge_signup: '챌린지신청', save_follow: '저장·팔로우' };

const SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 카드뉴스 변환 엔진이다.
입력(텍스트 또는 이미지)을 BCC 스타일 카드뉴스 구성표로 만든다.

# 최우선 목표
보는 사람이 "바로 써먹을 방법/노하우"를 얻어가게 한다. 어떤 입력이든 그 안에서 따라 할 수 있는 방법을 최대한 뽑아낸다.

# 형식 자동 선택 (meta.format 에 반드시 기록)
입력을 보고 가장 잘 맞는 형식 하나를 스스로 고른다:
- "workflow" : 단계로 따라 하는 과정/절차가 있을 때 → 단계마다 한 장씩.
- "prompt"   : 그대로 복사해 쓸 프롬프트/템플릿이 핵심일 때 → 실제 프롬프트를 원문 그대로 보존(번역·변형 금지). 길면 토막 내어 여러 장에 나눈다.
- "knowhow"  : 팁·원칙·체크리스트 형태의 노하우일 때 → 실천 가능한 항목으로 정리.
- "general"  : 진짜 방법이 없을 때(순수 감성글·의견 등) → 가장 핵심 takeaway 한 가지를 뽑아 일반 카드뉴스로.

# 구조
후크(이걸로 얻는 결과) → 공감(지금 왜 어려운지) → 방법/내용(형식에 맞게) → 결과 → CTA. 마지막은 반드시 CTA(의도에 적힌 BCC 프로그램으로 연결).

# 장수
- workflow / prompt: 최대 15장 (단계마다 한 장, 너무 빽빽하지 않게).
- knowhow / general: 5~8장.

# 저작권 — 아래 공통 규칙(B판별 + 강제 안전장치)을 따른다
${BENCHMARK_COPYRIGHT_BLOCK}

# 분석 (analysis 로 화면에 보여준다)
- 이 콘텐츠가 먹힌/유용한 이유 5가지
- 가져갈 핵심을 한 줄로 명시

# 공통 규칙
- 목적/CTA(강의문의|챌린지신청|저장·팔로우)와 의도에 맞춰 후크·CTA 설계.
- BCC 톤: 현실적·직설적·초보자 친화. 추임새·사담·반복 버림.
- 가격·일정·신청링크 등 사실정보는 추론 금지 → [가격] [링크] [일정] 자리표시자.
- 전체 프롬프트/워크플로우가 카드에 다 안 들어가면 마지막 CTA에서 "전체는 카톡/저장/[링크]"로 받게 유도.

# 카드 필드 규칙 (1080×1080 정사각형)
- title: 2~4줄. 한 줄 한글 8~13자 권장. 의미 단위 줄바꿈은 \\n. 핵심 단어 1~3개를 *별표*로 강조(형광펜). (body엔 별표 X)
- body: 2~3줄 권장. 단 prompt/workflow 단계 카드는 실제 내용 한 토막을 4~5줄까지 넣어도 됨(짧게 끊어 카드 수를 늘린다).
- flow: Hook | Pain | Step | Result | CTA 중 하나.
- role: 그 카드의 역할 한 줄.
- bg_query: 카드 "장면"을 묘사하는 영어 검색어 2~4단어. 예: "person using laptop ai", "focused work desk", "team meeting".
- watermark: 일반 카드는 "@business_career_consulting", 마지막 CTA 카드만 "BCC · @business_career_consulting".

# meta.style_hint (일러스트 화풍 — 영어 한 문장)
- 첨부 이미지가 있으면 그 화풍·색감·구도·분위기를 반영해 묘사. 없으면 "soft warm Korean webtoon illustration, semi-realistic, gentle watercolor, pastel cozy lighting".

반드시 지정된 JSON 스키마에 맞춰서만 출력한다. 설명·마크다운 없이 JSON 객체만 출력한다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      properties: {
        why_worked: { type: 'array', items: { type: 'string' } },
        core_10pct: { type: 'string' },
      },
      required: ['why_worked', 'core_10pct'],
      additionalProperties: false,
    },
    meta: {
      type: 'object',
      properties: {
        purpose: { type: 'string' },
        intent: { type: 'string' },
        total: { type: 'integer' },
        style_hint: { type: 'string' },
        format: { type: 'string' },
      },
      required: ['purpose', 'intent', 'total', 'style_hint', 'format'],
      additionalProperties: false,
    },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          no: { type: 'integer' },
          flow: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          role: { type: 'string' },
          bg_query: { type: 'string' },
          watermark: { type: 'string' },
        },
        required: ['no', 'flow', 'title', 'body', 'role', 'bg_query', 'watermark'],
        additionalProperties: false,
      },
    },
  },
  required: ['analysis', 'meta', 'cards'],
  additionalProperties: false,
};

function parseJsonLoose(text) {
  // output_config 가 적용되면 순수 JSON 이지만, 혹시 코드펜스가 섞여도 견디게 한다.
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

// ───────────────────────── 스레드 공장 (engine:'threads') ─────────────────────────
// ★ Vercel Hobby 12함수 한계 때문에 별도 함수로 두지 않고 이 엔드포인트에 통합한다.
//   admin-threads.html 이 { engine:'threads', mode, text|source, images, purpose, intent } 로 호출.
//   입구는 카드뉴스와 동일한 [텍스트/이미지] 공통 입구. 내것/남의것은 B판별이 자동 판단.
const THREADS_PURPOSES = {
  openchat: '오픈채팅방 모으기 — "직접 해보고 질문할 사람만 들어오세요" 식으로 선별형 CTA',
  reaction_test: '반응 테스트 — 댓글·저장·공감을 유도해 어떤 떡밥이 먹히는지 본다(과한 판매 CTA 금지)',
  prompt_bait: '프롬프트 떡밥 — 프롬프트/워크플로우에 관심 있는 사람을 끌어 "받아서 직접 해볼 사람"만 모은다',
};

const THREADS_SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 스레드 글 자동 생성 엔진(스레드 공장)이다.
원재료(텍스트 또는 첨부 이미지 — 내 방법/프롬프트/워크플로우, 또는 잘 터진 남의 글·게시물)를 받아, 8개 포맷 중 가장 어울리는 2~3개를 골라 각각 완성된 스레드 글 + 이미지 프롬프트 2개를 써낸다.

# 최우선 목적 (절대 잊지 말 것)
판매가 아니라 "선별·수집"이다. 프롬프트·워크플로우에 관심 있는 사람 중, 받아서 직접 해보고 질문하는 "실행력 있는 사람"만 모은다. 어그로로 아무나 끌지 않는다.

# 8개 포맷 (각 글은 이 중 하나의 모양을 따른다)
1. 축하해줘 — 자랑·응원 유도 → 공감 댓글
2. 사람을 찾습니다 — 1~5 타깃을 나열해 동질감 → 연결
3. 이런거 관심 있으려나 — 호기심 떡밥 + 댓글 유도
4. 결과물 공유형 — 전문용어 없이 간결하게, 만든 것 보여주기
5. 프로세스 공유형 — 실패→개선→피드백 작업 로그
6. 넘버링 컨텐츠 — 헤드카피 + 숫자 정렬 + 끝 CTA
7. 레퍼런스 해부형 — "이게 왜 터졌는지 알아?" → 분석을 보여주며 배울 사람을 모음
8. 가치 입증형 — 후킹 → 전문성/데이터로 입증 → 부연 (경력·신뢰 구축)

# 포맷 선택 로직
- 주제를 보고 8개 중 가장 잘 맞는 2~3개를 스스로 고른다.
- 각 글마다 "왜 이 포맷인지" 한 줄 이유(why_format)를 쓴다.
- 같은 주제라도 포맷에 따라 완전히 다른 글이 나와야 한다(나란히 비교해 채택할 수 있게).

# 규칙집 (어떤 포맷을 쓰든 항상 전부 지킨다)
규칙 1. 첫 문장 = "스크롤 멈추는 한 방". 한 문장. 20자 안쪽 권장 / 30자 권장 상한 / 60자 절대 한계. 설명 말고 후킹만.
        후킹 3종 중 하나로: ① 타깃 콕 집기  ② 숫자·결과  ③ 호기심·긴장.
규칙 2. 문단은 짧게 짧게. 길어지면 이탈. 의미 단위로 줄바꿈(\\n).
규칙 3. 후킹 → 가치 입증 → 부연 설명 순서를 8개 포맷 전체에 항상 적용.
규칙 4. 재미만 있는 글 금지. 반드시 가치를 전달해 사람을 모은다.
규칙 5. 전문용어를 줄이고 보편적인 단어로 쓴다.
규칙 6. 어그로로 아무나 끌지 않는다. 실행력 있는 사람만 선별한다.
규칙 7. 숫자·1등 표현을 활용한다(좁혀서라도 1등: "발산동에서 가장 오래된" 식).
규칙 8. [저작권] 아래 [B판별]·[저작권 강제 안전장치]를 그대로 따른다(내 방법은 살려서, 남의 글은 전면 재구성).

# 저작권 — 공통 규칙 (B판별 + 강제 안전장치)
${BENCHMARK_COPYRIGHT_BLOCK}

# CTA (목적에 맞춰 설계)
- 목표는 판매가 아니라 선별·수집이다.
- ❌ "무료로 받아가세요"(아무나 옴)  ✅ "직접 해보고 질문할 사람만 들어오세요"(선별)
- 사실정보(가격·일정·링크)는 지어내지 말고 [링크] [오픈채팅] 같은 자리표시자로 둔다.

# 이미지 프롬프트 2개 (글마다 시작·끝 한 쌍)
- 자연어 서술형으로 쓴다(ChatGPT/DALL·E·나노바나나/Gemini 공용). 미드저니식 키워드·파라미터(--ar 등) 금지.
- 시작 프레임 → 끝 프레임이 자연스럽게 이어지는 before→after 흐름.
- 시선을 멈추는 강렬한 색감, 특이한 구도를 반영한다. 한국어로 서술한다.

# 분석 (analysis 로 화면에 보여준다)
- 이 원재료의 주제(topic) 한 줄.
- 이게 왜 먹히는지/터졌는지 이유(why_works) 3~5가지.
- 누구에게 닿아야 하는지 타깃(audience) 한 줄.

# 톤
BCC 톤: 현실적·직설적·초보자 친화. 추임새·사담·반복은 버린다.

반드시 지정된 JSON 스키마에 맞춰서만 출력한다. 설명·마크다운 없이 JSON 객체만 출력한다.`;

const THREADS_SCHEMA = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      properties: {
        topic: { type: 'string' },
        why_works: { type: 'array', items: { type: 'string' } },
        audience: { type: 'string' },
      },
      required: ['topic', 'why_works', 'audience'],
      additionalProperties: false,
    },
    meta: {
      type: 'object',
      properties: {
        input_type: { type: 'string' },
        purpose: { type: 'string' },
      },
      required: ['input_type', 'purpose'],
      additionalProperties: false,
    },
    threads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          format_no: { type: 'integer' },
          format_name: { type: 'string' },
          why_format: { type: 'string' },
          hook: { type: 'string' },
          text: { type: 'string' },
          cta: { type: 'string' },
          image_prompts: {
            type: 'object',
            properties: { start: { type: 'string' }, end: { type: 'string' } },
            required: ['start', 'end'],
            additionalProperties: false,
          },
        },
        required: ['format_no', 'format_name', 'why_format', 'hook', 'text', 'cta', 'image_prompts'],
        additionalProperties: false,
      },
    },
  },
  required: ['analysis', 'meta', 'threads'],
  additionalProperties: false,
};

// 스레드 글 생성 — auth/admin 검증은 호출부(handler)에서 끝낸 뒤 들어온다.
async function handleThreads(req, res, client) {
  const { mode, source, text, purpose, intent, images } = req.body || {};
  // 공통 입구: 텍스트(source/text) 또는 이미지. 내것/남의것은 B판별이 자동 판단.
  const bodyText = (text || source || '').trim();
  const imgs = normalizeImages(images);
  const hasText = bodyText.length >= 30;
  const hasImage = imgs.length > 0;
  if (!hasText && !hasImage) {
    return res.status(400).json({ error: '원재료 텍스트(30자 이상) 또는 이미지를 넣어 주세요.' });
  }
  if (!purpose || !THREADS_PURPOSES[purpose]) {
    return res.status(400).json({ error: '목적을 선택해 주세요.' });
  }

  const header =
    `# 목적/CTA 방향\n${THREADS_PURPOSES[purpose]}\n\n` +
    `# 추가 의도(타깃 / 연결할 곳)\n${(intent || '').trim() || '(미입력 — 맥락에서 가장 적절한 선별형 CTA를 설계하되, 사실정보는 자리표시자로 둔다)'}`;

  const content = buildBenchmarkContent({
    text: hasText ? bodyText : '',
    images: imgs,
    headerText: header,
    imageRoleText: '첨부 이미지(들)가 원재료다(내 방법/프롬프트/워크플로우 캡처, 또는 잘 터진 남의 글·게시물 캡처). 이미지 속 내용을 읽고 위 [B판별]·[저작권 강제 안전장치]에 따라 스레드 글로 만들어라.',
  });

  const msg = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    system: THREADS_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: THREADS_SCHEMA } },
    messages: [{ role: 'user', content }],
  });

  if (msg.stop_reason === 'refusal') {
    return res.status(422).json({ error: '이 콘텐츠는 생성이 거절되었습니다. 다른 원재료로 시도해 주세요.' });
  }
  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock) return res.status(502).json({ error: 'AI 응답이 비어 있습니다. 다시 시도해 주세요.' });

  let result;
  try {
    result = parseJsonLoose(textBlock.text);
  } catch (e) {
    return res.status(502).json({ error: 'AI 응답 형식 오류. 다시 시도해 주세요.' });
  }
  if (Array.isArray(result.threads) && result.threads.length > 3) {
    result.threads = result.threads.slice(0, 3);
  }
  return res.json(result);
}

// ───────────────────────── 블로그 공장 (engine:'blog') ─────────────────────────
// ★ Vercel Hobby 12함수 한계 때문에 별도 함수로 두지 않고 이 엔드포인트에 통합한다.
//   OSMU 라인 세 번째 출구 — 같은 핵심 메시지를 "가장 길고 깊은 정보성 칼럼"으로 푼다.
//   입구 2개가 같은 generateColumn() 으로 합류한다(저작권 2단계 분리 적용):
//     [입구1 mode:'solo'] 원료 → (추출) 핵심메시지 JSON → (생성) 칼럼
//     [입구2 mode:'osmu'] 이미 추출된 핵심메시지 JSON → (생성) 칼럼  (추출 건너뜀)
//   추출된 JSON 은 폐기하지 않고 결과에 함께 돌려준다(재사용 가능한 OSMU 부품).

// 핵심 메시지 JSON 스키마(입구2 입력 형식 = 지시서 고정). 두 입구 공통 인터페이스.
const BLOG_MESSAGE_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    claim: { type: 'string' },
    logic: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    cta: { type: 'string' },
  },
  required: ['topic', 'claim', 'logic', 'evidence', 'cta'],
  additionalProperties: false,
};

// [추출 단계] 원료에서 "뼈대"만 뽑는다 — 원문 표현·단어·문장은 전부 폐기.
const BLOG_EXTRACT_SYSTEM_PROMPT = `너는 콘텐츠에서 "핵심 메시지의 뼈대"만 추출하는 엔진이다.
입력된 원료에서 다음만 뽑는다.

# 원료의 형태 (텍스트 / 첨부 이미지, 또는 둘 다)
- 텍스트 벤치마킹: 사용자가 붙여넣은 글·지시(주제·형식·무엇을 벤치마킹할지의 방향).
- 이미지 벤치마킹: 벤치마킹할 글의 캡처 등. 이미지 속 글은 "구조·논리"만 읽고 표현·문장은 절대 가져오지 않는다.
- 둘 다 있으면 둘 다 반영한다.

# 뽑을 것 (이것만)
- topic: 이 글이 다루는 주제 한 줄.
- claim: 글이 밀고 가는 핵심 주장 한 줄.
- logic: 주장을 펴는 논리 전개 순서 3~5개(각 한 줄). "무엇을 어떤 순서로 말하는가"의 뼈대만.
- evidence: 근거·사례의 "종류"만 3개 이내(예: "개인 경험담", "통계 수치", "비교 사례"). 원문 문장 복붙 금지.
- cta: 원료가 독자에게 유도하려는 행동 한 줄.

# 저작권 — 공통 규칙 (B판별 + 강제 안전장치). 추출 단계에서도 원문 표현을 절대 가져오지 않는다.
${BENCHMARK_COPYRIGHT_BLOCK}

반드시 지정된 JSON 스키마에 맞춰서만 출력한다. 설명·마크다운 없이 JSON 객체만 출력한다.`;

// [생성 단계] 뼈대(JSON)만 보고, 원문을 다시 보지 않고, BCC 톤으로 처음부터 칼럼을 쓴다.
const BLOG_GEN_SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 정보성 블로그 칼럼 생성 엔진(블로그 공장)이다.
입력은 "핵심 메시지 뼈대(JSON)"뿐이다. 원문은 없다. 이 뼈대만 보고 칼럼을 처음부터 새로 쓴다.

# 이 블로그의 성격 (절대 혼동 금지)
- 정보제공 · 칼럼 · 인사이트. 일반 검색/SNS 독자 대상. 목표는 도달·구독.
- ❌ 강의 후기 / 실적 자랑 / 영업 톤 절대 금지(그건 별개의 후기 블로그 소관). 정보·칼럼만.

# 길이·구조
- 본문 1500~2500자(한국어 기준). 스레드·카드뉴스와 같은 핵심 메시지를 "가장 깊고 길게" 푼 심화판.
- 구조: 후킹 도입 → 문제 정의 → 핵심 인사이트(주장+근거) → 구체 적용/예시 → 정리 + CTA.
- 본문은 H2(##)·H3(###) 소제목으로 구획하고, 소제목에 검색 키워드가 자연스럽게 들어가게 한다.
- body 는 마크다운으로 쓴다(## , ### , 문단, 필요시 - 목록).

# 저작권 (생성 단계 — 공통 강제 안전장치)
- 뼈대(JSON)의 의미·논리 순서만 따르고, 표현·문장은 100% BCC 표현으로 처음부터 새로 쓴다.
${COPYRIGHT_GUARDRAIL}

# SEO (블로그만의 무기 — 반드시 함께 생성)
- seo_title: 검색 키워드를 앞쪽에 배치한 제목. 60자 이내.
- meta_description: 검색결과에 노출될 요약. 150자 이내.
- tags: 검색 키워드/태그 5~8개.
- (UTM 은 서버가 조립하므로 너는 만들지 않는다.)

# 톤
BCC 톤: 현실적·직설적·초보자 친화. 추임새·사담·반복은 버린다. 사실정보(가격·일정·링크)는 지어내지 말고 [링크] [일정] 같은 자리표시자로 둔다.

반드시 지정된 JSON 스키마에 맞춰서만 출력한다. 설명·마크다운 펜스 없이 JSON 객체만 출력한다.`;

const BLOG_GEN_SCHEMA = {
  type: 'object',
  properties: {
    column: {
      type: 'object',
      properties: {
        title_h1: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['title_h1', 'body'],
      additionalProperties: false,
    },
    seo: {
      type: 'object',
      properties: {
        seo_title: { type: 'string' },
        meta_description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['seo_title', 'meta_description', 'tags'],
      additionalProperties: false,
    },
  },
  required: ['column', 'seo'],
  additionalProperties: false,
};

// 원료 식별자(또는 주제)를 UTM campaign 으로 쓸 수 있게 안전한 슬러그로 변환.
function toCampaignSlug(s) {
  const base = String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'osmu';
}

// 핵심 메시지 JSON 검증(입구2 입력) — 필수 키·타입 확인.
function validateMessage(m) {
  if (!m || typeof m !== 'object') return '핵심 메시지 JSON 형식이 올바르지 않습니다.';
  if (!m.topic || !m.claim) return 'topic/claim 은 필수입니다.';
  if (!Array.isArray(m.logic) || m.logic.length === 0) return 'logic 배열이 비어 있습니다.';
  if (!Array.isArray(m.evidence)) return 'evidence 는 배열이어야 합니다.';
  if (!m.cta) return 'cta 는 필수입니다.';
  return null;
}

// ★ 두 입구가 합류하는 공유 생성 함수 — 핵심 메시지 JSON 만 받아 칼럼 + SEO 를 만든다.
async function generateColumn(client, message, campaignId) {
  const skeleton =
    `# 핵심 메시지 뼈대 (이것만 보고 칼럼을 처음부터 새로 써라)\n` +
    `- 주제(topic): ${message.topic}\n` +
    `- 핵심 주장(claim): ${message.claim}\n` +
    `- 논리 전개(logic):\n${(message.logic || []).map((x, i) => `  ${i + 1}. ${x}`).join('\n')}\n` +
    `- 근거/사례 종류(evidence):\n${(message.evidence || []).map((x) => `  - ${x}`).join('\n')}\n` +
    `- 독자 행동 유도(cta): ${message.cta}`;

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: BLOG_GEN_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: BLOG_GEN_SCHEMA } },
    messages: [{ role: 'user', content: skeleton }],
  });
  if (msg.stop_reason === 'refusal') {
    const e = new Error('이 콘텐츠는 생성이 거절되었습니다. 다른 원료로 시도해 주세요.');
    e.httpStatus = 422; throw e;
  }
  const textBlock = msg.content.find((b) => b.type === 'text');
  if (!textBlock) { const e = new Error('AI 응답이 비어 있습니다. 다시 시도해 주세요.'); e.httpStatus = 502; throw e; }
  let out;
  try { out = parseJsonLoose(textBlock.text); }
  catch (e2) { const e = new Error('AI 응답 형식 오류. 다시 시도해 주세요.'); e.httpStatus = 502; throw e; }

  const campaign = toCampaignSlug(campaignId || message.topic);
  out.seo = out.seo || {};
  out.seo.utm = `utm_source=blog&utm_medium=organic&utm_campaign=${campaign}`;
  return out;
}

// 블로그 글 생성 — auth/admin 검증은 호출부(handler)에서 끝낸 뒤 들어온다.
async function handleBlog(req, res, client) {
  const { mode, source, text, message, campaignId, images } = req.body || {};

  // 입구2(OSMU 부품): 이미 추출된 핵심 메시지 JSON → 추출 건너뛰고 바로 생성.
  let coreMessage;
  if (mode === 'osmu' || message) {
    coreMessage = message;
    const verr = validateMessage(coreMessage);
    if (verr) return res.status(400).json({ error: verr });
  } else {
    // 입구1(단독): 공통 입구(텍스트 벤치마킹 또는 이미지 벤치마킹) → 추출 → 핵심 메시지 JSON.
    const bodyText = (text || source || '').trim();
    const imgs = normalizeImages(images);
    const hasText = bodyText.length >= 30;
    const hasImage = imgs.length > 0;
    if (!hasText && !hasImage) {
      return res.status(400).json({ error: '원료 텍스트(30자 이상) 또는 이미지를 넣어 주세요.' });
    }

    // 추출(call1)만 멀티모달. 생성(call2)에는 이미지를 넘기지 않는다 → 원문 표현 차용 원천 차단.
    const exContent = buildBenchmarkContent({
      text: hasText ? bodyText : '',
      images: imgs,
      headerText: '# 원료에서 핵심 메시지 뼈대만 추출하라 (위 [B판별]·[저작권 강제 안전장치] 적용)',
      imageRoleText: '첨부 이미지(들)는 벤치마킹할 글의 캡처다. 이미지 속 글의 "구조·논리"만 읽어 뼈대로 추출하고, 표현·문장·단어는 단 하나도 가져오지 마라.',
    });

    const ex = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: BLOG_EXTRACT_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: BLOG_MESSAGE_SCHEMA } },
      messages: [{ role: 'user', content: exContent }],
    });
    if (ex.stop_reason === 'refusal') {
      return res.status(422).json({ error: '이 원료는 추출이 거절되었습니다. 다른 원료로 시도해 주세요.' });
    }
    const exBlock = ex.content.find((b) => b.type === 'text');
    if (!exBlock) return res.status(502).json({ error: 'AI 추출 응답이 비어 있습니다. 다시 시도해 주세요.' });
    try { coreMessage = parseJsonLoose(exBlock.text); }
    catch (e) { return res.status(502).json({ error: '추출 응답 형식 오류. 다시 시도해 주세요.' }); }
    const verr = validateMessage(coreMessage);
    if (verr) return res.status(502).json({ error: '추출 결과가 불완전합니다: ' + verr });
  }

  // ★ 합류 지점 — 두 입구 모두 동일한 generateColumn 으로.
  const generated = await generateColumn(client, coreMessage, campaignId);

  // 추출된 핵심 메시지(OSMU 부품)는 폐기하지 않고 함께 반환한다.
  return res.json({ message: coreMessage, column: generated.column, seo: generated.seo });
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // 1) 로그인 토큰 검증
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증이 필요합니다.' });

  const db = supabaseAdmin();
  const { data: { user } = {}, error: uErr } = await db.auth.getUser(token);
  if (uErr || !user) return res.status(401).json({ error: '인증이 만료되었거나 올바르지 않습니다.' });

  // 2) 관리자 검증 (profiles.is_admin)
  const { data: profile } = await db.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  // 2.5) 스레드 공장 분기 — engine:'threads' 이면 스레드 글 생성기로(같은 함수, 12함수 한계 회피)
  if ((req.body?.engine) === 'threads') {
    try {
      return await handleThreads(req, res, new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
    } catch (err) {
      console.error('threads-generate error:', err?.message || err);
      const status = err?.status === 429 ? 429 : 500;
      return res.status(status).json({ error: status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' });
    }
  }

  // 2.6) 블로그 공장 분기 — engine:'blog' 이면 정보성 칼럼 생성기로(같은 함수, 12함수 한계 회피)
  if ((req.body?.engine) === 'blog') {
    try {
      return await handleBlog(req, res, new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));
    } catch (err) {
      if (err?.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
      console.error('blog-generate error:', err?.message || err);
      const status = err?.status === 429 ? 429 : 500;
      return res.status(status).json({ error: status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' });
    }
  }

  // 3) 입력 검증 (텍스트 벤치마킹 또는 이미지 벤치마킹 — 공통 입구)
  const { script, purpose, intent, images } = req.body || {};
  const imgs = normalizeImages(images);
  const hasText = script && script.trim().length >= 30;
  const hasImage = imgs.length > 0;
  if (!hasText && !hasImage) {
    return res.status(400).json({ error: '텍스트(30자 이상) 또는 이미지를 입력해 주세요.' });
  }
  if (!purpose || !PURPOSES[purpose]) {
    return res.status(400).json({ error: '목적을 선택해 주세요.' });
  }

  // 4) Claude 호출
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.' });
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const header =
    `# 목적/CTA\n${PURPOSES[purpose]}\n\n` +
    `# 의도(홍보 대상 / 연결할 BCC 프로그램)\n${(intent || '').trim() || '(미입력 — 맥락에서 가장 적절한 BCC 연결을 추론하되, 사실정보는 자리표시자로 둔다)'}`;

  const userMessageContent = buildBenchmarkContent({
    text: hasText ? script : '',
    images: imgs,
    headerText: header,
    imageRoleText: '첨부 이미지(들)는 원본 콘텐츠다(워크플로우·프롬프트·노하우 또는 참고 게시글). 이미지 속 내용을 읽고 위 [B판별]·[저작권 강제 안전장치]에 따라 BCC 카드뉴스로 만들어라.',
  });

  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: userMessageContent }],
    });

    if (msg.stop_reason === 'refusal') {
      return res.status(422).json({ error: '이 콘텐츠는 생성이 거절되었습니다. 다른 스크립트로 시도해 주세요.' });
    }

    const textBlock = msg.content.find((b) => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'AI 응답이 비어 있습니다. 다시 시도해 주세요.' });

    let result;
    try {
      result = parseJsonLoose(textBlock.text);
    } catch (e) {
      return res.status(502).json({ error: 'AI 응답 형식 오류. 다시 시도해 주세요.' });
    }

    // 장수 안전장치(최대 15장 — 방법 전달 모드 대응)
    if (Array.isArray(result.cards) && result.cards.length > 15) {
      result.cards = result.cards.slice(0, 15).map((c, i) => ({ ...c, no: i + 1 }));
      if (result.meta) result.meta.total = result.cards.length;
    }

    return res.json(result);
  } catch (err) {
    console.error('cardnews-generate error:', err?.message || err);
    const status = err?.status === 429 ? 429 : 500;
    return res.status(status).json({ error: status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' });
  }
}
