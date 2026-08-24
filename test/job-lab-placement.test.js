import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const tools = readFileSync(new URL("../tools/index.html", import.meta.url), "utf8");
const jobLab = readFileSync(new URL("../job-lab.html", import.meta.url), "utf8");

test("면접톡은 AI 취업 실습실 안에서만 안내한다", () => {
  assert.match(home, /data-tool="job-lab"/);
  assert.doesNotMatch(home, /data-tool="interview-talk"/);

  assert.match(tools, /data-tool-id="job-lab"/);
  assert.doesNotMatch(tools, /data-tool-id="interview-talk"/);

  assert.match(jobLab, /나를 증명한다 · 면접톡/);
  assert.match(jobLab, /https:\/\/bcc-interview-talk\.vercel\.app\//);
});
