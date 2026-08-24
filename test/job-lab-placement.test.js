import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tools = readFileSync(new URL("../tools/index.html", import.meta.url), "utf8");
const jobLab = readFileSync(new URL("../job-lab.html", import.meta.url), "utf8");

test("면접톡은 AI 취업 실험실 안에서만 안내한다", () => {
  assert.match(home, /data-tool="job-lab"/);
  assert.doesNotMatch(home, /data-tool="interview-talk"/);

  assert.match(tools, /data-tool-id="job-lab"/);
  assert.doesNotMatch(tools, /data-tool-id="interview-talk"/);
  assert.match(home, /data-tool-name="AI 취업 실험실"/);
  assert.match(tools, /data-tool-name="AI 취업 실험실"/);
  assert.match(jobLab, /AI 취업 실험실/);
  assert.doesNotMatch(jobLab, /AI 취업 실습실/);

  assert.match(jobLab, /나를 증명한다 · 면접톡/);
  assert.match(jobLab, /https:\/\/bcc-interview-talk\.vercel\.app\//);
});

test("AI 취업 실험실은 전체 과정을 먼저 보여준 뒤 단계를 선택하게 한다", () => {
  assert.match(jobLab, /href="#program">전체 과정 선택하기 →<\/a>/);
  assert.match(jobLab, /전체 과정을 보고,<br>지금 할 단계를 선택하세요/);
  assert.doesNotMatch(jobLab, />20분 메타인지 실습 시작 →<\/a>/);
  assert.doesNotMatch(jobLab, />무료 실습 시작 →<\/a>/);

  assert.match(jobLab, /href="https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/.+>20분 실습하기 →<\/a>/);
  assert.match(jobLab, /href="https:\/\/bcc-interview-talk\.vercel\.app\/.+>면접 연습하기 →<\/a>/);
});
