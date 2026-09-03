import { COURSE_LESSONS } from './claude101-course-data.js';

const SAMPLE_LESSON_ID = '1-1';
const API = location.hostname.endsWith('.vercel.app') ? location.origin : window.BCC_API_BASE;
const lesson = COURSE_LESSONS.find((item) => item.id === SAMPLE_LESSON_ID);
const loadingView = document.getElementById('sampleLoading');
const video = document.getElementById('sampleVideo');
const retryButton = document.getElementById('sampleRetry');
const practiceView = document.getElementById('samplePractice');
const copyItems = new Map();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function track(name, params = {}) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, { sample_lesson_id: SAMPLE_LESSON_ID, ...params });
    }
  } catch (_) {}
}

function renderPrompts() {
  return lesson.practice.prompts.map((prompt) => {
    const key = `prompt:${prompt.id}`;
    copyItems.set(key, prompt.text);
    return `<article class="practice-prompt">
      <div class="practice-prompt-head">
        <div><strong>${escapeHtml(prompt.label)}</strong><p>${escapeHtml(prompt.help)}</p></div>
        <button class="copy-practice-button" type="button" data-copy-key="${escapeHtml(key)}">프롬프트 복사</button>
      </div>
      <pre>${escapeHtml(prompt.text)}</pre>
    </article>`;
  }).join('');
}

function renderDownloads(assets) {
  const assetDownloads = new Map((assets.downloads || []).map((item) => [item.id, item.url]));
  return lesson.practice.downloads.map((item) => {
    const url = assetDownloads.get(item.id);
    if (!url) return '';
    return `<a class="practice-download" href="${escapeHtml(url)}" target="_blank" rel="noopener" data-sample-download="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.format)} · 다운로드</small>
    </a>`;
  }).join('');
}

function renderPractice(assets) {
  const sampleKey = 'sample:meeting-memo';
  copyItems.set(sampleKey, lesson.practice.sampleText);
  const checklist = lesson.practice.checklist.map((item, index) => `<label class="course-check-item">
    <input type="checkbox" data-check-index="${index}">
    <span>${escapeHtml(item)}</span>
  </label>`).join('');

  practiceView.innerHTML = `<section class="practice-materials" aria-labelledby="samplePracticeTitle">
    <div class="practice-title-row">
      <div><span class="practice-kicker">영상 바로 아래 실습자료</span><h3 id="samplePracticeTitle">${escapeHtml(lesson.practice.title)}</h3></div>
    </div>
    <p class="practice-description">${escapeHtml(lesson.practice.description)}</p>
    <div class="practice-outcome"><span>완성 결과물</span><strong>${escapeHtml(lesson.practice.outcome)}</strong></div>

    <article class="practice-sample">
      <div class="practice-prompt-head">
        <div><strong>${escapeHtml(lesson.practice.sampleTitle)}</strong><p>${escapeHtml(lesson.practice.sampleHelp)}</p></div>
        <button class="copy-practice-button" type="button" data-copy-key="${sampleKey}">${escapeHtml(lesson.practice.sampleCopyLabel)}</button>
      </div>
      <pre>${escapeHtml(lesson.practice.sampleText)}</pre>
    </article>

    <div class="practice-section-head"><span>01</span><div><strong>영상과 함께 입력할 프롬프트</strong><p>위에서부터 한 단계씩 복사해 사용하세요.</p></div></div>
    <div class="practice-prompts">${renderPrompts()}</div>

    <div class="practice-section-head"><span>02</span><div><strong>결과 검수표</strong><p>AI의 답이 영상과 달라도 아래 기준은 직접 확인합니다.</p></div></div>
    <div class="course-checklist" data-sample-checklist>${checklist}</div>

    <div class="practice-section-head"><span>03</span><div><strong>무료 1강 파일 다운로드</strong><p>연습자료와 완성 예제까지 한 번에 확인하세요.</p></div></div>
    <div class="practice-downloads">${renderDownloads(assets)}</div>
  </section>`;

  restoreChecklist();
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  const original = button.textContent;
  button.textContent = '복사 완료';
  button.classList.add('is-copied');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('is-copied');
  }, 1400);
}

function checklistKey() {
  return 'bcc:claude101-public-sample:1-1:checks';
}

function restoreChecklist() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(checklistKey()) || '[]'); } catch (_) {}
  practiceView.querySelectorAll('[data-sample-checklist] input').forEach((input, index) => {
    input.checked = Boolean(saved[index]);
  });
}

function saveChecklist() {
  const state = [...practiceView.querySelectorAll('[data-sample-checklist] input')].map((input) => input.checked);
  try { localStorage.setItem(checklistKey(), JSON.stringify(state)); } catch (_) {}
}

function attachVideo(assets) {
  video.replaceChildren();
  const source = document.createElement('source');
  source.src = assets.videoUrl;
  source.type = 'video/mp4';
  video.append(source);
  if (assets.subtitleUrl) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.srclang = 'ko';
    track.label = '한국어';
    track.src = assets.subtitleUrl;
    track.default = true;
    video.append(track);
  }
  video.hidden = false;
  loadingView.hidden = true;
  retryButton.hidden = true;
  video.load();
}

async function loadSample() {
  loadingView.hidden = false;
  loadingView.classList.remove('is-error');
  loadingView.innerHTML = '<strong>무료 1강 영상을 불러오고 있습니다.</strong><span>잠시만 기다려 주세요.</span>';
  retryButton.hidden = true;

  try {
    const response = await fetch(`${API}/api/claude101-public-sample`);
    if (!response.ok) throw new Error(`sample ${response.status}`);
    const data = await response.json();
    if (data.lessonId !== SAMPLE_LESSON_ID || !data.lesson?.videoUrl) throw new Error('invalid sample payload');
    attachVideo(data.lesson);
    renderPractice(data.lesson);
  } catch (_) {
    video.hidden = true;
    loadingView.hidden = false;
    loadingView.classList.add('is-error');
    loadingView.innerHTML = '<strong>영상을 불러오지 못했습니다.</strong><span>잠시 후 다시 시도하거나 무료 텍스트 실습을 이용해 주세요.</span>';
    retryButton.hidden = false;
  }
}

practiceView.addEventListener('click', (event) => {
  const copyButton = event.target.closest('[data-copy-key]');
  if (copyButton) {
    const value = copyItems.get(copyButton.dataset.copyKey);
    if (value) copyText(value, copyButton);
  }

  const download = event.target.closest('[data-sample-download]');
  if (download) track('sample_download', { asset_id: download.dataset.sampleDownload });
});

practiceView.addEventListener('change', (event) => {
  if (event.target.closest('[data-sample-checklist]')) saveChecklist();
});

video.addEventListener('play', () => {
  if (video.dataset.tracked === 'true') return;
  video.dataset.tracked = 'true';
  track('sample_lesson_start');
});

retryButton.addEventListener('click', loadSample);
document.getElementById('samplePurchase').addEventListener('click', () => track('sample_purchase_click', { price: 9900 }));

track('sample_page_view');
renderPractice({ downloads: [] });
loadSample();
