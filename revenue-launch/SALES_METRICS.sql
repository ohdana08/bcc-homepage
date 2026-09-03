-- AI 업무 작업실 파일럿의 검증된 외부 실매출 집계
-- 집계 원칙: 결제금액이 0원보다 크고, 현재 active이며, 내부·테스트 주문이 아닌 건만 포함한다.

with verified_sales as (
  select
    id,
    user_id,
    product_id,
    paid_amount,
    paid_at,
    order_id,
    provider,
    status
  from public.enrollments
  where product_id = 'ai-workroom-pilot'
    and paid_amount > 0
    and status = 'active'
    and coalesce(provider, '') not in ('manual-test', 'test', 'internal')
    and coalesce(order_id, '') not ilike '%manual-test%'
    and coalesce(order_id, '') not ilike '%test-order%'
)
select
  count(*)::integer as verified_paid_customers,
  coalesce(sum(paid_amount), 0)::integer as verified_revenue_krw,
  1000000::integer as target_revenue_krw,
  greatest(1000000 - coalesce(sum(paid_amount), 0), 0)::integer as remaining_revenue_krw,
  greatest(7 - count(*), 0)::integer as remaining_customers_at_149k
from verified_sales;

-- 주문별 감사 목록: 위 요약과 함께 실행해 내부·환불 건이 섞이지 않았는지 사람이 확인한다.
select
  paid_at,
  user_id,
  paid_amount,
  provider,
  status,
  order_id
from public.enrollments
where product_id = 'ai-workroom-pilot'
order by paid_at desc nulls last;

-- 일별 실매출: 발송·후속 메시지 이후의 변화를 비교한다.
with verified_sales as (
  select paid_at, paid_amount
  from public.enrollments
  where product_id = 'ai-workroom-pilot'
    and paid_amount > 0
    and status = 'active'
    and coalesce(provider, '') not in ('manual-test', 'test', 'internal')
    and coalesce(order_id, '') not ilike '%manual-test%'
    and coalesce(order_id, '') not ilike '%test-order%'
)
select
  (paid_at at time zone 'Asia/Seoul')::date as paid_date_kst,
  count(*)::integer as paid_customers,
  sum(paid_amount)::integer as revenue_krw
from verified_sales
group by 1
order by 1;
