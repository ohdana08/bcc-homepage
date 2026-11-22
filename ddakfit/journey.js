const editorOrigin = 'https://ddakfit.bccconsulting.kr';
const editorPanels = ['diagnosis', 'plan', 'presentation'];
const editorBox = document.getElementById('journey-editor');
const editorFrame = editorBox.querySelector('iframe');
const journeyNav = document.querySelector('.journey-nav');
let currentNotice = '';
let activeEditor = '';

function updateJourney() {
  const hash = location.hash.slice(1);
  const panel = hash.startsWith('region=') ? 'links' : hash === 'find' ? 'recommend' : hash;
  for (const link of journeyNav.querySelectorAll('a')) {
    if (link.hash === '#' + panel) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.body.classList.toggle('in-journey', !!journeyNav.querySelector('[aria-current]'));
  editorBox.hidden = !editorPanels.includes(panel);
  if (editorBox.hidden) return;
  activeEditor = panel;
  if (!editorFrame.hasAttribute('src')) {
    const url = new URL('/embed', editorOrigin);
    url.searchParams.set('journey', panel);
    if (currentNotice) url.searchParams.set('noticeUrl', currentNotice);
    editorFrame.src = url.href;
  } else {
    editorFrame.contentWindow.postMessage({type:'fit-panel', panel}, editorOrigin);
  }
}

function openNoticeDiagnosis(url) {
  if (url !== currentNotice && editorFrame.hasAttribute('src')) {
    if (!window.confirm('새 공고로 진단을 시작할까요? 현재 작업 화면에서 아직 저장하지 않은 입력은 사라질 수 있습니다.')) return false;
    editorFrame.removeAttribute('src');
  }
  currentNotice = url;
  location.hash = 'diagnosis';
  updateJourney();
  return true;
}

window.addEventListener('message', event => {
  if (event.origin !== editorOrigin || event.source !== editorFrame.contentWindow) return;
  if (event.data?.type === 'fit-ready' && activeEditor) {
    editorFrame.contentWindow.postMessage({type:'fit-panel', panel:activeEditor}, editorOrigin);
  }
  if (event.data?.type === 'fit-navigate' && editorPanels.includes(event.data.panel)) {
    location.hash = event.data.panel;
  }
});
