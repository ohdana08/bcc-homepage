import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { COURSE_LESSONS } from './claude101-course-data.js';

const PRODUCT_ID = 'claude101-pro';
const API = window.BCC_API_BASE;
const statusView = document.getElementById('courseStatus');
const statusTitle = document.getElementById('courseStatusTitle');
const statusCopy = document.getElementById('courseStatusCopy');
const retryButton = document.getElementById('courseRetry');
const content = document.getElementById('courseContent');
const lessonsView = document.getElementById('courseLessons');
const copyItems = new Map();
let supabase;

async function getClient() {
  if (supabase) return supabase;
  const config = await fetch(`${API}/api/config`).then((response) => response.json());
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return supabase;
}

function showStatus(title, copy, retry = false) {
  statusTitle.textContent = title;
  statusCopy.textContent = copy;
  retryButton.hidden = !retry;
  statusView.hidden = false;
  content.hidden = true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function assetForLesson(apiLessons, lessonId) {
  return apiLessons.find((lesson) => lesson.id === lessonId) || {};
}

function renderVideo(lesson, assets) {
  if (!assets.videoUrl) {
    return `<div class="course-video-placeholder" role="status">
      <span>VOD ${escapeHtml(lesson.duration || '')}</span>
      <strong>영상 업로드 준비 완료</strong>
      <p>비공개 저장소 연결 후 구매 계정에서 이 자리에서 바로 재생됩니다.</p>
    </div>`;
  }

  const track = assets.subtitleUrl
    ? `<track kind="captions" srclang="ko" label="한국어" src="${escapeHtml(assets.subtitleUrl)}" default>`
    : '';
  return `<div class="course-video-wrap">
    <video class="course-video" controls playsinline preload="metadata" data-lesson-video="${escapeHtml(lesson.id)}">
      <source src="${escapeHtml(assets.videoUrl)}" type="video/mp4">
      ${track}
      현재 브라우저에서는 영상을 재생할 수 없습니다.
    </video>
  </div>`;
}

function renderPrompt(lessonId, prompt) {
  const key = `${lessonId}:${prompt.id}`;
  copyItems.set(key, prompt.text);
  return `<article class="practice-prompt">
    <div class="practice-prompt-head">
      <div><strong>${escapeHtml(prompt.label)}</strong><p>${escapeHtml(prompt.help)}</p></div>
      <button class="copy-practice-button" type="button" data-copy-key="${escapeHtml(key)}">프롬프트 복사</button>
    </div>
    <pre>${escapeHtml(prompt.text)}</pre>
  </article>`;
}

function renderDownloads(practice, assets) {
  const assetDownloads = new Map((assets.downloads || []).map((item) => [item.id, item.url]));
  return practice.downloads.map((item) => {
    const url = assetDownloads.get(item.id);
    if (!url) {
      return `<button class="practice-download is-disabled" type="button" disabled>
        <span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.format)} · 업로드 대기</small>
      </button>`;
    }
    return `<a class="practice-download" href="${escapeHtml(url)}" target="_blank" rel="noopener">
      <span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.format)} · 다운로드</small>
    </a>`;
  }).join('');
}

function renderPractice(lesson, assets) {
  const practice = lesson.practice;
  const sampleKey = `${lesson.id}:sample`;
  copyItems.set(sampleKey, practice.sampleText);
  const prompts = practice.prompts.map((prompt) => renderPrompt(lesson.id, prompt)).join('');
  const practiceLink = practice.publicUrl
    ? `<a class="practice-page-link" href="${escapeHtml(practice.publicUrl)}" target="_blank" rel="noopener">무료 실습 원문 보기 →</a>`
    : '';
  const sampleCopyLabel = practice.sampleCopyLabel || '자료 복사';
  const checklist = practice.checklist.map((item, index) => `
    <label class="course-check-item">
      <input type="checkbox" data-check-index="${index}">
      <span>${escapeHtml(item)}</span>
    </label>`).join('');

  return `<section class="practice-materials" aria-labelledby="practice-${escapeHtml(lesson.id)}">
    <div class="practice-title-row">
      <div><span class="practice-kicker">영상 아래 실습자료</span><h3 id="practice-${escapeHtml(lesson.id)}">${escapeHtml(practice.title)}</h3></div>
      ${practiceLink}
    </div>
    <p class="practice-description">${escapeHtml(practice.description)}</p>
    <div class="practice-outcome"><span>완성 결과물</span><strong>${escapeHtml(practice.outcome)}</strong></div>

    <article class="practice-sample">
      <div class="practice-prompt-head">
        <div><strong>${escapeHtml(practice.sampleTitle)}</strong><p>${escapeHtml(practice.sampleHelp)}</p></div>
        <button class="copy-practice-button" type="button" data-copy-key="${escapeHtml(sampleKey)}">${escapeHtml(sampleCopyLabel)}</button>
      </div>
      <pre>${escapeHtml(practice.sampleText)}</pre>
    </article>

    <div class="practice-section-head"><span>01</span><div><strong>영상과 함께 입력할 프롬프트</strong><p>위에서부터 한 단계씩 복사해 사용하세요.</p></div></div>
    <div class="practice-prompts">${prompts}</div>

    <div class="practice-section-head"><span>02</span><div><strong>결과 검수표</strong><p>AI 결과가 달라도 아래 기준은 직접 확인합니다.</p></div></div>
    <div class="course-checklist" data-course-checklist="${escapeHtml(lesson.id)}">${checklist}</div>

    <div class="practice-section-head"><span>03</span><div><strong>실습파일 다운로드</strong><p>영상, 프롬프트와 함께 사용할 파일입니다.</p></div></div>
    <div class="practice-downloads">${renderDownloads(practice, assets)}</div>
  </section>`;
}

function renderLesson(lesson, apiLessons) {
  const ready = lesson.status === 'ready' && lesson.practice;
  if (!ready) {
    return `<article class="course-lesson is-pending">
      <div class="lesson-summary is-static">
        <span class="lesson-number">${escapeHtml(lesson.number)}</span>
        <div><strong>${escapeHtml(lesson.title)}</strong><p>${escapeHtml(lesson.summary)}</p></div>
        <span class="state">준비 중</span>
      </div>
    </article>`;
  }

  const assets = assetForLesson(apiLessons, lesson.id);
  return `<article class="course-lesson is-ready is-open" data-lesson-id="${escapeHtml(lesson.id)}">
    <button class="lesson-summary" type="button" aria-expanded="true">
      <span class="lesson-number">${escapeHtml(lesson.number)}</span>
      <span class="lesson-summary-copy"><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.summary)}</small></span>
      <span class="state">바로 학습</span>
      <span class="lesson-toggle" aria-hidden="true">−</span>
    </button>
    <div class="lesson-body">
      ${renderVideo(lesson, assets)}
      ${renderPractice(lesson, assets)}
    </div>
  </article>`;
}

function renderCourse(apiLessons = []) {
  copyItems.clear();
  lessonsView.innerHTML = COURSE_LESSONS.map((lesson) => renderLesson(lesson, apiLessons)).join('');
  restoreChecklistState();
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

function checklistKey(lessonId) {
  return `bcc:${PRODUCT_ID}:${lessonId}:practice-checks`;
}

function restoreChecklistState() {
  document.querySelectorAll('[data-course-checklist]').forEach((view) => {
    const lessonId = view.dataset.courseChecklist;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(checklistKey(lessonId)) || '[]'); } catch (_) {}
    view.querySelectorAll('input[type="checkbox"]').forEach((input, index) => {
      input.checked = Boolean(saved[index]);
    });
  });
}

