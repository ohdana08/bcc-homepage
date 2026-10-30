// 봇별 결과물 생성 규칙 — 브라우저 안에서만 동작. AI 호출 없음.
const L = (s) => (s || '').toString().trim();
const first = (s, n = 40) => { const t = L(s).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n) + '…' : t; };
const short = (s) => first(s, 15);
const today = () => new Date().toLocaleDateString('ko-KR');
const hasBatchim = (s) => { const t = L(s).replace(/[^가-힣A-Za-z0-9)]+$/g, ''); const ch = t.replace(/[)\]]+$/,'').slice(-1); if (!ch) return false; const c = ch.charCodeAt(0); if (c >= 0xAC00 && c <= 0xD7A3) return ((c - 0xAC00) % 28) !== 0; if (/[0-9]/.test(ch)) return '013678'.includes(ch); if (/[A-Za-z]/.test(ch)) return /[lmnrLMNR]/.test(ch); return false; };
const J = (s, a, b) => `${s}${hasBatchim(s) ? a : b}`; // J(x,'이','가')
const has = (s) => L(s) && !/^(없음|없어요|모름|모르겠|아직)/.test(L(s));

export const generators = {
  'cardnews-plan': (a) => `# 4장 카드뉴스 기획서

| 장 | 역할 | 제목 (1~2줄) | 본문 (2~4줄) |
|---|---|---|---|
| 1 | 관심 끌기 | ${first(a.one, 30)} | ${first(a.what, 60)}에 대해 꼭 하나만 알려드릴게요. |
| 2 | 공감 | ${first(a.pain, 30)} | ${first(a.barrier, 80)} 혼자 하면 여기서 막힙니다. |
| 3 | 해결 | 이렇게 하면 쉬워집니다 | ${first(a.gain, 100)} |
| 4 | 행동 | 지금 바로 | ${first(a.cta, 60)} |

## 카드별 문구 초안
**1장** ${first(a.one, 40)}
**2장** "${first(a.pain, 50)}" 그 순간, 가장 막막한 건 ${first(a.barrier, 50)}입니다.
**3장** ${J(first(a.what, 40),'을','를')} 하면 ${first(a.gain, 60)}
**4장** ${first(a.cta, 50)}

## 만들 때 지킬 것
- 제목은 짧고 강하게, 본문은 2~4줄. 마케팅 용어 쓰지 않기.
- 과장하지 않기. 내가 답한 내용 밖의 주장은 넣지 않기.
- Canva·Genspark에 붙여넣기 전에 각 장을 소리 내어 읽어보기.`,

  'press-release': (a) => {
    const t = L(a.type); const org = first(a.org, 60); const ev = first(a.event, 60); const when = first(a.when, 120); const key = first(a.key, 120);
    const lead = {
      '행사·프로그램 운영': `${J(org,'이','가')} ${J(ev,'을','를')} ${when} 운영한다.`,
      '모집·참여 안내': `${J(org,'이','가')} ${ev} 참여자를 모집한다. ${when}`,
      '성과 발표': `${J(org,'이','가')} ${ev}에서 ${key} 성과를 거뒀다고 밝혔다.`,
      '협약(MOU)': `${J(org,'이','가')} ${when} ${ev} 업무협약을 체결했다.`,
      '정책·사업 발표': `${J(org,'이','가')} ${J(ev,'을','를')} 추진한다고 밝혔다.`,
      '수상·선정': `${J(org,'이','가')} ${ev}에 선정됐다.`,
      '해명자료': `${J(org,'은','는')} ${ev}과 관련해 다음과 같이 밝혔다.`,
    }[t] || `${J(org,'이','가')} ${J(ev,'을','를')} ${when} 진행한다.`;
    return `# 보도자료 초안 (${t || '유형 미정'})

**제목:** ${org}, ${ev} ${t === '모집·참여 안내' ? '참여자 모집' : t === '협약(MOU)' ? '업무협약 체결' : t === '성과 발표' ? '성과 발표' : '개최'}
**부제 1:** ${key}
**부제 2:** ${when}

${lead} ${key ? `이번 ${J(ev,'은','는')} ${J(key,'이','가')} 특징이다.` : ''}

${org}에 따르면 ${J(ev,'은','는')} ${when} 진행되며, (참여 대상·프로그램 내용·기대 효과를 여기에 2~3문장으로 적으세요).

${org} 관계자는 "(담당자 인용문 한 문장)"이라고 말했다.

---
보도 희망일·문의: ${first(a.contact, 80) || '(기관 담당자 연락처)'}

## 다듬을 때 규칙
- 리드문 한 문장에 누가·무엇을·언제·어디서가 들어가야 합니다.
- 되었다→됐다, 하였다→했다. 주관적 표현 빼기.
- 괄호 안은 반드시 사실로 채우고 비우지 마세요.`;
  },

  'instagram-profile': (a) => {
    const type = L(a.type); const item = first(a.item, 24);
    const l3 = type.startsWith('전문가') ? `${item} ○년 · 실제 사례로 설명` : type.startsWith('친근') ? `동네에서 직접 만드는 ${item}` : type.startsWith('결과') ? `후기 ○○건 · 사진으로 확인` : `${item} 하는 사람`;
    const cta = L(a.cta).startsWith('DM') ? 'DM으로 편하게 물어보세요 💬' : L(a.cta).startsWith('링크') ? '예약·구매는 아래 링크 👇' : '저장해두면 필요할 때 보여요 🔖';
    return `# 인스타 프로필 4줄 초안

1. ${item} | ${first(a.situation, 20)}일 때 찾는 곳
2. ${first(a.situation, 40)} → 이렇게 해결해 드려요
3. ${l3}
4. ${cta}

## 대안 (유형: ${type || '미정'})
- 1줄 대안: "${first(a.situation, 18)} 고민이면 여기"
- 3줄 대안: "${item} 전문 · 오늘도 ○명이 다녀감" (숫자는 사실만)

## 규칙
- 한 줄 20자 안팎, 이모지는 줄당 1개 이하.
- ○ 자리는 실제 숫자로만 채우고, 없으면 그 줄을 빼세요.`;
  },

  'customer-persona': (a) => {
    const item = first(a.item, 60); const target = first(a.target, 80);
    const v = (name, axis, worry, tried, interest) => `### ${name}
- 이름: (한국인 이름으로 지어주세요)
- 나이·가족관계: ${target} 중 해당하는 사람
- 직업·생활: ${target}
- 구매 동기 축: ${axis}
- 고민: ${worry}
- 시도해 본 것: ${tried}
- 관심사·보는 채널: ${interest}
- 얼굴: (저작권 자유 이미지로 대체)
`;
    return `# 고객 페르소나 3버전 초안
아이템: ${item}

${v('[버전 A] 효율 중시형', '시간 아끼기', `${J(item,'이','가')} 필요한데 알아볼 시간이 없다`, '검색해서 상위 몇 개만 비교', '짧은 영상, 후기 요약')}
${v('[버전 B] 가성비 중시형', '돈 아끼기', `${item} 가격이 적정한지 확신이 없다`, '가격 비교, 쿠폰·할인 검색', '커뮤니티 추천글, 가격 비교')}
${v('[버전 C] 감성·경험 중시형', '만족감·인정', `${item}으로 내 기분·관계가 좋아지길 바란다`, '친구 추천, SNS에서 본 것 따라 하기', '인스타·블로그 후기, 분위기 사진')}
## 쓰는 법
- 세 버전 중 실제 고객과 가장 비슷한 하나를 고르고, 괄호와 추정 부분을 실제 관찰로 바꾸세요.
- 입력에 없는 소득·질병 같은 민감 정보는 넣지 마세요.`;
  },

  'customer-interview': (a) => {
    const item = first(a.item, 50); const stages = [
      ['문제 인식', `"${first(a.problem, 40)}" 이런 문제, 실제로 겪어보셨나요? 언제가 마지막이었나요?`],
      ['타겟 고객', `주변에서 이 문제를 가장 심하게 겪는 사람은 누구인가요? (${J(first(a.target, 30),'이','가')} 맞나요?)`],
      ['기존 해결 방식', `지금은 어떻게 해결하세요? ${has(a.current) ? `(${first(a.current, 30)} 말고 다른 방법도요)` : ''}`],
      ['차별성', `${J(item,'이','가')} 지금 방법보다 뭐가 나아야 바꾸시겠어요?`],
      ['대체재', '이거 말고 떠오르는 다른 선택지가 있나요?'],
      ['사용 시나리오', '실제로 쓴다면 하루 중 언제, 어디서 쓰실 것 같아요?'],
      ['지속 가능성', '한 달 뒤에도 계속 쓸 것 같나요? 귀찮아질 지점은 어디일까요?'],
      ['가격', '이걸 해결해 준다면 한 달에 얼마까지 낼 수 있나요? 1회·월정액 중 뭐가 편해요?'],
      ['신뢰·설득', '뭘 보여드리면 믿고 써보시겠어요? (후기, 체험, 보장 등)'],
      ['최종 구매 의사', '지금 바로 쓸 수 있다면 쓰시겠어요? 아니라면 이유 하나만요.'],
    ];
    return `# 고객 인터뷰 10단계 대본
아이템: ${item}
인터뷰 대상: ${first(a.target, 60)}

${stages.map(([t, q], i) => `**${i + 1}. ${t}**\n${q}\n→ 답: ______________________\n`).join('\n')}
## 끝나고 할 것
- 10개 답 중 "모르겠다/안 쓸 것 같다"가 3개 이상이면 아이템보다 문제 정의를 다시 보세요.
- 가격 답은 평균이 아니라 "가장 낮은 답"을 기준으로 잡으세요.
- 3명 이상 같은 질문으로 물어야 비교가 됩니다.`;
  },

  'business-filter': (a) => {
    const pay = L(a.paying); const test = L(a.test);
    const s1 = pay.startsWith('네') ? 2 : pay.startsWith('아니') ? 0 : 1;
    const s4 = test.startsWith('네') ? 2 : test.startsWith('아니') ? 0 : 1;
    const score = s1 + s4;
    const verdict = score >= 4 ? '통과 — 작게 바로 시험해 볼 만합니다' : score >= 2 ? '보완 필요 — 아래 빈칸을 먼저 채우세요' : '보류 — 지금은 돈 내고 해결할 문제인지 근거가 없습니다';
    return `# 사업 필터링 결과
아이템: ${first(a.item, 60)}
고객 문제: ${first(a.problem, 100)}

| 검증 | 답 | 점수 |
|---|---|---|
| 1. 고객이 지금도 돈을 쓰는 문제인가 | ${pay || '-'} | ${s1}/2 |
| 2. 반복해서 생기는 문제인가 | (확인 필요) | - |
| 3. 이미 시장에 해결책이 있는가 | (확인 필요: 있으면 내 방식이 뭐가 다른지) | - |
| 4. 1~2주 안에 작게 테스트 가능한가 | ${test || '-'} | ${s4}/2 |

**판정: ${verdict}**

## 다음 행동 (전문가 프레임)
${s1 < 2 ? '- 고객 3명에게 "이 문제에 지금 돈이나 시간을 쓰고 있나요?"를 물어보고 답을 적으세요.\n' : ''}${s4 < 2 ? '- 2주 안에 할 수 있는 가장 작은 테스트 하나를 정하세요. (예: 안내 페이지 1장 + 사전 신청 받기)\n' : ''}- 기존 해결책을 3개 찾아 "내 것은 뭐가 다른가"를 한 줄로 적으세요.
- 위 빈칸이 다 채워지면 다시 이 도구를 돌려보세요.`;
  },

  'ppt-plan': (a) => {
    const need = Array.isArray(a.need_raw) ? a.need_raw : [];
    return `# PPT 기획 초안
주제: ${first(a.topic, 60)} · 대상: ${first(a.audience, 40)}
목표 반응: ${first(a.goal, 80)}

## 흐름 (슬라이드 8~12장 기준)
1. 표지 — 주제 한 줄 + 발표자
2. 왜 지금 이 이야기인가 — ${J(first(a.audience, 30),'이','가')} 겪는 상황 1개
3. 핵심 메시지 1 — (근거 1개)
4. 핵심 메시지 2 — (근거 1개)
5. 핵심 메시지 3 — (근거 1개)
6. 사례·증거 — 사진·숫자·후기 중 실제 있는 것
7. 이렇게 해주세요 — "${first(a.goal, 50)}"로 이어지는 행동 1개
8. 마무리 — 한 문장 + 연락처

## 지킬 규칙
${has(a.rules) ? `- ${first(a.rules, 150)}\n` : ''}- 한 슬라이드에 메시지 하나, 글자 6줄 이하.
- 도움받고 싶은 것: ${first(a.need, 80) || '-'}
- 대상이 모르는 용어는 슬라이드에 쓰지 않기.`;
  },

  'video-storyboard': (a) => {
    const mood = L(a.mood); const style = mood.startsWith('귀엽') ? 'bright pastel colors, cute, playful, soft daylight' : mood.startsWith('영화') ? 'cinematic lighting, film look, shallow depth of field, moody' : mood.startsWith('웃기') ? 'exaggerated expression, comedic, vivid colors, dynamic angle' : 'clean, natural light, simple composition';
    const cut = (n, role, s) => `| ${n} | ${role} | ${first(s, 60)} | ${first(s, 60)}, ${style}, vertical 9:16, no text |`;
    return `# 4컷 콘티
느낌: ${mood || '추천 기본값(자연스럽게)'}

| 컷 | 역할 | 장면 | 이미지 프롬프트 (장면 설명은 영어로 바꿔 넣으세요) |
|---|---|---|---|
${cut(1, '첫 장면', a.s1)}
${cut(2, '변화', a.s2)}
${cut(3, '반전', a.s3)}
${cut(4, '마무리', a.s4)}

## 다음 할 일
- 프롬프트의 한국어 장면을 영어 한 문장으로 바꿔 Midjourney·Whisk 등에 넣으세요. (완성 프롬프트를 AI에 주면 번역까지 해 줍니다)
- 4컷 모두 같은 주인공·같은 장소 단어를 반복해야 그림이 이어집니다.`;
  },

  'storyboard-caption': (a) => {
    const m = first(a.mood, 10);
    const row = (n, role, s, c) => `**${n}컷 · ${role}** — ${first(s, 50)}\n- ${c[0]}\n- ${c[1]}\n- ${c[2]}\n`;
    return `# 컷별 자막 아이디어 (15자 이내, 한 화면 한 문장)
분위기: ${m || '-'}

${row(1, '상황', a.cut1, [`${short(a.cut1)}`, '이런 날 있잖아요', `${m} 시작`])}
${row(2, '변화', a.cut2, ['그런데 갑자기', `${short(a.cut2)}`, '여기서부터 달라져요'])}
${row(3, '반전', a.cut3, ['진짜요?', `${short(a.cut3)}`, '이건 예상 못 했죠'])}
${row(4, '마무리', a.cut4, [`${short(a.cut4)}`, '오늘도 이렇게', `${m} 끝`])}
## 고를 때
- 설명보다 감정. 친구에게 말하듯.
- 컷마다 하나만 고르고, 네 개를 이어 읽어 흐름이 되는지 확인하세요.`;
  },

  'customer-psychology': (a) => `# 고객 심리 심층분석 초안
아이템: ${first(a.item, 60)}
페르소나: ${first(a.persona, 100)}

## 1단계 상황 추출
${first(a.pain, 200)}

## 2단계 감정 추론 (상황에서 나올 법한 감정 — 실제 고객 말로 확인하세요)
- 답답함: "해봤는데 안 된다"
- 불안: "이번에도 돈만 쓰는 거 아닐까"
- 조급함: "남들은 벌써 하고 있는데"

## 3단계 욕구 변환 (핵심 욕구 3~5개)
1. 빨리 결과를 보고 싶다
2. 실패해도 손해가 작았으면 좋겠다
3. 누가 옆에서 봐줬으면 좋겠다
4. (제품 정보 "${first(a.info, 40)}"에서 나오는 욕구 1개)
5. (시장조사 "${first(a.market, 30) || '없음'}"에서 나오는 욕구 1개)

## 4단계 심리장벽 (최소 5개)
| 장벽 | 고객 속마음 | 무너뜨리는 한 문장 |
|---|---|---|
| 가격 | 이 돈 쓸 만큼 효과 있을까 | (결과물·보장으로 답) |
| 시간 | 바빠서 못 할 것 같다 | (최소 시간·순서로 답) |
| 효과 의심 | 나한테도 될까 | (비슷한 고객 사례로 답) |
| 귀찮음 | 시작이 번거롭다 | (첫 단계를 아주 작게) |
| 주변 시선 | 괜히 유난 떠는 것 같다 | (같은 사람들이 이미 한다는 증거) |

## 5단계 전략
공감(상황 그대로 말하기) → 근거(사례·숫자) → 장벽 제거(위 표의 문장) → 작은 첫 행동 제안. 입력에 없는 숫자·후기는 만들지 마세요.`,

  'detail-page': (a) => {
    const st = L(a.stage); const n = /^(\d)/.exec(st)?.[1] || '0';
    const focus = { '1': '문제를 알게 하는 페이지 — 공감 70%, 제품 30%', '2': '관심을 키우는 페이지 — 이게 왜 다른지', '3': '비교에서 이기는 페이지 — 근거·비교표·후기', '4': '결제 직전 페이지 — 혜택·보장·지금 사야 할 이유' }[n] || '단계를 고르면 설득 논리가 정해집니다';
    const sections = n === '1' ? ['공감 장면', '문제가 커지는 이유', '해결의 방향', '가볍게 시작하기(무료·체험)'] : n === '2' ? ['한 줄 약속', '이런 분께', '다른 점 3가지', '어떻게 진행되나', '다음 행동'] : n === '3' ? ['한 줄 약속', '비교표', '사례·후기', '자주 묻는 질문', '행동 버튼'] : ['한 줄 약속', '지금 받는 혜택', '보장·환불', '마감·수량', '결제 버튼'];
    return `# 상세페이지 기획안
아이템: ${first(a.item, 60)} · 퍼널: ${first(a.funnel, 60)}
이 페이지의 단계: ${st || '미정'} → ${focus}

| 섹션 | 설득 목적 | 카피 초안 | 이미지 |
|---|---|---|---|
${sections.map((s, i) => `| ${i + 1}. ${s} | ${i === 0 ? `${first(a.persona, 30)}의 "${first(a.pain, 30)}"에 말 걸기` : '(목적 한 줄)'} | (초안 1~2문장) | (사진·그래픽 설명) |`).join('\n')}

## 후커블(Hookable) 입력용
- 제품명: ${first(a.item, 40)}
- 카테고리: (선택)
- 핵심 특징 3: (1) (2) (3)
- 타겟: ${first(a.persona, 60)}
- 페인포인트: ${first(a.pain, 80)}
- 섹션 구성: ${sections.join(' → ')}
- 이미지 콘셉트: (톤·배경·모델 유무)

과장·의료 효능 단정 표현은 쓰지 마세요. 추정한 부분은 "(추정)"으로 표시하세요.`;
  },

  'business-process': (a) => {
    const item = first(a.item, 60); const cust = first(a.customer, 60);
    const dm = has(a.market) ? `있음 — ${first(a.market, 80)}` : '[아직 조사 전] 시장 규모·비슷한 곳·추세를 찾아 채우세요';
    const dv = has(a.voice) ? `있음 — ${first(a.voice, 80)}` : '[아직 조사 전] 비슷한 사람 3~5명에게 10분만 물어보세요';
    return `# 나의 사업 설계 초안

▶ 아이템: ${item}
▶ 첫 번째 고객: ${cust}
▶ 우리가 해결해주는 문제: (${J(cust,'이','가')} 가장 힘든 것 한 줄)
▶ 데이터 현황: 시장조사 — ${dm} / 고객 이야기 — ${dv}
▶ 목표 지원사업·기간: ${first(a.program, 60) || '(미정)'}

## 사업 흐름
| 시기 | 목표 | 할 일 3가지 |
|---|---|---|
| 처음 3개월 | 한 명에게 "된다" 증명 | ① ${item} 맛보기 버전 만들기 ② ${J(cust,'이','가')} 모인 곳에 알리기 ③ 첫 고객 5명에게 "괜찮네" 듣기 |
| 4~8개월 | 같은 걸 10명에게 반복 | ① 잘 된 방식 순서표로 적기 ② 재구매·소개 받기 ③ 가격·구성 다듬기 |
| 9~12개월 | 나 없어도 굴러가게 | ① 매뉴얼·시스템 만들기 ② 사람·파트너 정하기 ③ 다음 고객층 1개 추가 |

## 필요한 것 (핵심자원)
- ① 물건·장비: (3~5개)
- ② 노하우·콘텐츠: (3~5개)
- ③ 사람: (누가, 몇 명)
- ④ 돈: (처음 3개월 기준)

## 예산 초안
| 항목 | 쓰는 데 | 대략 얼마 | 연결 활동 |
|---|---|---|---|
| 재료비 | | 원 | 처음 3개월 ① |
| 외주비 | | 원 | |
| 홍보비 | | 원 | 처음 3개월 ② |
| 합계 | | 원 | |

괄호와 빈칸은 내 아이템에 맞게 고쳐 쓰세요. 어려운 말이 나오면 완성 프롬프트로 AI에게 쉽게 풀어달라고 하세요.`;
  },

  'self-awareness': (a) => `# 탐색 → 인정 → 전환
작성일: ${today()}

- **탐색** (지금 가장 답답한 것): ${first(a.worry, 200)}
- **인정** (걸리는 말 "${first(a.word, 30)}"은 ${L(a.control) || '구분 전'})
- **전환** (지금 당장 할 한 가지): ${first(a.action, 150)}

통제할 수 없는 것은 내려놓고, "${first(a.action, 60)}"만 오늘 합니다.`,
};

