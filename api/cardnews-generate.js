// POST /api/cardnews-generate — 관리자 전용 카드뉴스 구성표 생성(② 단계)
// 프론트(admin-cardnews)가 Supabase 로그인 세션의 access_token 을 Bearer 로 전달.
// 스크립트 + 목적 + 의도를 받아 Claude 로 "분석 + 5~8장 구성표 JSON" 을 만든다.
// ★ ANTHROPIC_API_KEY 는 이 서버 함수의 환경변수에만 존재한다(브라우저로 절대 안 내려감).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../lib/supabase.js';
import { applyCors } from '../lib/cors.js';

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

# 저작권 (입력이 "남의 콘텐츠"일 때만 적용)
- 표현을 100% 새로 쓴다: 순서·용어·단어·문장을 모두 바꿔 원문과 안 겹치게, 의미만 정확히 전달.
- 영어는 반드시 한글로 바꾼다.
- 단, 보는 사람이 그대로 복사해 써야 하는 프롬프트·코드·명령어는 예외 — 원문 보존(바꾸면 작동 안 함).
- 출력 전, 각 문장이 원문 표현과 겹치지 않는지 스스로 점검한다.

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
//   admin-threads.html 이 { engine:'threads', source, inputType, purpose, intent } 로 호출.
const THREADS_INPUT_TYPES = {
  benchmark: '벤치마킹 스레드 글',
  youtube: '유튜브 스크립트',
  lecture: '내 강의 멘트',
};
const THREADS_INPUT_GUIDE = {
  benchmark:
    '[입력=벤치마킹 스레드 글] "왜 터졌는가"(논리·후킹 방식·감정 자극)만 추출하고 글은 100% 새로 쓴다. ' +
    '원본의 단어·문장·비유·어순을 단 하나도 가져오지 않는다. 주제만 같고 표현은 완전히 다른 글이어야 한다. (규칙 8 엄격 적용)',
  youtube:
    '[입력=유튜브 스크립트] 주장·논리·사례를 추출해 스레드 문법(짧은 문단·후킹·CTA)으로 압축·재작성한다. ' +
    '말투·문장은 그대로 옮기지 말고 스레드용으로 새로 쓴다. (규칙 8 적용)',
  lecture:
    '[입력=내 강의 멘트] 본인 콘텐츠이므로 재구성 규칙(규칙 8) 예외. 핵심 메시지를 살려 스레드 글로 다듬어 자산화한다. 의미를 바꾸지 말고 더 또렷하게 정리한다.',
};
const THREADS_PURPOSES = {
  openchat: '오픈채팅방 모으기 — "직접 해보고 질문할 사람만 들어오세요" 식으로 선별형 CTA',
  reaction_test: '반응 테스트 — 댓글·저장·공감을 유도해 어떤 떡밥이 먹히는지 본다(과한 판매 CTA 금지)',
  prompt_bait: '프롬프트 떡밥 — 프롬프트/워크플로우에 관심 있는 사람을 끌어 "받아서 직접 해볼 사람"만 모은다',
};

const THREADS_SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 스레드 글 자동 생성 엔진(스레드 공장)이다.
원재료(벤치마킹 글 / 유튜브 스크립트 / 내 강의 멘트)를 받아, 8개 포맷 중 가장 어울리는 2~3개를 골라 각각 완성된 스레드 글 + 이미지 프롬프트 2개를 써낸다.

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
규칙 8. [재구성 원칙 — 위반 시 폐기] 벤치마킹/유튜브 입력은 단어·문장·비유·어순을 하나도 가져오지 않는다.
        완성 후 자가 점검: "원본과 나란히 놓으면 같은 글로 보이는가?" → 조금이라도 그렇다면 다시 쓴다.
        (강의 멘트 입력은 본인 콘텐츠라 이 규칙 예외 — 다듬어 활용)

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
  const { source, inputType, purpose, intent } = req.body || {};
  if (!source || source.trim().length < 30) {
    return res.status(400).json({ error: '원재료를 30자 이상 붙여넣어 주세요.' });
  }
  if (!inputType || !THREADS_INPUT_TYPES[inputType]) {
    return res.status(400).json({ error: '원재료 종류를 선택해 주세요.' });
  }
  if (!purpose || !THREADS_PURPOSES[purpose]) {
    return res.status(400).json({ error: '목적을 선택해 주세요.' });
  }

  const header =
    `# 원재료 종류\n${THREADS_INPUT_TYPES[inputType]}\n${THREADS_INPUT_GUIDE[inputType]}\n\n` +
    `# 목적/CTA 방향\n${THREADS_PURPOSES[purpose]}\n\n` +
    `# 추가 의도(타깃 / 연결할 곳)\n${(intent || '').trim() || '(미입력 — 맥락에서 가장 적절한 선별형 CTA를 설계하되, 사실정보는 자리표시자로 둔다)'}\n\n` +
    `# 원재료 본문\n${source.trim()}`;

  const msg = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    system: THREADS_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: THREADS_SCHEMA } },
    messages: [{ role: 'user', content: header }],
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

  // 3) 입력 검증 (텍스트 벤치마킹 또는 이미지 벤치마킹)
  const { script, purpose, intent, images } = req.body || {};
  const imgs = Array.isArray(images) ? images.filter((im) => im && im.base64 && im.base64.length > 100).slice(0, 4) : [];
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
    `# 의도(홍보 대상 / 연결할 BCC 프로그램)\n${(intent || '').trim() || '(미입력 — 맥락에서 가장 적절한 BCC 연결을 추론하되, 사실정보는 자리표시자로 둔다)'}\n\n`;

  let userMessageContent;
  if (hasImage) {
    userMessageContent = [
      ...imgs.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.base64 } })),
      { type: 'text', text: header + '# 원본 콘텐츠\n첨부 이미지(들)는 원본 콘텐츠다(워크플로우·프롬프트·노하우 또는 참고 게시글). 이미지 속 내용을 읽고 위 [모드 판별]에 따라 BCC 카드뉴스로 만들어라.' },
    ];
  } else {
    userMessageContent = header + '# 원본 콘텐츠(텍스트)\n' + script.trim();
  }

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
