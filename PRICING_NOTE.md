# 강의 가격·추가 변경 메모 (잇스쿨 = 정적 카드 방식)

> 메인페이지(index.html)의 잇스쿨 강의 카드는 **정적(static)** 입니다.
> 가격이 **카드(표시용)** 와 **DB(실제 결제)** 두 곳에 따로 있으니, 바꿀 땐 **둘 다** 고쳐야 합니다.
> (나중에 강의가 많아지면 `/api/products` 연동 카드로 전환 예정 → 그때부턴 DB만 고치면 됨)

---

## 🔴 가격을 바꿀 때 — 반드시 두 곳

| # | 위치 | 역할 | 무엇을 고치나 |
|---|------|------|--------------|
| 1 | `index.html` 잇스쿨 섹션의 해당 `.course-card` 안 `.course-price` / `.course-recourse` | **화면 표시용** | 보이는 숫자(예 `119,000`, `재수강 30,000원`) |
| 2 | Supabase `products` 테이블 행의 `price` / `recourse_price` | **★실제 결제 금액(진실원천)** | 결제는 항상 이 값을 신뢰. 카드 숫자는 표시일 뿐 |

- 결제 금액은 서버(`api/create-checkout.js`)가 **DB `products` 값으로만** 산정합니다. 카드 숫자를 바꿔도 결제액은 안 바뀜 → **DB를 꼭 같이 바꿀 것.**
- DB 수정: Supabase 대시보드 → Table editor `products`, 또는 SQL:
  ```sql
  update products set price = 99000, recourse_price = 30000 where id = 'shorts2';
  ```

## 🟢 강의를 새로 추가할 때 — 두 가지

1. **DB**: `products` 에 INSERT (코드 수정 0).
   ```sql
   insert into products (id, name, price, recourse_price)
   values ('ai_staff', 'AI직원만들기', 119000, 30000);
   ```
   (지난 강의로 숨기려면 `is_active = false` 로 추가 — 목록/결제에서 자동 제외, 카드만 "마감"으로 노출)
2. **카드**: `index.html` 잇스쿨 `.school-grid` 안에 `.course-card` 한 블록 복사 →
   `data-course` / 아이콘 / `.tool-name` / `.tool-desc` / `.course-price` / `href="apply.html?product=<id>"` 교체.
   - 모집중 강의: `<a class="tool-card course-card is-active" ...>` + `tool-badge-active "모집중"` + `신청하기 →`
   - 마감/수료 강의: `<div class="tool-card course-card is-disabled is-done" ...>`(링크 아님) + `tool-badge-done` + `모집 마감`

## 참고
- `?product=<id>` 딥링크는 `apply.html`(264줄 `preselect()`)이 읽어 해당 강의를 미리 선택함.
- 새 강의 추가 절차 보강 설명: `PAYMENT_SETUP.md` "새 강의 추가" 섹션.
- 현재 상품: `shorts2`(쇼츠2기, 119000/30000), `cardnews`(카드뉴스공장장, 119000/30000), `shorts1`(쇼츠1기, is_active=false·마감).

## TODO (오픈 전)
- [ ] 쇼츠1기 카드의 `🎓 1기 수료생 ○○명` → 실제 인원으로 교체 (index.html 잇스쿨 `.course-grad`).
