-- 사용자 승인 가격: Claude 101 업무 결과물 실습팩 9,900원
-- 그로블 상품 nSq3PJ의 판매가도 반드시 9,900원으로 먼저 맞춘 뒤 실행한다.

update public.products
set
  name = 'AI 업무 결과물 3종 실습팩',
  price = 9900,
  recourse_price = null,
  is_active = true
where id = 'claude101-pro'
returning id, name, price, recourse_price, is_active;