// ---------- 대화형 코치 14개 (규칙 조립) ----------
const P = (s) => L(s).replace(/\s+/g, ' ');
const sent = (s) => { const t = P(s); if (!t) return ''; return /[.!?다요]$/.test(t) ? t : t + '.'; };
const formal = (t) => t
  .replace(/했어요$/, '했습니다').replace(/됐어요$/, '됐습니다').replace(/였어요$/, '였습니다').replace(/있어요$/, '있습니다').replace(/없어요$/, '없습니다')
  .replace(/(예요|에요)$/, '입니다').replace(/해요$/, '합니다').replace(/줘요$/, '줍니다').replace(/봐요$/, '봅니다').replace(/와요$/, '옵니다').replace(/가요$/, '갑니다')
  .replace(/([가-힣])(어요|아요)$/, (m, c, e) => { const j = (c.charCodeAt(0) - 0xAC00) % 28; return j === 20 ? c + '습니다' : c + (e === '어요' ? '었습니다' : '았습니다'); }).replace(/죠$/, '지요').replace(/(았|었|였|했|됐|왔|갔|봤)음$/, '$1습니다').replace(/([가-힣])음$/, (m,c)=>{const j=(c.charCodeAt(0)-0xAC00)%28; return j===0? c+'았습니다' : c+'었습니다';}).replace(/함$/, '했습니다').replace(/됨$/, '됐습니다').replace(/임$/, '입니다');
