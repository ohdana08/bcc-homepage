-- 기존 시연용 두 건을 실제 기관 수요조사 집계에서 분리한다.
-- 샘플 응답은 삭제하지 않고 기능 확인용으로 보존한다.

alter table if exists public.training_need_surveys
  add column if not exists is_sample boolean not null default false;

comment on column public.training_need_surveys.is_sample is
  '시연·기능 확인용 샘플이면 true. 실제 조사·응답·분석 지표에서 제외한다.';

update public.training_need_surveys
set is_sample = true,
    updated_at = now()
where (institution_label = '부산광역주거복지센터' and title = '임원진 AI업무활용교육')
   or (institution_label = 'BCC 내부 테스트' and title = '교육생 니즈분석 체험용');
