-- 승인 후에만 bcc-business 운영 DB에서 실행한다.
-- 랜딩 신청을 검토한 뒤 적합 고객에게만 결제 링크를 전달한다.
insert into public.products (id, name, price, recourse_price, is_active)
values ('ai-workroom-pilot', 'AI 업무 1개 끝내기 맞춤 작업실', 149000, null, true)
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  recourse_price = excluded.recourse_price,
  is_active = excluded.is_active;

-- 실행 후 검증
select id, name, price, recourse_price, is_active
from public.products
where id = 'ai-workroom-pilot';