const sentTo = (s) => { let t = P(s); if (!t) return ''; t = t.replace(/[.!?~]+$/, '').trim(); t = formal(t); if (/(습니다|니다|지요)$/.test(t)) return t + '.'; if (/(았|었|였|했|됐|있|없|갔|왔|봤|났|졌)다$/.test(t)) return t.replace(/다$/, '습니다') + '.'; if (/는다$/.test(t)) return t.replace(/는다$/, '습니다') + '.'; if (/[가-힣]다$/.test(t)) { const c = t.slice(-2, -1); const code = c.charCodeAt(0) - 0xAC00; const jong = code % 28; if (jong === 4) { const base = String.fromCharCode(0xAC00 + (code - 4) + 17); return t.slice(0, -2) + base + '니다.'; } if (jong === 0) { return t.slice(0, -2) + String.fromCharCode(0xAC00 + code + 17) + '니다.'; } } if (/[가-힣]다$/.test(t)) return t.replace(/다$/, '습니다') + '.'; return t + '였습니다.'; };
const cnt = (s) => s.replace(/\s/g, '').length;
const lenNote = (s) => `\n\n(공백 제외 ${cnt(s)}자${cnt(s) < 800 ? ' — 1000자에 모자라면 행동·결과 부분에 구체적 장면을 한두 문장 더 넣으세요' : cnt(s) > 1150 ? ' — 1000자를 넘으면 상황 설명을 줄이세요' : ''})`;
const READ = '이 글을 꼭 소리 내어 읽어보며, 내 말투처럼 자연스러운지 확인하고 어색한 표현은 직접 수정해보시길 추천드립니다.';
const list = (s) => L(s).split(/[,\n、·;/]+/).map(x => x.trim()).filter(Boolean);
const essayWrap = (title, paras, foot) => `# ${title}\n\n${paras.filter(Boolean).join('\n\n')}\n\n${foot || READ}` ;

