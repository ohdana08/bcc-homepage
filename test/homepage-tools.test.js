import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('창업 메타인지 실험실을 딱지원핏 다음 도구로 공개한다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const ddakfitIndex = html.indexOf('data-tool="govplan"');
  const founderLabIndex = html.indexOf('data-tool="founder-metacognition"');
  const freeChatbotIndex = html.indexOf('data-tool="free-chatbot"');

  assert.ok(ddakfitIndex >= 0);
  assert.ok(founderLabIndex > ddakfitIndex);
  assert.ok(freeChatbotIndex > founderLabIndex);
  assert.match(html, /data-tool-name="창업 메타인지 실험실"/);
  assert.match(html, /https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/startup/);
  assert.match(html, /아이템 검증 시작하기 →/);
  assert.match(html, /\.tools-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, 1fr\)/);
});
