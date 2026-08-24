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
  assert.match(home, /data-tool="job-lab"[\s\S]+?href="https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/employment\?/);
  assert.match(tools, /data-tool-id="job-lab"[\s\S]+?href="https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/employment\?/);
  assert.match(jobLab, /AI 취업 실험실/);
  assert.doesNotMatch(jobLab, /AI 취업 실습실/);

  assert.match(jobLab, /나를 증명한다 · 면접톡/);
  assert.match(jobLab, /https:\/\/bcc-interview-talk\.vercel\.app\//);
});

test("AI 취업 실험실 첫 화면에서 네 단계를 버튼으로 바로 보여준다", () => {
  const hero = jobLab.match(/<section class="hero">([\s\S]+?)<\/section>/)?.[1] ?? "";

  assert.match(hero, /id="stage-selector"/);
  assert.match(hero, /원하는 단계를 바로 선택하세요/);
  assert.match(hero, /<strong>메타인지<\/strong>/);
  assert.match(hero, /<strong>직무·기업분석<\/strong>/);
  assert.match(hero, /<strong>자기소개서<\/strong>/);
  assert.match(hero, /<strong>면접톡<\/strong>/);
  assert.equal((hero.match(/aria-disabled="true"/g) ?? []).length, 2);
  assert.doesNotMatch(jobLab, /전체 과정 선택하기/);

  assert.match(hero, /href="https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/employment\/metacognition/);
  assert.match(hero, /href="https:\/\/bcc-interview-talk\.vercel\.app\//);

  assert.match(jobLab, /href="https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/employment\/metacognition.+>20분 실습하기 →<\/a>/);
  assert.match(jobLab, /href="https:\/\/bcc-interview-talk\.vercel\.app\/.+>면접 연습하기 →<\/a>/);
});
