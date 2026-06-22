# 카드뉴스 공장 — 1단계 셋업 & 검증 가이드

> 1단계 = **② 구성표 품질 검증** (이미지·다운로드는 2~3단계). 스크립트를 넣으면 5~8장 구성표가 제대로 나오는지 확인하는 단계.

## 새로 추가된 파일
- `admin-cardnews.html` — 관리자 페이지(로그인 → 스크립트/목적/의도 입력 → 분석+구성표 표시)
- `api/cardnews-generate.js` — 토큰·관리자 검증 후 Claude 호출, 구성표 JSON 반환
- `package.json` — `@anthropic-ai/sdk` 추가됨

---

## 1) Supabase — 관리자 컬럼 추가

Supabase 대시보드 → **SQL Editor** 에서 한 번 실행:

```sql
-- profiles 에 관리자 플래그 추가 (이미 있으면 무시됨)
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 예림 계정을 관리자로 지정 (이메일은 실제 로그인 이메일로 교체)
update public.profiles
set is_admin = true
where id = (select id from auth.users where email = 'ohdana08@gmail.com');
```

> 전화번호로 로그인하는 계정이면 이메일 대신 `email = '01000000000@phone.bcc.kr'` 형태로 조회하세요.

확인:
```sql
select p.id, u.email, p.is_admin
from public.profiles p join auth.users u on u.id = p.id
where p.is_admin = true;
```

---

## 2) Vercel — 환경변수 추가

Vercel 프로젝트 → **Settings → Environment Variables** 에 추가:

| 이름 | 값 | 비고 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | https://console.anthropic.com → API Keys 에서 발급. **서버 전용** |
| `UNSPLASH_ACCESS_KEY` | (Access Key) | https://unsplash.com/developers → New Application → Access Key. **서버 전용**. 1탄 배경 사진용. 미설정 시 주제별 그라데이션 배경 |
| (없음) | — | 2탄 AI 일러스트는 **Pollinations AI(무료·키 불필요)** 사용. 별도 환경변수 필요 없음 |

추가 후 **재배포**(Deployments → 최신 빌드 Redeploy)해야 적용됩니다.

로컬 테스트도 하려면 `.env.local` 에도 같은 줄을 추가하세요(.gitignore 되어 안전).

---

## 3) 검증 (이게 1단계의 목적)

### 배포 환경
1. `https://ohdana08.github.io/bcc-homepage/admin-cardnews.html` 접속
2. 관리자 계정으로 로그인
3. **터진 유튜브/스레드 스크립트**를 붙여넣기 → 목적 선택 → 의도 한 줄 입력 → **구성표 생성**
4. 약 20~40초 후 결과 확인

### 로컬 환경 (선택)
```bash
cd bcc-homepage
npx vercel dev      # http://localhost:3000
```
- `pay-config.js` 의 `window.BCC_API_BASE` 를 잠시 `http://localhost:3000` 으로 바꿔 테스트(테스트 후 원복).
- `admin-cardnews.html` 을 로컬 서버로 열어서 동일하게 진행.

### 합격 기준 (눈으로 확인)
- [ ] **장수**: 5~8장 (9장 이상 안 나옴)
- [ ] **저작권**: 원본 스크립트와 나란히 놓고 **문장이 안 겹치는지** (표현 100% 재작성 + 순서 재배치됐는지)
- [ ] **엮기**: 마지막 카드가 의도에 적은 **BCC 프로그램으로 자연스럽게 연결**되는지
- [ ] **톤**: BCC 톤(현실적·직설적)인지, 추임새·사담 없는지
- [ ] **사실정보**: 가격·링크가 지어내지 않고 `[가격]` `[링크]` 자리표시자로 비워졌는지
- [ ] **보안**: 비관리자 계정으로 시도 시 "관리자만 사용할 수 있습니다." 나오는지 / 브라우저 F12 어디에도 `ANTHROPIC_API_KEY` 안 보이는지

품질이 부족하면 → `api/cardnews-generate.js` 의 `SYSTEM_PROMPT` 를 다듬어 재배포.
품질이 만족스러우면 → **2단계(Canvas 1장 렌더)** 로 진행.

---

## 비용 참고
- 한 세트 생성 ≈ 200~230원 (claude-opus-4-8). "구성표 생성" 누를 때마다 과금(다시 만들기 포함).
