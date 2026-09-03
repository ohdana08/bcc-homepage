-- Claude 101 9,900원 실습팩의 검증된 외부 실매출

with verified_sales as (
  select id, user_id, product_id, paid_amount, paid_at, order_id, provider, status
  from public.enrollments
  where product_id = 'claude101-pro'
    and paid_amount > 0
    and status = 'active'
    and provider = 'groble'
    and coalesce(order_id, '') not ilike '%manual-test%'
    and coalesce(order_id, '') not ilike '%test-order%'
)
select
  count(*)::integer as verified_paid_orders,
  coalesce(sum(paid_amount), 0)::integer as verified_revenue_krw,
  1000000::integer as target_revenue_krw,
  greatest(1000000 - coalesce(sum(paid_amount), 0), 0)::integer as remaining_revenue_krw,
  greatest(102 - count(*), 0)::integer as remaining_orders_at_9900
from verified_sales;

-- 주문별 감사 목록. 요약 합계를 Groble 관리자 결제·환불 내역과 대조한다.
select paid_at, user_id, paid_amount, provider, status, order_id, provider_order_id
from public.enrollments
where product_id = 'claude101-pro'
order by paid_at desc nulls last;
