// 공통 "입구" 모듈 (프론트) — 카드뉴스·스레드·블로그 세 공장이 import 해서 재사용한다.
// [텍스트 벤치마킹 / 이미지 벤치마킹] 토글 + 이미지 첨부(파일/붙여넣기/썸네일, 최대 4장).
// 같은 코드를 3곳에 복붙하지 않기 위해 단일화. (.tab/.row/.muted/.step-label 등 디자인 토큰은 세 페이지 공통)

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return; stylesInjected = true;
  const css =
    '.bm-thumbgrid{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
    '.bm-thumb{position:relative;width:72px;height:72px;border-radius:10px;overflow:hidden;border:1px solid var(--border);background:#000}' +
    '.bm-thumb img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.bm-thumb .rm{position:absolute;top:2px;right:2px;width:20px;height:20px;border:none;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
    '.bm-thumb .rm:hover{background:#ff5050}';
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
}

// 업로드 이미지 → 긴 변 1568px 이하 JPEG base64 (Claude 비전 권장 + 전송 경량화).
export function fileToScaledBase64(file, maxEdge = 1568, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const r = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.round(w * r); h = Math.round(h * r);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
      };
      img.onerror = reject; img.src = fr.result;
    };
    fr.onerror = reject; fr.readAsDataURL(file);
  });
}

const ESC = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 표준 입구 UI 를 mount 엘리먼트에 렌더하고 컨트롤러를 반환한다.
//   opts: { mount, stepLabel, textPlaceholder, textHint, imageHint, onChange }
export function createBenchmarkInput(opts = {}) {
  injectStyles();
  const mount = typeof opts.mount === 'string' ? document.getElementById(opts.mount) : opts.mount;
  if (!mount) throw new Error('benchmark-input: mount 엘리먼트를 찾을 수 없습니다.');

  const stepLabel = opts.stepLabel || '① 원본 콘텐츠';
  const textPlaceholder = opts.textPlaceholder ||
    '① 워크플로우·프롬프트·노하우(보는 사람에게 방법 전달), 또는 ② 잘 터진 블로그·뉴스·스레드 글(참고용)을 붙여넣으세요.';
  const textHint = opts.textHint ||
    '내 방법(프롬프트/워크플로우)이면 살려서, 남의 글이면 저작권 맞춰 새로 써요. (AI가 자동 판별)';
  const imageHintDefault = opts.imageHint ||
    '워크플로우·프롬프트 캡처(방법 전달), 또는 잘 터진 게시글 캡처(참고용)를 올리거나 붙여넣기(Ctrl/⌘+V) 하세요. 최대 4장.';
  const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

  mount.innerHTML =
    '<div class="step-label">' + ESC(stepLabel) + '</div>' +
    '<div class="tabs bm-tabs" style="margin-bottom:12px">' +
      '<button type="button" class="tab active" data-bm="text">텍스트 벤치마킹</button>' +
      '<button type="button" class="tab" data-bm="image">이미지 벤치마킹</button>' +
    '</div>' +
    '<div class="row bm-textrow">' +
      '<textarea class="bm-text" rows="8" placeholder="' + ESC(textPlaceholder) + '"></textarea>' +
      '<div class="muted">' + ESC(textHint) + '</div>' +
    '</div>' +
    '<div class="row bm-imagerow" style="display:none">' +
      '<input class="bm-file" type="file" accept="image/*" multiple />' +
      '<div class="muted bm-imghint" style="margin-top:6px">' + ESC(imageHintDefault) + '</div>' +
      '<div class="bm-thumbgrid"></div>' +
    '</div>';

  const q = (sel) => mount.querySelector(sel);
  const tabs = q('.bm-tabs');
  const textRow = q('.bm-textrow'), imageRow = q('.bm-imagerow');
  const textEl = q('.bm-text'), fileEl = q('.bm-file');
  const grid = q('.bm-thumbgrid'), imgHint = q('.bm-imghint');
  let mode = 'text';
  let files = [];

  function renderThumbs() {
    grid.innerHTML = '';
    files.forEach((f, i) => {
      const d = document.createElement('div'); d.className = 'bm-thumb';
      const im = document.createElement('img'); im.src = URL.createObjectURL(f); im.alt = '';
      const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm'; rm.textContent = '✕'; rm.title = '제거';
      rm.addEventListener('click', () => { files.splice(i, 1); renderThumbs(); onChange(); });
      d.appendChild(im); d.appendChild(rm); grid.appendChild(d);
    });
    imgHint.textContent = files.length
      ? files.length + '장 첨부됨' + (files.length >= 4 ? ' (최대 4장)' : '') + ' — 이미지의 구조·논리만 읽어 처리해요.'
      : imageHintDefault;
  }
  function addFiles(list) {
    for (const f of list) {
      if (!f || !f.type || !f.type.startsWith('image/')) continue;
      if (files.length >= 4) break;
      files.push(f);
    }
    renderThumbs(); onChange();
  }
  tabs.addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    mode = b.dataset.bm;
    tabs.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    textRow.style.display = mode === 'text' ? '' : 'none';
    imageRow.style.display = mode === 'image' ? '' : 'none';
    onChange();
  });
  fileEl.addEventListener('change', () => { addFiles(Array.from(fileEl.files || [])); fileEl.value = ''; });
  // 클립보드 붙여넣기 — 이 입구의 이미지 모드가 화면에 보일 때만 받는다(다른 입구로 가려지면 무시).
  window.addEventListener('paste', (e) => {
    if (mode !== 'image' || imageRow.offsetParent === null) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imgs = [];
    for (const it of items) { if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  });

  return {
    getMode: () => mode,
    getText: () => textEl.value.trim(),
    getFileCount: () => files.length,
    getImages: () => Promise.all(files.map((f) => fileToScaledBase64(f))),
    // 유효성 검사 — 통과 시 null, 실패 시 사용자에게 보여줄 메시지.
    validate() {
      if (mode === 'image') return files.length ? null : '벤치마킹할 이미지를 올리거나 붙여넣어 주세요.';
      return textEl.value.trim().length >= 30 ? null : '텍스트를 30자 이상 붙여넣어 주세요.';
    },
    // 전송용 payload — { mode:'text', text } 또는 { mode:'image', images:[{base64,mediaType}] }
    async payload() {
      if (mode === 'image') return { mode, images: await this.getImages() };
      return { mode, text: textEl.value.trim() };
    },
    reset() {
      files = []; textEl.value = ''; mode = 'text';
      tabs.querySelectorAll('.tab').forEach((x, i) => x.classList.toggle('active', i === 0));
      textRow.style.display = ''; imageRow.style.display = 'none';
      renderThumbs();
    },
  };
}
