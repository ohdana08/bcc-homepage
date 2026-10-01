import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { normalizeAnalysis, createDraft } from '../tools/document-mate/model.mjs';
import { draftMarkdown, draftDocx } from '../tools/document-mate/export.mjs';

function rawField(value, quote, overrides = {}) {
  return { id: 'result', label: '활동 결과', value, quote, sourceId: 'input', kind: 'fact', required: false, ...overrides };
}
function analyze(field, text, heading = '활동 결과') {
  return normalizeAnalysis({ documentType: 'report', fields: [field], sections: [{ heading, fieldIds: ['result'] }], questions: [] }, [{ id: 'input', name: '자료', text }]);
}

test('review: 모델의 비수치 허위 주장도 항목명·소제목을 통해 초안에 들어가지 않는다', () => {
  const text = '카드뉴스 4건을 제작했다.';
  const result = analyze(rawField(text, text, { label: '부산시 공식 승인 완료' }), text, '부산시 공식 승인 완료');
  assert.ok(!JSON.stringify(createDraft(result)).includes('부산시 공식 승인 완료'));
});

test('review: 부정문을 잘라 반대 의미의 사실로 출력하지 않는다', () => {
  const text = '참석자는 20명이 아니다. 카드뉴스 4건을 제작했다.';
  const result = analyze(rawField('참석자는 20명', text), text);
  const field = result.fields.find(item => item.id === 'result');
  assert.ok(field.kind === 'unknown' || field.value.includes('아니다'), `부정 표현을 잃은 값: ${field.value}`);
});

test('review: 원문의 부정·조건을 제거한 문구는 항목명과 소제목으로도 사용하지 않는다', () => {
  const text = '부산시 공식 승인 완료가 아닙니다. 카드뉴스 4건을 제작했다.';
  const result = analyze(rawField('카드뉴스 4건을 제작했다.', '카드뉴스 4건을 제작했다.', { label: '부산시 공식 승인 완료' }), text, '부산시 공식 승인 완료');
  assert.ok(!JSON.stringify(createDraft(result)).includes('부산시 공식 승인 완료'));
});

test('review: 실제 다운로드 Markdown 경로도 원문의 HTML·활성 링크를 평문으로 출력한다', () => {
  const draft = {
    title: '<b>검토한 제목</b>',
    sections: [{ heading: '활동 결과', content: '<img src="https://example.invalid/pixel">\n[열기](javascript:alert(1))' }],
    unknowns: [], unsupportedExpressions: [], suggestedAttachments: [],
  };
  const markdown = draftMarkdown(draft);
  assert.ok(!markdown.includes('<img'));
  assert.ok(!markdown.includes('<b>'));
  assert.ok(!markdown.includes('[열기]('));
});

test('review: DOCX는 현재 편집한 한글 제목·본문·확인 항목을 보존하고 HTML은 텍스트로 만든다', async () => {
  const draft = {
    title: '사용자가 고친 결과보고서',
    sections: [{ heading: '활동 결과', content: '최종 참석자 22명\n장소: [확인 필요]\n<b>원문 텍스트</b>' }],
    unknowns: ['행사 장소'], unsupportedExpressions: ['현장 반응은 사용자 의견'], suggestedAttachments: ['수정한 첨부 목록'],
  };
  const blob = await draftDocx(draft);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(entries['[Content_Types].xml']);
  const xml = strFromU8(entries['word/document.xml']);
  for (const expected of ['사용자가 고친 결과보고서', '최종 참석자 22명', '[확인 필요]', '행사 장소', '수정한 첨부 목록', '&lt;b&gt;원문 텍스트&lt;/b&gt;']) assert.ok(xml.includes(expected), expected);
});
