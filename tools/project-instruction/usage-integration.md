# BCC 사용 기록 연동 계약 v1

Node.js 20+ 서버에서 호출하는 선택형 교육용 연동입니다. 생성 업무지시서에 이 기능을 적는 것과 실제 구현·배포·검증 완료는 구분합니다. 문서 원문·개인 식별정보는 보내지 않습니다.

## 시작

1. 업무지시서를 제출한 본인이 사용 기록 수집·국외 처리에 별도로 동의합니다. 만 14세 이상 본인 사용만 적용합니다.
2. ‘연동용 업무지시서’와 ‘연동 설정 파일’을 받습니다. 업무지시서는 AI 개발 도구에, 설정 파일은 로컬 프로젝트의 비공개 `.env` 또는 배포 서버 환경변수에 넣습니다. 키를 AI 채팅·저장소·브라우저 코드·로그에 붙이지 않습니다. `.gitignore`에 `.env*`를 추가합니다. 설정 파일명은 `.env`로 바꾸거나 환경변수를 직접 설정합니다.
3. [usage-client.mjs](https://bccconsulting.kr/tools/project-instruction/usage-client.mjs)를 검토하고 서버 프로젝트에 복사합니다. 브라우저에 직접 import하지 않습니다. 다른 언어는 아래 HTTP 계약을 구현합니다.
4. 실제 도구에도 기본 OFF인 ‘내 사용 기록을 BCC에 보내기’와 OFF/철회 경로를 제공합니다. 소유자를 확인한 본인 세션에서만 수집합니다. 작성자의 동의는 타인에게 적용되지 않습니다. 신원을 확인할 수 없는 공용 앱에서는 수집하지 않습니다.
5. 합성 실행은 `test`, 본인이 동의하고 사용하는 실행은 `live`로 구분합니다. 시험 기록은 성과 통계에서 제외됩니다. 관리 화면에서 수신을 확인한 뒤 연결 완료로 안내합니다.

## 서버 예제

```js
import { randomUUID } from 'node:crypto';
import { createUsageClient } from './usage-client.mjs';

const usage = createUsageClient({
  submissionId: process.env.BCC_USAGE_SUBMISSION_ID,
  writeToken: process.env.BCC_USAGE_WRITE_TOKEN,
  enabled: process.env.BCC_USAGE_ENABLED === 'true', // 기본 false
  mode: process.env.BCC_USAGE_MODE === 'live' ? 'live' : 'test',
});

// 소유자 인증과 실행별 사용 동의를 확인한 서버 경로에서만 호출합니다.
// 아래 함수 자체를 익명 공개 proxy로 노출하지 마세요.
export async function performOwnedTask({ ownerVerified, consentOn, runWork }) {
  const eventId = randomUUID(); // 한 실행 동안 같은 UUID 유지
  const started = performance.now();
  let outcome = 'completed';
  try {
    return await runWork();
  } catch (error) {
    outcome = 'failed';
    throw error; // 실제 업무 실패는 기존 업무 오류 처리로 전달
  } finally {
    if (ownerVerified && consentOn) {
      // 검수 없는 작업의 최소 기록. 검수가 있는 작업은 아래 가이드대로 최종 검수 뒤 1회 전송.
      await usage.record({
        eventId, outcome, durationMs: Math.round(performance.now() - started),
        review: 'not_reviewed', endUserConsent: true,
      });
      // 수집 실패는 업무 결과를 바꾸지 않습니다. 서버리스에서는 작업 종료 전 await 필요.
    }
  }
}
```

SDK는 기본 비활성·시험 모드입니다. 요청당 최대 3초, 네트워크/5xx 실패에서 최대 1회만 같은 내용으로 재시도합니다. 성공 응답을 확인하지 못하면 `ok:false`를 반환하며 키·원문·오류 전문을 로깅하지 않습니다. 영구 오류·철회·한도 응답을 무한 재시도하지 않습니다. 측정 실패와 본래 업무 실패를 섞지 않습니다. 정확도/시간 비교가 필요하면 검수·사용자 타이머를 실제로 구현한 뒤 최종 이벤트를 1회 보내세요.

## HTTP 계약

`POST https://bccconsulting.kr/api/project-instruction-usage?action=event`

- `Content-Type: application/json`
- `Authorization: Bearer <서버에만 보관하는 전송키>`
- JSON `{ "id": "제출 UUID", "event": { ... } }` / 최대 8KiB
- 브라우저 직접 전송(Origin 헤더)은 차단합니다. CORS 허용으로 해결하려 하지 마세요.
- 관리키/전송키를 URL에 넣지 않습니다. 전송키는 읽기·삭제·동의 변경 권한이 없습니다.

| 필드 | 의미 |
|---|---|
| eventId | 실행 1회당 UUID. 최종 결과 1개, 같은 ID+내용의 재시도만 허용 |
| mode | test / live. SDK에서는 생성 옵션으로 지정 |
| outcome | completed / failed |
| durationMs | 실제 도구 실행 경과 시간, 정수 0~86,400,000ms |
| review | not_reviewed / accepted / corrected / rejected |
| endUserConsent | 소유자 본인 사용 동의를 확인한 경우에만 true |
| baselineSeconds, workSeconds, workTimeSource, comparableTask | 아래 시간 비교 4항목을 모두 제공하거나 모두 생략 |
| checkedItems, correctItems, checkMethod, criteriaVersion | 아래 검수 4항목을 모두 제공하거나 모두 생략 |

허용하지 않는 키가 하나라도 있으면 거부합니다. 제목·문서·질문·답변·파일명·URL·사용자ID·오류 전문·IP·기기 식별자를 넣지 마세요. 서버는 수신 시각을 기록합니다. 클라이언트가 임의 수신 시각을 지정할 수 없습니다.

### 시간 비교

같은 종류·분량·조건의 업무 **1건**만 비교합니다. `baselineSeconds`는 도구 사용 전 사람의 능동 작업시간에 대한 **자기보고**(1~86,400초), `workSeconds`는 사용 후 자료 준비·조작·검토·수정에 사람이 실제로 일한 시간의 합(0~86,400초, AI 대기 제외)입니다. 타이머를 구현하면 `workTimeSource:"measured"`, 직접 입력은 `"self_reported"`. 비교 조건을 사용자가 확인하면 `comparableTask:true`로 보냅니다.

비교값이 없으면 생략하세요. 기본 예시 숫자·실행 시간·모델 토큰 수를 사람 시간으로 대체하지 마세요. 시간 증가(음수 절감)도 그대로 보존합니다. 자기보고 기준과의 차이이며 인과적 절감 효과를 입증하는 실험값은 아닙니다.

### 검수

먼저 해당 도구의 체크 항목과 정답 판단 규칙을 정합니다. `checkedItems` 1~10,000, `correctItems` 0~checkedItems, `checkMethod`는 `human_review`(사람 판단) 또는 `reference_check`(정답 자료 대조), `criteriaVersion`은 `1` 또는 `1.0` 같은 숫자 버전입니다. 기준을 바꾸면 버전을 바꾸세요. 검수 기준 원문/정답 원문은 보내지 않습니다.

AI의 자기평가를 사람 검수로 기록하지 마세요. 승인/수정 여부만으로 내용 정확도를 계산하지 않습니다. 항목 통과율은 해당 도구·해당 버전·검수된 항목의 수치일 뿐 전체 업무 정확도를 보증하지 않습니다. 서로 다른 도구나 기준을 합산하지 않습니다.

최종 검수 뒤 **실행당 한 번** 전송하세요. 먼저 미검수로 보낸 다음 다른 ID로 같은 실행을 다시 보내지 마세요. 이 버전은 기존 이벤트 수정 API를 제공하지 않습니다. 실패 실행은 미검수로만 전송하며 시간 절감/정확도 항목을 넣지 않습니다.

### 응답·한도·권리 행사

- 최초 수신 `201`, 동일 재시도 `200`: `{ok:true,eventId,receivedAt,replayed,mode}`
- 같은 ID로 다른 내용 `409`, 필드 오류 `400`, 잘못된 키·철회·삭제·만료 `404`, 한도 `429`, 일시 장애 `503`.
- 연결당 하루 1,000건, 전체 하루 10,000건, 연결당 총 30,000건. 시험도 한도에 포함됩니다.
- 관리: https://bccconsulting.kr/tools/project-instruction/#receipt-management
- 설정을 잃거나 노출되면 관리키로 새 설정을 발급합니다. 기존 키는 무효화됩니다.
- 사용 기록 동의 철회 시 즉시 전송 차단·기존 기록 삭제. 철회한 연결은 되살리지 않으며 재동의하려면 새 업무지시서를 제출합니다. 전체 제출 삭제 시 연결·기록도 함께 삭제합니다.
- 보관 종료는 원래 업무지시서 최초 제출일부터 달력 3년으로 고정합니다. 만료 즉시 조회/수집 제외, 기존 매시간 정리에서 삭제됩니다.
- 개인정보 안내: https://bccconsulting.kr/privacy.html#project-instruction-usage

## 검증 체크

동의 OFF 요청0건, 시험/실사용 분리, 동일 ID 중복0건, 다른 내용 재전송409, 수집 실패 시 원래 업무 유지, 키가 공개 빌드/로그에 없는지, 철회 후404, 관리자에 미검수/비교값 없음이 '미측정'으로 표시되는지 확인합니다. 키 발급만으로 실제 사용·시간 절감이 확인됐다고 안내하지 마세요.
