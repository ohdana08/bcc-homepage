# 강의 문의 관리 — 채팅 저장 계약

기존 문의·원문·제안·첨부·수요조사·정산은 삭제하거나 덮어쓰지 않는다. `proposal_cases`에는 새 문의만 추가하며, 기존 건의 보완·상태·추천안은 `lecture_desk_state`에 별도로 보관한다. 모든 변경 원문과 제안 버전은 `lecture_desk_events`에 누적한다. 기존 관리자 화면은 원래 기록을, 새 강의 관리 화면은 보완된 상태를 보여준다.

## 운영 방식

사용자는 Codex 채팅에 문의 내용·자료를 전달한다. AI는 같은 기관 이름만으로 자동 병합하지 않고 기존 문의의 대상·사업·일정·원문을 대조한다. 맞는 `case_id`를 확인한 뒤 같은 기록에 이벤트를 추가한다. 새 문의는 `case_id:null`, `expected_revision:0`으로 생성한다. 기관명이 없으면 AI가 `기관명 확인 필요`로 기록하고 추가 확인사항으로 남긴다.

AI가 기존 자료를 읽고 정리한 결과를 `prepared`로 저장한다. 이 API는 별도 LLM이나 유료 API를 호출하지 않는다. 채팅에서 만들어 낸 초안이 저장되는 경로이며, 홈페이지에서 원문만 붙여 넣어도 자동으로 제안이 생성되는 서비스로 표시하지 않는다.

## 단계와 날짜

- `inquiry`: 새 문의. `update`: 후속 내용·조건 보완.
- `proposal_ready`: 회신·제안 준비, `prepared` 필수. 발송 아님.
- `proposal_sent`: 실제 발송한 사실을 기록. 회신 대기와 3일 뒤 후속 연락 후보를 만든다. 자동 발송·예약을 하지 않는다.
- `scheduled`: 확정, `plan_received`: 강의 준비, `photos_received`: 현장 진행.
- `recording_received`: 종료 후 녹음본 전달, 강의 완료.
- `blog_written`: 강의 직후 블로그 작성. **occurred_on(한국 날짜)이 실제 강의일**이다. 나중에 게시·예약·수정한 날로 대체하지 않는다.
- 과거 단계 자료가 늦게 도착해도 완료 상태를 되돌리지 않는다. 기존 운영실에서 명시적으로 완료된 강의 역시 보존한다. 단순히 희망 날짜가 지났다는 이유로 완료로 추정하지 않는다.
- `fields.lecture_date`는 전달된 계획/희망 날짜를 보존하고, `state.actual_lecture_date`는 위 현장·종료 사실로 별도 표시한다. 강의 완료로 입금 완료를 만들지 않는다.
- `state.proposal_pending`은 새로 검토·발송할 제안을 별도로 나타낸다. proposal_ready 때 true, 실제 proposal_sent 또는 현장 사진·녹음본·블로그 작성 단계 때 false. 이미 확정·진행한 강의의 수정 제안도 전체 강의 단계를 되돌리지 않고 찾을 수 있다.
- 자동으로 제안한 회신 확인일은 확정·준비·현장·완료 단계에서 해제한다. 명시적으로 지정한 followup_on은 강의 준비나 사후 연락용일 수 있으므로 단계와 관계없이 보존한다.
- 새 조건이 오면 이전 추천을 `prepared_stale:true`로 표시한다. 같은 이벤트에 갱신한 `prepared`를 담으면 최신으로 대체된다. 과거 추천·발송본은 이벤트 이력에 남는다.

## 인증과 적용 경로

HTTP: `POST /api/lecture-desk`, 관리자 Bearer 세션 + 서버 `profiles.is_admin` 확인. 허용된 동일 사이트 Origin만 허용. 서비스 키를 브라우저에 보내지 않는다.

Codex: 연결된 Supabase의 `execute_sql`에서 `public.bcc_lecture_desk_apply(p_event::jsonb,p_actor::uuid)`를 호출한다. `p_actor`는 이 홈페이지의 확인된 관리자 ID여야 한다. SQL 함수는 서비스 역할에만 실행 권한이 있으며 일반 사용자·익명은 호출할 수 없다. `event_id`를 재시도 때 유지한다. 동일 ID에 다른 본문을 넣으면 conflict다. SQL 문자열은 문자열 치환으로 만들지 말고 프로젝트의 이벤트 SQL 생성기를 사용한다.

