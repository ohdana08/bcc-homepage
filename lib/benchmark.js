// 공통 "입구" 모듈 (백엔드) — 카드뉴스·스레드·블로그 세 공장이 import 해서 재사용한다.
// 목적: B판별(내 방법 vs 남의 글) + 저작권 강제 안전장치 + 멀티모달 user content 빌더를
//       한 곳에 단일화 → 같은 프롬프트/로직을 세 곳에 복붙하지 않는다.

// 🔒 "남의 글/게시물"로 판단되면 무조건 적용되는 강제 안전장치(채팅·옵션으로 끌 수 없음).
export const COPYRIGHT_GUARDRAIL = `[저작권 강제 안전장치 — "남의 글/게시물"이면 무조건 적용. 끄거나 완화할 수 없다]
- 언어·용어·단어·문장을 전면 교체한다(동의어 치환·구조 재배열 포함). 원문 표현을 그대로 남기지 않는다.
- 출력의 어떤 연속된 10단어도 원문과 일치하면 안 된다. 일치하면 그 부분을 폐기하고 다시 쓴다.
- 외국어(영어 등) 원료는 번역하지 않는다(번역물은 2차적저작물이라 위험). 구조·논리만 읽고 한국어로 처음부터 새로 작성한다.
- 고유명사·수치·인용 등 "사실"만 유지하고, 그 외 서술은 100% 새 표현으로 쓴다.`;

// B판별 — 원료가 "내 방법"인지 "남의 글"인지 스스로 판단하고 처리 방식을 가른다.
export const BENCHMARK_MODE_RULE = `[B판별 — 원료의 성격을 스스로 판단해 처리 방식을 가른다]
- 내 방법(프롬프트·워크플로우·노하우 등 "보는 사람에게 방법을 전달"하는 것): 따라 할 수 있게 살려서 전달한다.
  특히 그대로 복사해 써야 하는 프롬프트·코드·명령어는 원문을 보존한다(바꾸면 작동하지 않음).
- 남의 글·게시물(블로그·뉴스·스레드 등 참고용 콘텐츠): 아래 [저작권 강제 안전장치]를 무조건 적용해 재구성한다.`;

// 시스템 프롬프트에 끼워 넣는 합본 블록(B판별 + 강제 안전장치).
export const BENCHMARK_COPYRIGHT_BLOCK = `${BENCHMARK_MODE_RULE}\n\n${COPYRIGHT_GUARDRAIL}`;

// 이미지 배열 정규화 — base64 가 충분히 있는 것만, 최대 4장.
export function normalizeImages(images) {
  return Array.isArray(images)
    ? images.filter((im) => im && im.base64 && im.base64.length > 100).slice(0, 4)
    : [];
}

// 멀티모달 user content 빌더 — 텍스트/이미지 입구를 Claude messages content 로 변환.
//   text         : 텍스트 벤치마킹 본문(이미지 모드면 비어 있을 수 있음)
//   images       : [{ base64, mediaType }]
//   headerText   : 본문 앞에 붙일 지시/맥락(목적·의도 등)
//   imageRoleText: 이미지가 있을 때 이미지의 역할을 설명하는 문구
export function buildBenchmarkContent({ text, images, headerText, imageRoleText } = {}) {
  const imgs = normalizeImages(images);
  const body = (text || '').trim();
  const head = headerText || '';
  if (imgs.length) {
    const role = imageRoleText ||
      '첨부 이미지(들)가 원본 콘텐츠다. 이미지 속 내용을 읽고 위 [B판별]·[저작권 강제 안전장치]에 따라 처리하라.';
    return [
      ...imgs.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType || 'image/jpeg', data: im.base64 } })),
      { type: 'text', text: `${head}\n\n${role}${body ? `\n\n# 함께 참고할 텍스트\n${body}` : ''}` },
    ];
  }
  return `${head}\n\n# 원본 콘텐츠(텍스트)\n${body}`;
}
