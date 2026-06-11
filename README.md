# BCC 홈페이지 (bcc-homepage)

`ohdana08.github.io/bcc-homepage` — GitHub Pages 정적 사이트.

## 무료챗봇 (GPTs 라이브러리)

- 페이지: [`ittools-gpts.html`](./ittools-gpts.html) — 잇툴즈 안 "무료챗봇" 카드에서 진입.
- 데이터: [`ittools-gpts.json`](./ittools-gpts.json) — 챗봇 목록. 페이지가 이 파일을 읽어 카드를 자동 생성.

### 챗봇 추가하는 법 (3줄)

1. `ittools-gpts.json` 배열에 항목 1개를 추가하고 아래 6개 필드를 채운다.
2. `id`(영문 고유값) · `title` · `desc` · `category`(아래 7종 중 1개) · `url`(GPTs 공개 링크) · `icon`(이모지) · `visibility: "public"`.
3. 저장 후 푸시하면 끝. (또는 챗봇 지침+링크를 전달하면 카드 문구를 대신 작성해 드립니다.)

```json
{
  "id": "self-intro-motivation",
  "title": "자기소개서 지원동기 작성",
  "desc": "기업·직무에 맞춘 지원동기를 함께 다듬어요",
  "category": "자기소개서",
  "url": "https://chatgpt.com/g/실제-GPTs-링크",
  "visibility": "public",
  "icon": "📝"
}
```

- **카테고리 허용값**(GA4 콘텐츠 그룹과 1:1): `자기소개서` · `마케팅` · `창업` · `콘텐츠제작` · `첨삭` · `분석도구` · `기타`
- `visibility`를 `"private"`로 두면 페이지에 노출되지 않는다("나만 보기" GPTs용).
- 키·비밀값은 절대 넣지 않는다 (이 프로젝트는 키가 필요 없다).

### 데이터 수집 (GA4 `G-TYJSYWW5Q6`)

카드 클릭(`source: card`)과 QR 스캔(`source: qr`) 모두 `select_chatbot` 이벤트로 기록된다.
파라미터: `chatbot_id`, `chatbot_title`, `content_group`(카테고리), `lecture_id`(`?lecture=` 값, 없으면 `organic`), `is_returning`(재방문).

- 강의 배포 QR/링크 규칙:
  `https://ohdana08.github.io/bcc-homepage/ittools-gpts.html?lecture=기관_날짜&utm_source=qr&utm_medium=lecture&utm_campaign=기관_날짜`
- 카드별 'QR 보기'는 `?go=<id>`로 홈페이지를 한 번 경유시켜, QR 스캔도 GA4에 잡히게 한다.