`expected_revision`은 상세 조회의 현재 state.revision을 사용한다. conflict면 최신 내용을 읽고 병합한 다음 새 event_id로 저장한다. 에러를 무시하거나 기존 기록을 강제로 덮어쓰지 않는다. 응답의 case_id/revision/state를 재조회해 저장 결과를 확인한다.

## 이벤트 JSON

```json
{
  "event_id": "a0000000-0000-0000-0000-000000000001",
  "case_id": null,
  "expected_revision": 0,
  "kind": "inquiry",
  "occurred_on": "2026-11-18",
  "source_ref": "codex:해당 채팅과 메시지 식별",
  "raw_text": "사용자가 전달한 문의 원문",
  "fields": {"institution_name":"기관명 확인 필요", "topic":"ChatGPT 실습"},
  "prepared": {
    "summary":"확인된 요구 요약",
    "questions":["담당자에게 필요한 확인 질문"],
    "recommendation":"기존 자료를 근거로 추천한 강의 구성",
    "email_subject":"회신 제목",
    "email_body":"검토할 회신 초안",
    "proposal_text":"제안 문구",
    "materials":[{"title":"재사용 자료 이름", "source":"기존 자료 식별", "url":"https://bccconsulting.kr/"}],
    "next_action":"답장 검토"
  }
}
```

fields 허용 항목: institution_name, project_name, topic, audience, region, delivery_format, duration_hours, lecture_date, followup_on, contact_name, contact_email, contact_phone, next_action. 비어 있는 값은 `null` 또는 글자 필드의 빈 문자열. 연락처는 공개용 강사 연락처가 아니라 해당 문의 담당자 정보다.

## HTTP 동작

- `{action:'list',page:0}` → `{cases,has_more,next_page}`. cases는 기존 필드 + desk.fields + desk 객체. 모든 페이지를 불러온 범위에서 필터·집계를 표시한다.
- `{action:'detail',case_id}` → `{case,state,events,events_truncated,outputs,requests,attachments}`. events 최신 200개, 원자료 전체는 DB에 보존. 기존 request의 개인 수정키·해시는 반환하지 않는다.
- `{action:'apply',event}` → `{case_id,revision,state,replayed}`.
- `{action:'library',page:0}` → `{items,has_more,next_page}`. 기존 활성 proposal_knowledge만 읽는다. 자료 수집·공개·새 유료 API는 수행하지 않는다.
- `{action:'settings'}` / `{action:'save_settings',settings}` → `{settings}`. 기본 contact_phone/contact_email 빈칸, kakao_url 기존 공식 채널, inquiry_cta 카카오 문의 문구.
- `{action:'upload',case_id,file_id,name,mime_type,base64}` → `{file,replayed}`. 2MB 이하 파일을 private bucket에 저장. 같은 ID/내용의 재시도만 재사용한다. 파일 실패 시 pending 상태로 보존하고 같은 요청을 다시 시도한다.
- `{action:'download',case_id,file_id}` → 검증된 바이너리 attachment. 새 desk 파일만 취급. 기존 request 첨부는 기존 다운로드 API/관리자 화면을 유지한다.

큰 녹음본은 채팅에서 처리하고 원본 위치를 source_ref에 연결한다. 2MB를 넘는 파일을 업로드 성공으로 표시하지 않는다. 로컬 경로만 연결한 자료는 다른 기기에서 열리지 않을 수 있음을 표시한다.

## 보존·검증

변경 전후 proposal_cases, proposal_outputs, proposal_knowledge, lecture_requests, 기존 첨부 원장의 전체내용 해시를 비교한다. 합성 QA는 운영 고객 문의나 실제 실적으로 취급하지 않는다. 새 SQL 테이블은 RLS 활성화·일반 사용자 권한 회수, 새 파일 버킷은 비공개이며 공개 읽기 정책을 추가하지 않는다.
