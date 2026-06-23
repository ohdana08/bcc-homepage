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

const SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 "터진 콘텐츠 → 카드뉴스 변환 엔진"이다.
유튜브/스레드 등에서 이미 반응이 좋았던 콘텐츠를 BCC 스타일 카드뉴스 구성표로 재조립한다.
무에서 창작하는 게 아니라, 검증된 원재료를 BCC 톤으로 "재포장"하는 것이 임무다.

# 입력
- 스크립트 전문(원본 콘텐츠)
- 목적/CTA: 강의문의 | 챌린지신청 | 저장·팔로우 중 하나
- 의도: 이 카드뉴스로 무엇을 전하고 어떤 BCC 프로그램으로 연결하고 싶은지(한 줄)

# STEP 1. 분석 (학습 자산으로 화면에 보여준다)
- 이 콘텐츠가 먹힌 이유 5가지 (후크/감정자극/사례/해결책/CTA 관점)
- 카드뉴스로 가져갈 핵심 10%가 무엇인지 한 줄로 명시

# STEP 2. 재구성 (영상 문법 → 카드 문법)
- 영상: 후크→스토리→설명→결론
- 카드: 후크(Hook)→공감(Pain)→통찰/해결(Step)→결과(Result)→행동(CTA) 으로 재배치
- 목적/의도에 따라 후크와 CTA를 다르게 설계한다.
- 마지막 카드는 반드시 CTA 카드: 의도에 적힌 BCC 프로그램으로 자연스럽게 연결한다.

# STEP 3. 구성표 (장수 규칙 — 엄수)
- 5~8장으로만 구성한다. 8장이 최대이며, 9장 이상은 절대 만들지 않는다.
- 내용이 많아도 핵심만 추려 8장 안에 압축한다.

# 저작권 규칙 (강제)
- 원문 문장을 절대 그대로 옮기지 마라. 주장·논리·사실만 차용하고 표현은 100% 새로 쓴다.
- 원문에 리스트나 순서(예: TOP 5, 1·2·3)가 있으면 순서를 반드시 재배치한다.
- 같은 뜻이라도 다른 단어·다른 문장 구조·동의어로 바꾼다.
- BCC 톤(현실적·직설적·초보자 친화)으로 다시 쓴다. 추임새·사담·반복은 버린다.
- 출력 전, 각 문장이 원문 표현과 겹치지 않는지 스스로 점검하고, 겹치면 다시 바꾼다.

# 사실정보 규칙
- 가격·일정·신청링크 등 사실정보는 추론하지 마라. 대신 [가격] [링크] [일정] 같은 자리표시자로 비워둔다.

# 디자인/길이 규칙 (1080×1080 정사각형 카드 기준)
- title: 제목. 2~4줄. 한 줄은 한글 8~13자 권장. 의미 단위로 줄바꿈하고 줄바꿈은 \\n 으로 표기한다.
  · 제목에서 핵심 단어 1~3개를 *별표*로 감싸 강조 표시한다(형광펜 효과용). 예: "*맞아* 대신\\n*그럴 수 있겠다*". (body에는 별표를 쓰지 않는다.)
- body: 본문. 2~3줄. 한 줄 13~18자 권장. 제목을 반복하지 말고 맥락·근거·다음 행동을 짧게.
- bg_query: 이 카드의 "장면"을 묘사하는 영어 검색어 2~4단어. 인물·감정·상황을 담아도 좋다(일러스트/사진 배경 공용). 예: "two friends talking cafe", "tired office worker", "confident woman smiling", "city night street", "team meeting".

# meta.style_hint (일러스트 화풍 — 영어 한 문장)
- 생성할 일러스트의 화풍을 영어 한 문장으로 meta.style_hint 에 적는다.
- ★첨부 이미지가 있으면: 그 이미지의 화풍·색감·구도·분위기를 관찰해 그대로 반영해 묘사한다(예: "soft Korean webtoon, semi-realistic faces, warm watercolor texture, pastel cafe lighting, two characters in frame").
- 이미지가 없으면 기본값: "soft warm Korean webtoon illustration, semi-realistic, gentle watercolor, pastel cozy lighting".
- flow: Hook | Pain | Step | Result | CTA 중 하나.
- role: 그 카드의 역할을 한 줄로(예: "강한 약속", "공감 후킹", "해결 제시", "행동 유도").
- watermark: 일반 카드는 "@business_career_consulting", 마지막 CTA 카드만 "BCC · @business_career_consulting".

반드시 지정된 JSON 스키마에 맞춰서만 출력한다. 설명 문장이나 마크다운 없이 JSON 객체만 출력한다.`;

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
      },
      required: ['purpose', 'intent', 'total', 'style_hint'],
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
      { type: 'text', text: header + '# 원본 콘텐츠\n첨부 이미지(들)는 반응이 좋았던 카드뉴스/게시글 캡처다. 이미지 속 메시지·구조·흐름을 읽고, 저작권 규칙대로 표현을 100% 새로 써서 BCC 카드뉴스로 재구성하라.' },
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

    // 장수 안전장치(혹시 9장 이상이면 8장으로 자른다)
    if (Array.isArray(result.cards) && result.cards.length > 8) {
      result.cards = result.cards.slice(0, 8).map((c, i) => ({ ...c, no: i + 1 }));
      if (result.meta) result.meta.total = result.cards.length;
    }

    return res.json(result);
  } catch (err) {
    console.error('cardnews-generate error:', err?.message || err);
    const status = err?.status === 429 ? 429 : 500;
    return res.status(status).json({ error: status === 429 ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.' : '생성 중 오류가 발생했습니다.' });
  }
}
