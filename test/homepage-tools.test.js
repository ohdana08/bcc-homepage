import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('두 AI 실험실을 나란히 공개하고 정부지원사업 도우미를 창업 실험실에 통합한다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const founderLabIndex = html.indexOf('data-tool="founder-metacognition"');
  const jobLabIndex = html.indexOf('data-tool="job-lab"');
  const freeChatbotIndex = html.indexOf('data-tool="free-chatbot"');

  assert.ok(founderLabIndex >= 0);
  assert.ok(jobLabIndex > founderLabIndex);
  assert.ok(freeChatbotIndex > jobLabIndex);
  assert.doesNotMatch(html, /data-tool="govplan"/);
  assert.match(html, /data-tool-name="AI 창업 실험실"/);
  assert.match(html, /data-tool-name="AI 취업 실험실"/);
  assert.doesNotMatch(html, /창업 메타인지 실험실|AI 취업 실습실/);
  assert.match(html, /정부지원사업 추천·사업계획서 작성까지 한 흐름으로/);
  assert.match(html, /https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/startup/);
  assert.match(html, /창업 실험 시작하기 →/);
  assert.match(html, /취업 실험 시작하기 →/);
  assert.match(html, /\.tools-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, 1fr\)/);
});