function saveChecklistState(view) {
  const lessonId = view.dataset.courseChecklist;
  const state = [...view.querySelectorAll('input[type="checkbox"]')].map((input) => input.checked);
  try { localStorage.setItem(checklistKey(lessonId), JSON.stringify(state)); } catch (_) {}
}

lessonsView.addEventListener('click', (event) => {
  const summary = event.target.closest('.lesson-summary:not(.is-static)');
  if (summary) {
    const lesson = summary.closest('.course-lesson');
    const isOpen = lesson.classList.toggle('is-open');
    summary.setAttribute('aria-expanded', String(isOpen));
    summary.querySelector('.lesson-toggle').textContent = isOpen ? '−' : '+';
    return;
  }

  const copyButton = event.target.closest('[data-copy-key]');
  if (copyButton) {
    const value = copyItems.get(copyButton.dataset.copyKey);
    if (value) copyText(value, copyButton);
  }
});

lessonsView.addEventListener('change', (event) => {
  const checklist = event.target.closest('[data-course-checklist]');
  if (checklist) saveChecklistState(checklist);
});

lessonsView.addEventListener('play', (event) => {
  const video = event.target.closest('[data-lesson-video]');
  if (!video || video.dataset.tracked === 'true') return;
  video.dataset.tracked = 'true';
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'lesson_start', { product_id: PRODUCT_ID, lesson_id: video.dataset.lessonVideo });
    }
  } catch (_) {}
}, true);

async function checkAccess(attempt = 0) {
  showStatus('수강권을 확인하고 있습니다.', '결제를 막 마쳤다면 웹훅이 도착할 때까지 잠시 기다려 주세요.');
  try {
    const client = await getClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) {
      showStatus('로그인이 필요합니다.', '결제할 때 사용한 BCC 계정으로 로그인해 주세요.', true);
      retryButton.textContent = '마이페이지에서 로그인';
      retryButton.onclick = () => { location.href = 'mypage.html'; };
      return;
    }

    const response = await fetch(`${API}/api/course-access?productId=${PRODUCT_ID}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (response.ok) {
      const courseData = await response.json();
      if (window.opener && !window.opener.closed && new URLSearchParams(location.search).get('payment') === 'complete') {
        window.opener.postMessage('bcc:claude101:paid', location.origin);
        showStatus('결제가 확인되었습니다.', '원래 홈페이지에서 수강실을 열고 있습니다.');
        setTimeout(() => window.close(), 500);
        return;
      }
      renderCourse(courseData.lessons || []);
      statusView.hidden = true;
      content.hidden = false;
      try { if (typeof window.gtag === 'function') window.gtag('event', 'course_enter', { product_id: PRODUCT_ID }); } catch (_) {}
      return;
    }

    if (response.status === 403 && attempt < 10 && new URLSearchParams(location.search).get('payment') === 'complete') {
      setTimeout(() => checkAccess(attempt + 1), 1800);
      return;
    }
    showStatus('아직 수강권이 확인되지 않았습니다.', '결제를 완료했다면 10초 뒤 다시 확인해 주세요. 계속되면 BCC 고객문의로 알려주세요.', true);
    retryButton.textContent = '다시 확인';
    retryButton.onclick = () => checkAccess(0);
  } catch (_) {
    showStatus('수강권 확인이 지연되고 있습니다.', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.', true);
    retryButton.textContent = '다시 확인';
    retryButton.onclick = () => checkAccess(0);
  }
}

const isLocalCoursePreview = ['127.0.0.1', 'localhost'].includes(location.hostname)
  && new URLSearchParams(location.search).get('preview') === 'course';

if (isLocalCoursePreview) {
  renderCourse([]);
  statusView.hidden = true;
  content.hidden = false;
} else {
  checkAccess();
}