Object.assign(generators, {
  'cover-strength': (a) => {
    const body = [
      `${sentTo(a.story)} 이 경험은 제 장점인 '${P(a.keyword)}'${hasBatchim(a.keyword)?'이':'가'} 가장 잘 드러난 순간이었습니다.`,
      `그 상황에서 제가 맡은 것은 분명했습니다. ${sentTo(a.action)}${has(a.judge) ? ` 행동에 앞서 ${sentTo(a.judge)}` : ''}`,
      `${has(a.principle) ? `제 기준은 하나였습니다. ${sentTo(a.principle)} ` : ''}${has(a.hard) ? `쉽지 않은 순간도 있었습니다. ${sentTo(a.hard)} ` : ''}${sentTo(a.effect)}`,
      `결과적으로 ${sentTo(a.result)} 저는 "나는 ${P(a.keyword)}${hasBatchim(a.keyword)?'을':'를'} 가진 사람이다"라고 말하기보다, 이렇게 행동해 왔다는 사실로 제 장점을 보여드리고 싶습니다.`,
    ];
    const t = essayWrap(`성격의 장점 — ${P(a.keyword)}`, body);
    return t + lenNote(body.join(' ')).replace(/\n\n/, '\n\n') + `\n\n## 어떻게 만들었나\n위 글은 적어주신 문장을 S(상황)→T(역할)→A(행동)→R(결과) 순서로 이어 붙인 것입니다. 괄호 없이 그대로 쓰되, 어색한 연결어는 바꾸세요.`;
  },
  'cover-growth': (a) => {
    const body = [
      `${P(a.role)} 직무에 관심을 갖게 된 것은 ${sentTo(a.when)} 그때의 경험이 지금까지 이어지는 출발점이었습니다.`,
      `관심은 행동으로 이어졌습니다. ${sentTo(a.first)} ${sentTo(a.study)}`,
      `직무를 더 잘 이해하기 위해 ${sentTo(a.practice)}${has(a.overcome) ? ` ${sentTo(a.overcome)}` : ''}`,
      `이 과정을 거치며 ${sentTo(a.grown)} 그래서 저는 ${P(a.role)} 직무가 제게 잘 맞는 일이라고 확신합니다.`,
    ];
    return essayWrap(`직무 성장과정 — ${P(a.role)}`, body, '이 글을 한 번 소리 내어 읽어보면서, 내 말투처럼 자연스러운지 직접 확인하고 필요한 부분은 수정해보시길 추천드립니다.') + lenNote(body.join(' '));
  },
  'cover-aspiration': (a) => {
    const plans = Array.isArray(a.plans_raw) ? a.plans_raw : list(a.plans);
    const pl = plans.slice(0, 3);
    const body = [
      `입사 직후 1~3개월은 ${P(a.company)} ${P(a.role)} 직무의 전체 흐름을 익히는 데 집중하겠습니다.${has(a.jd) ? ` 채용공고에 적힌 실제 업무인 '${first(a.jd, 60)}'를 기준으로 기본 역량과 협업 방식, 보고 체계를 먼저 파악하겠습니다.` : ' 직무 전반, 기본 역량, 협업 방식, 조직의 프로세스를 먼저 파악하겠습니다.'}`,
      `첫 1년은 실제 기여에 집중하겠습니다. ${pl.map((p, i) => `${['첫째', '둘째', '셋째'][i]}, ${p.replace(/하기$/, '하겠습니다').replace(/두기$/, '두겠습니다').replace(/줄이기$/, '줄이겠습니다').replace(/만들기$/, '만들겠습니다').replace(/익히기$/, '익히겠습니다').replace(/제출하기$/, '제출하겠습니다').replace(/이수하기$/, '이수하겠습니다').replace(/확인받기$/, '확인받겠습니다').replace(/정리하기$/, '정리하겠습니다').replace(/추적하기$/, '추적하겠습니다')}`).join(' ')} 이 세 가지는 신입인 제가 지금 당장 시작할 수 있고, 꾸준히 하면 팀에 보탬이 된다고 자신하는 일입니다.`,
      `3년 안에는 ${sentTo(a.goal3)} 회사의 방향과 제 성장이 같은 곳을 보도록, 실적으로 말할 수 있는 ${P(a.role)} 전문가가 되겠습니다.`,
    ];
    let t = essayWrap(`입사 후 포부 — ${P(a.company)} ${P(a.role)}`, body, '이 포부를 소리 내어 읽으며 "실제로 내가 할 수 있는가?"를 반드시 점검해보세요.') + lenNote(body.join(' '));
    if (!has(a.jd)) t += `\n\n## 채용공고 실제 업무 찾는 법\nPerplexity나 검색창에 아래를 그대로 붙여넣으세요.\n> "${P(a.company)} ${P(a.role)}" 두 기준으로 최근 3년 이내 신입/경력 채용공고를 찾아 보여주고, 해당 직무가 실제로 수행하는 업무내용을 전부 찾아줘.\n\n찾은 내용을 넣고 이 도구를 다시 돌리면 첫 문단이 더 구체적으로 바뀝니다.`;
    return t;
  },
  'self-development': (a) => {
    const body = [
      `${P(a.role)} 직무를 준비하면서 가장 꾸준히 한 자기개발은 '${P(a.cat)}' 영역이었습니다. ${sentTo(a.s)}`,
      `목표는 분명했습니다. ${sentTo(a.t)} 그래서 ${sentTo(a.a)}${has(a.a2) ? ` ${sentTo(a.a2)}` : ''}`,
      `그 결과 ${sentTo(a.r)}`,
      `이 경험은 ${P(a.role)} 직무에서 요구하는 역량과 바로 연결됩니다. ${sentTo(a.plan)}`,
    ];
    return essayWrap(`자기개발 경험 — ${P(a.role)}`, body, '이 경험이 실제 직무 수행에 어떻게 이어질 수 있는지 한 번 더 점검해보시길 바랍니다.') + lenNote(body.join(' '));
  },
  'cover-motivation': (a) => {
    const els = Array.isArray(a.elements_raw) ? a.elements_raw : list(a.elements);
    const body = [
      `${P(a.company)}에 지원한 이유는 ${els.join(', ')}에 있습니다. ${sentTo(a.why)}`,
      `그중에서도 ${P(a.role)} 직무를 선택한 것은 ${has(a.research) ? `조사 과정에서 확인한 '${first(a.research, 80)}' 때문입니다.` : '이 직무가 회사의 방향 안에서 맡는 역할이 분명하다고 판단했기 때문입니다.'}`,
      `제 경험도 이 방향과 맞물립니다. ${sentTo(a.exp)}`,
      `입사 후에는 ${sentTo(a.contrib)} 회사와 직무, 그리고 제 경험이 한 방향을 향한다는 점이 제가 ${P(a.company)} ${P(a.role)}에 지원하는 이유입니다.`,
    ];
    let t = essayWrap(`지원동기 — ${P(a.company)} ${P(a.role)}`, body, '이 글을 꼭 소리 내어 읽어보며 어색한 부분이나 나답지 않은 부분이 있는지 확인해보세요.') + lenNote(body.join(' '));
    if (!has(a.research)) {
      const pr = ['수익구조: 회사의 최근 3년 수익구조, 주력 제품·서비스, 매출 구조, 이 직무가 수익에 어떻게 기여하는지', '고객군·시장: 주요 고객군, 활동 시장, 고객이 이 회사를 선택하는 이유, 직무가 고객가치를 높이는 역할', '경쟁우위: 경쟁사 대비 차별점 3가지, 직무가 경쟁력을 강화하는 역할', '리스크·성장기회: 당면한 리스크와 성장 기회, 직무가 기여할 수 있는 지점', '실제 업무 흐름: 세부 업무, 협업 방식, 보고 체계, 핵심 역할', '중·장기 전략: 중장기 전략, 신사업 방향, 직무의 향후 역할', '조직문화: Blind·잡플래닛 리뷰 기준으로 누가 오래 다니고 왜 퇴사하는지, 직무의 조직 내 위치'];
      t += `\n\n## 조사 프롬프트 7개 (Perplexity에 하나씩 붙여넣기)\n${pr.map((x, i) => `${i + 1}. "${P(a.company)} + ${P(a.role)}" 기준으로 ${x}를 찾아줘.`).join('\n')}\n\n조사 결과를 넣고 다시 돌리면 둘째 문단이 근거로 채워집니다.`;
    }
    return t;
  },
  'issue-opinion': (a) => {
    const side = P(a.side);
    const body = [
      `최근 가장 눈에 들어온 이슈는 '${P(a.issue)}'입니다. 쉽게 말하면 ${sentTo(a.simple)}`,
      `${sentTo(a.who)}`,
      `저는 이 이슈를 ${side.replace(/다$/, '')}는 쪽에 가깝습니다. ${sentTo(a.reason)}`,
      `그래서 저는 ${sentTo(a.solution)}`,
      `정리하면, 저는 "${P(a.oneline).replace(/\.$/, '')}"라고 생각합니다. ${P(a.role)} 직무에서도 이런 관점으로 문제를 바라보고 제 역할을 찾겠습니다.`,
    ];
    return essayWrap(`국내외 이슈에 대한 생각 — ${first(a.issue, 30)}`, body, '이 글을 꼭 한 번 소리 내어 읽어보며, 나다운 말투인지 확인하고 어색한 부분은 직접 수정해보시길 추천드립니다.') + lenNote(body.join(' '));
  },
  'conflict-collab': (a) => {
    const body = [
      `${P(a.cat)}에서 사람들과 함께 일했던 경험입니다. ${sentTo(a.story)}`,
      `처음에 ${sentTo(a.first)} 그런데 ${sentTo(a.problem)}`,
      `그때 저는 ${sentTo(a.response)}${has(a.judgment) ? ` 그렇게 한 기준은 ${sentTo(a.judgment)}` : ''}`,
      `${sentTo(a.result)}`,
      `이 경험으로 ${sentTo(a.learned)} 협업에서 갈등은 피할 일이 아니라 행동으로 풀어야 할 일이라는 것을 배웠습니다.`,
    ];
    return essayWrap('협업과 갈등 극복 경험', body, '이 글을 꼭 한 번 소리 내어 읽어보며, 나다운 말투인지 확인하고 어색한 부분은 직접 수정해보시길 추천드립니다.') + lenNote(body.join(' '));
  },
  'job-analysis': (a) => {
    const req = { K: list(a.reqK), S: list(a.reqS), A: list(a.reqA) }; const mine = { K: list(a.myK), S: list(a.myS), A: list(a.myA) };
    const norm = (x) => x.replace(/\s|\(.*?\)/g, '').toLowerCase();
    const match = (r, pool) => { const rn = norm(r); let best = null; for (const m of pool) { const mn = norm(m); if (!mn) continue; if (rn === mn || rn.includes(mn) || mn.includes(rn)) return { m, st: '○' }; const toks = rn.match(/[가-힣a-z0-9]{2,}/g) || []; if (toks.some(t => mn.includes(t))) best = { m, st: '△' }; } return best || { m: '-', st: '△' }; };
    const rows = []; let ok = 0, lack = 0;
    for (const k of ['K', 'S', 'A']) for (const r of req[k]) { const x = match(r, mine[k].concat(mine.K, mine.S, mine.A)); if (x.st === '○') ok++; else lack++; rows.push(`| ${r} | ${x.m} | ${x.st} | ${k} |`); }
    const used = new Set(rows.map(r => r.split('|')[2].trim())); const surplus = [...mine.K, ...mine.S, ...mine.A].filter(m => !used.has(m));
    const tasks = list(a.tasks);
    return `# "${P(a.role)}" 직무분석 5요소

**직무명:** ${P(a.role)}
**핵심 과업 3가지**
${tasks.slice(0, 3).map((t, i) => `${['①', '②', '③'][i]} ${t}`).join('\n')}
**요구 KSA**
- K (지식): ${req.K.join(', ') || '-'}
- S (기술): ${req.S.join(', ') || '-'}
- A (태도): ${req.A.join(', ') || '-'}
**성과지표·성장 경로:** ${P(a.kpi) || '(채용공고에 없으면 선배·현직자에게 물어보세요)'}

## 요구 KSA × 내 KSA 매핑표
| 요구 KSA | 내 KSA (경험) | 상태 | 구분 |
|---|---|---|---|
${rows.join('\n') || '| (요구 KSA를 적어주세요) | | | |'}

- ○ 일치: ${ok}개 · △ 부족: ${lack}개 · × 잉여(요구에 없는 내 강점): ${surplus.length ? surplus.join(', ') : '없음'}
- 🏆 자기소개서 핵심 소재: ${rows.find(r => r.includes('| ○ |'))?.split('|')[1].trim() || '(○ 항목이 생기면 그것부터)'}
- ⚠️ 가장 먼저 보완할 것: ${rows.find(r => r.includes('| △ |'))?.split('|')[1].trim() || '없음'} → 관련 경험을 작게라도 만들어 다음 지원 전에 △를 ○로 바꾸세요.

${has(a.jd) ? '' : '## 채용공고가 없다면\n잡코리아·사람인·원티드에서 직무명으로 검색해 최근 1년 공고 3개의 "주요업무·자격요건·우대사항"을 복사해 두세요. 세 공고에 공통으로 나오는 항목이 진짜 요구 KSA입니다.\n'}
매칭은 단어 겹침으로 판정한 것이라 뜻이 같아도 △로 나올 수 있습니다. 표를 보며 직접 ○/△를 고쳐 워크북에 옮기세요.`;
  },
  'ksa-extract': (a) => {
    const rows = [1, 2, 3].map(n => ({ cat: P(a[`c${n}cat`]), K: P(a[`c${n}content`]), S: P(a[`c${n}howto`]), R: P(a[`c${n}result`]), A: P(a[`c${n}att`]) })).filter(r => r.cat);
    return `# KSA 표 — ${P(a.role)}

| 경험 | K (지식) — 무엇을 알게 됐나 | S (기술) — 어떻게 했나 | A (태도) | 정량 성과 |
|---|---|---|---|---|
${rows.map(r => `| ${r.cat} | ${r.K} | ${r.S} | ${r.A} | ${r.R} |`).join('\n')}

## 워크북 1페이지에 옮길 때
- K에는 "~을 안다/이해한다"로 끝나는 지식만, S에는 "~을 할 수 있다"로 끝나는 행동만 적으세요.
- S 칸의 문장이 가장 중요합니다. "후배에게 알려주듯" 적은 방법·순서·요령이 곧 자기소개서의 행동 근거입니다.
- 숫자가 없는 성과는 기간·횟수·인원이라도 적어 넣으세요.

## 다음 단계
이 표를 복사해 「직무분석 5요소 + 매핑표」 도구의 "내 K/S/A" 칸에 붙여넣으면 채용공고 요구 KSA와 비교됩니다.`;
  },
  'value-worldcup': (a) => {
    const pick = (n) => (L(a[`q${n}`]).startsWith('B') ? 'B' : 'A');
    const axes = [
      ['💰 경제적 보상', [[1, 'B'], [7, 'B']], ['수입보다 여유·의미·관계를 우선하는 타입이에요.', '돈이 전부는 아니지만 최소한의 경제적 만족은 필요한 타입이에요.', '노력한 만큼 수입으로 돌아오는 구조에서 동기부여가 되는 타입이에요.']],
      ['🛡️ 안정성', [[2, 'A'], [11, 'A']], ['안정보다 도전과 가능성을 더 중요하게 여겨요.', '안정도 중요하지만 어느 정도 변화는 감수할 수 있어요.', '예측 가능하고 변화가 적은 환경에서 더 잘 집중하는 타입이에요.']],
      ['🌱 성장/변화', [[3, 'B'], [11, 'B']], ['한 분야를 깊게 파는 쪽이 편해요.', '새로운 일과 익숙한 일이 적당히 섞이면 좋아요.', '매년 다른 일을 맡으며 배우는 환경에서 살아나는 타입이에요.']],
      ['🏆 인정/성취', [[2, 'B'], [5, 'B']], ['이름이 드러나는 것보다 조용히 기여하는 쪽이 편해요.', '인정은 좋지만 그것 때문에 일하지는 않아요.', '내 이름으로 결과가 남고 인정받을 때 힘이 나는 타입이에요.']],
      ['🤝 관계/소속', [[4, 'A'], [9, 'B']], ['혼자 집중하는 환경이 더 맞아요.', '사람도 일도 둘 다 중요해요.', '함께 일하는 사람과 분위기가 일의 만족을 크게 좌우하는 타입이에요.']],
      ['🎯 자율/직무적합', [[5, 'B'], [8, 'A']], ['회사 이름·조건이 일 내용보다 앞서요.', '조건과 일 내용을 같이 봐요.', '조건이 조금 나빠도 하고 싶은 일을 고르는 타입이에요.']],
      ['💡 의미/사회기여', [[6, 'A'], [10, 'B']], ['의미보다 실력·결과가 먼저예요.', '의미가 있으면 좋지만 필수는 아니에요.', '내 일이 누군가에게 도움이 된다는 감각이 오래 버티는 힘이 되는 타입이에요.']],
      ['⚡ 창의/주도성', [[10, 'A'], [3, 'B']], ['정해진 틀 안에서 안정적으로 일하는 게 편해요.', '만드는 일과 지원하는 일 둘 다 할 수 있어요.', '직접 만들고 주도할 때 가장 몰입하는 타입이에요.']],
    ];
    const res = axes.map(([name, qs, txt]) => { const sc = qs.reduce((t, [n, want]) => t + (pick(n) === want ? 5 : 1), 0); const lvl = sc >= 7 ? 2 : sc >= 4 ? 1 : 0; return { name, sc, bar: '█'.repeat(sc) + '░'.repeat(10 - sc), txt: txt[lvl], lvl }; });
    const top = [...res].sort((x, y) => y.sc - x.sc).slice(0, 3);
    return `# 🧭 당신의 직업가치관 지도

| 가치관 축 | 점수 | |
|---|---|---|
${res.map(r => `| ${r.name} | ${r.bar} | ${r.sc}/10 |`).join('\n')}

## 내 가치관 축, 이게 무슨 의미냐면요
${res.map(r => `- **${r.name}** (${['낮음', '보통', '높음'][r.lvl]}) — ${r.txt}`).join('\n')}

## 가장 높은 3가지
${top.map((r, i) => `${i + 1}. ${r.name} ${r.sc}/10`).join('\n')}

## 이렇게 써보세요
- 채용공고를 볼 때 위 3가지가 충족되는지부터 확인하세요. 연봉·네임밸류보다 이 축이 안 맞으면 오래 못 갑니다.
- 11개 중 "둘 다요"였던 질문이 있다면, 비슷한 상황을 겪었던 아르바이트·동아리 경험을 떠올려 다시 골라보세요. 점수가 달라질 수 있습니다.
- 점수는 질문 2개로 계산한 것이라 참고용입니다. 정답은 없어요.`;
  },
  'naver-blog': (a) => {
    const t = P(a.topic); const who = P(a.who); const intent = P(a.intent);
    const kwI = [`${t} 뜻`, `${t} 처음`, `${t} 어떻게`]; const kwD = [`${t} 추천`, `${t} 후기`, `${t} 강의`];
    const titles = [`${t}, 처음이라면 이것부터 (검색형)`, `${t} 해보고 알게 된 것 — ${first(a.change, 18)} (경험형)`, `${first(a.wrong, 20) || `${t} 이렇게 하면 안 됩니다`} (후킹형)`, `매일 ${t} 하는데 왜 안 될까? 직접 겪은 이유 (홈피드형)`, `${t} 고민이라면 ${P(a.cta).replace(/하기$/, '')}부터 (전환형)`];
    return `# 네이버 블로그 글 설계 — ${t}

**[주제]** ${t}
**[대상]** ${who}
**[검색 의도]** ${intent}
**[실제 경험]** ${P(a.storytype)} — ${P(a.story)}
**[키워드 흐름]** 관심 단계: ${kwI.join(', ')} → 결정 단계: ${kwD.join(', ')}

## [제목] 5개 중 고르세요
${titles.map((x, i) => `${i + 1}. ${x}`).join('\n')}

## [본문 흐름]
1. **문제 발생** — ${sent(a.story)}
2. **검색** — 그래서 "${kwI[0]}", "${kwI[2]}"를 찾아봤습니다.
3. **시행착오** — ${has(a.wrong) ? sent(a.wrong) : '(처음에 잘못 생각했던 점을 한두 문장으로)'}
4. **깨달음** — ${sent(a.change)}
5. **팁** — ${J(who,'이','가')} 오늘 바로 해볼 수 있는 한 가지를 적으세요.
6. **CTA** — ${P(a.cta)}

## [썸네일]
사람 + 표정 + 상황 + 짧은 문구. 예: 😵 "${first(a.wrong, 16) || `${t} 매일 하는데 왜 안 되지?`}"

## 쓸 때 지킬 것
- 첫 3초 후킹, 사람 말투, 짧은 문장 섞기, 감정 포함.
- 키워드 반복·사전식 설명·경험 없는 정보 폭탄·광고로 시작하기 금지.
- 위 [실제 경험]이 본문의 절반 이상을 차지해야 사람 냄새가 납니다.`;
  },
  'item-discovery': (a) => {
    const txt = [a.paid, a.asked, a.effort, a.interest, a.pain].map(P).join(' ');
    const roles = [];
    if (/ppt|문서|정리|엑셀|자료|요약/i.test(txt)) roles.push('복잡한 걸 쉽게 정리해주는 역할');
    if (/상담|고민|이야기|들어|공감|연애/.test(txt)) roles.push('감정을 공감하고 들어주는 역할');
    if (/처음|초보|군대|입문|알려|가르|과외|설명/.test(txt)) roles.push('처음 하는 사람의 불안을 줄여주는 역할');
    if (/영상|편집|디자인|그림|사진|콘텐츠|블로그|sns|인스타/i.test(txt)) roles.push('보기 좋게 만들어 보여주는 역할');
    if (/요리|살림|육아|정리정돈|청소|예약|일정/.test(txt)) roles.push('귀찮은 일상 일을 대신 해결해주는 역할');
    if (/운동|다이어트|습관|꾸준|챌린지/.test(txt)) roles.push('꾸준히 하게 만들어주는 역할');
    if (!roles.length) roles.push('누군가 막혀 있을 때 먼저 손을 내미는 역할');
    const feels = Array.isArray(a.feeling_raw) ? a.feeling_raw : list(a.feeling);
    const clue = P(a.paid) || P(a.asked) || P(a.effort) || P(a.interest);
    const who = /처음|초보/.test(txt) ? '처음 시작하는 사람' : /직장|회사/.test(txt) ? '바쁜 직장인' : /학생|대학/.test(txt) ? '대학생' : '나와 비슷한 고민을 하는 사람';
    const cands = [`${who}에게 ${J(first(clue, 20),'을','를')} 쉽게 따라 하게 알려주는 형태 (PDF·체크리스트)`, `${J(who,'이','가')} "${first(a.pain, 20) || '이거 누가 대신 해줬으면'}"을 해결하도록 1:1로 도와주는 형태`, `${first(a.interest, 20) || t} 관련 작은 모임·챌린지·오픈채팅을 운영하는 형태`];
    return `# 아이템 발견 정리

## 사람들이 이미 당신에게 기대한 역할
${roles.map(r => `- ${r}`).join('\n')}
${feels.length ? `- 에너지를 받는 지점: ${feels.join(', ')}` : ''}

## 단서 정리
- 이미 해본 것: ${P(a.paid) || '-'} / 자주 받은 부탁: ${P(a.asked) || '-'}
- 노력해서 쌓은 것: ${P(a.effort) || '-'}
- 흥미·취향: ${P(a.interest) || '-'}
- 불편 경험: ${P(a.pain) || '-'}
${has(a.idea) ? `- 떠올랐던 아이템: ${P(a.idea)}` : ''}

## 아이템 후보 3개 (생활 언어로)
${cands.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## 한 줄 아이템 (빈칸을 채우세요)
"저는 **${who}**에게 **${first(a.pain, 25) || '______'}** 문제를 **${first(clue, 25) || '______'}** 방식으로 도와주는 **______**을 만들고 있어요."

## 사람 반응 미니 테스트 (3~5명에게)
1. 이거 얼마나 불편하세요? 2. 언제 제일 답답하세요? 3. 지금은 어떻게 해결하고 있어요? 4. 뭐가 제일 아쉬웠어요? 5. 이 제안 들었을 때 느낌 어때요? 6. 해결되면 뭐가 좋아질까요? 7. 돈 내고 해결할 생각 있으세요? 8. 있다면 얼마까지? 9. 어떤 방식이 편할까요? 10. 가볍게라도 해볼 생각 있나요? 11. 망설여지는 이유는? 12. 이런 거 제일 필요할 사람은 누구 같아요?

## 아주 작은 수익 구조
- 지금 당장 가능한 형태: PDF 1장 / 오픈채팅 / 1:1 도움 / 템플릿 / 소규모 모임 중 하나
- 첫 고객 후보: 위 미니 테스트에서 "돈 내겠다"고 한 사람
- 10만원 가능성: 1만원짜리 10명, 또는 5만원짜리 2명. 그 이상은 아직 생각하지 마세요.

지금은 완벽한 사업을 만드는 단계가 아니에요. 한 명 도와보기 → PDF 하나 만들기 → 후기 받기 → 반응 확인하기. 이 정도면 충분해요.`;
  },
  'customer-interview-mate': (a) => {
    const qs = ['이 문제, 얼마나 자주 겪으세요?', '해결이 늦어지면 어떤 손해가 생기나요?', '지금 해결 방법에서 가장 불편한 점은 뭔가요?', '이걸 해결해준다면 한 달에 얼마까지 낼 수 있나요?', '월정액, 1회 결제, 건별 결제 중 어떤 방식이 편하세요?', '지금 이 문제를 해결하려고 이미 돈을 쓰고 있나요? 쓰고 있다면 한 달에 얼마나?'];
    const ps = [['A', a.pa], ['B', a.pb], ['C', a.pc]].filter(([, v]) => has(v));
    return `# 고객 인터뷰 메이트 — 인터뷰 시트
아이템·문제: ${P(a.item)}
가격 가설: ${P(a.price) || '미정'}

${ps.map(([k, v]) => `## 페르소나 ${k} — ${P(v)}\n${qs.map((q, i) => `Q${i + 1}. ${q}\n→ `).join('\n')}\n\n고객 여정표\n| 단계 | 고객 행동 | 감정점수(1~5) | 불편한 점 | 포기할 것 같은 순간 |\n|---|---|---|---|---|\n| 알게 됨 | | | | |\n| 알아봄 | | | | |\n| 써봄 | | | | |\n| 계속 씀 | | | | |\n`).join('\n')}
## 3인 통합 시장 검증 보고서 (인터뷰 뒤 채우기)
| 항목 | A | B | C | 결론 |
|---|---|---|---|---|
| 문제 빈도 | | | | |
| 손해 크기 | | | | |
| 지불 의사(월) | | | | 가장 낮은 금액 기준 |
| 선호 결제 | | | | |
| 이미 쓰는 돈 | | | | |

판정 기준: 3명 중 2명 이상이 "이미 돈을 쓰고 있다"고 답하면 가설 유지, 아니면 문제 정의부터 다시.`;
  },
  'datalab-product': (a) => `# 네이버 데이터랩 상품기획 워크시트
출발점: ${P(a.field)} · 잘 아는 것: ${P(a.know)} · 투입 가능: ${P(a.budget)}
${has(a.cands) ? `떠오른 후보: ${P(a.cands)}` : ''}

## 1. 카테고리 찾기 (클릭 순서)
1. 브라우저 주소창에 https://datalab.naver.com 입력 → 엔터
2. 상단 검은 띠에서 "쇼핑인사이트" 클릭
3. 좌측 메뉴 "분야 통계" 클릭
4. 화면 중앙 "분야" 드롭다운 클릭 → 1차 카테고리 17개 확인
5. "${P(a.field)}"와 가장 가까운 1차 → 2차 → 3차 순으로 좁히기
6. 좁힌 카테고리 이름을 여기에 적기: 1차 ______ / 2차 ______ / 3차 ______

## 2. 트렌드 확인
3차 카테고리 선택 → 오른쪽 "기간" 최근 1년 → "조회하기".
- 추세: 상승 / 안정 / 하락 중 ______
- 계절성: 어느 달에 높나 ______
- 판단: 상승기 = 진입 추천, 피크 = 신중, 하락 = 위험

## 3. 상품 좁히기
좌측 "검색어 통계" → 분야(3차) 선택 → 기간 최근 3~6개월 → 조회 → 인기 검색어 상위 20개 적기.
쿠팡에서 같은 카테고리 베스트 Top 10 확인 → 두 목록에 공통으로 나오는 것: ______

**상품 후보 3개 + 가치 가설** ("텀블러"가 아니라 "회의 4개 있는 날 카페 안 가게 해주는 보온병"처럼)
1. ______ → 누구의 어떤 순간을 해결: ______
2. ______ → ______
3. ______ → ______

## 4. 진짜 고객 찾기 (댓글 통계)
데이터랩 메인 → 상단 "댓글 통계" → ① 섹션별 분포 ② 성별·연령별 분포(우리 섹션 선택) ③ 시간대별 분포 캡처.
- 가장 많이 반응하는 성별·연령: ______
- 그 사람이 겪는 상황 한 줄: ______

## 5. 1페이지 기획서
| 항목 | 내용 |
|---|---|
| 카테고리(3차) | |
| 상품 후보 | |
| 가치 가설 | |
| 핵심 고객 | |
| 트렌드 근거 | |
| 첫 테스트 | 소량 사입·사전 주문 중 ______ |
| 월 투입 | ${P(a.budget)} |

이 도구는 데이터를 추측하지 않습니다. 빈칸은 반드시 실제 화면을 보고 채우세요.`,
});
