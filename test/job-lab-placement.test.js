import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tools = readFileSync(new URL("../tools.html", import.meta.url), "utf8");
const legacyTools = readFileSync(new URL("../tools/index.html", import.meta.url), "utf8");
const jobLab = readFileSync(new URL("../job-lab.html", import.meta.url), "utf8");

test("잇툴즈 취업 도구와 기존 AI 취업 실험실에서 면접 연습을 시작한다", () => {
  assert.match(home, /<a\b[^>]*href="\/?tools\.html"[^>]*>잇툴즈<\/a>/);
  const job = tools.split(/<div class="it-group"\s+/).find(group => group.startsWith('id="job"'));
  assert.ok(job, '잇툴즈의 취업 준비 도구 모음');
  const jobLinks = [...job.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  for (const [title, destination] of [
    ["20분 메타인지", "https://ai-job-metacognition-lab.jinjoopower.chatgpt.site/employment/metacognition"],
    ["면접톡", "https://bcc-interview-talk.vercel.app/"],
  ]) {
    const link = jobLinks.find(([, , content]) => content.includes(`<h3>${title}</h3>`));
    assert.ok(link, title);
    const target = new URL(link[1]);
    assert.equal(target.origin + target.pathname, destination, title);
  }

  const legacyCard = legacyTools.match(/<a\b[^>]*data-tool-id="job-lab"[^>]*>/)?.[0] ?? "";
  assert.match(legacyCard, /data-tool-name="AI 취업 실험실"/);
  assert.match(legacyCard, /href="https:\/\/ai-job-metacognition-lab\.jinjoopower\.chatgpt\.site\/employment\?/);
  assert.doesNotMatch(legacyTools, /data-tool-id="interview-talk"/);
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
