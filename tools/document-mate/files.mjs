const MAX_SIZE = 5 * 1024 * 1024;
const MAX_TEXT = 12000;
const LIMIT_MESSAGE = '한 파일에서 읽은 내용이 12,000자를 넘습니다. 필요한 부분만 남겨 다시 올려주세요.';
const descendants = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const children = (node, name) => [...node.children].filter(n => n.localName === name);

function readXml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('외부 참조가 있는 XML 문서는 지원하지 않습니다.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('문서 내부 형식이 손상되어 읽을 수 없습니다.');
  return doc;
}
function inlineText(node) {
  let result = '';
  for (const child of node.children || []) {
    if (child.localName === 'tbl') continue;
    if (child.localName === 't') result += child.textContent;
    else if (child.localName === 'tab') result += '\t';
    else if (['br', 'lineBreak'].includes(child.localName)) result += '\n';
    else result += inlineText(child);
  }
  return result;
}
function tableText(table) {
  const rows = descendants(table, 'tr').filter(row => {
    let p = row.parentElement; while (p && p !== table) { if (p.localName === 'tbl') return false; p = p.parentElement; } return true;
  });
  return ['[표 시작]', ...rows.map(row => children(row, 'tc').map(cell => {
    const txt = descendants(cell, 'p').filter(p => !descendants(p, 'p').length).map(p=>inlineText(p).trim()).filter(Boolean).join(' / ');
    return txt || '[빈 칸]';
  }).join(' | ')), '[표 끝]'].join('\n');
}
export function extractXmlDocument(entries, format) {
  const sections = [];
  const keys = Object.keys(entries).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const key of keys) {
    const doc = readXml(entries[key]);
    const root = format === 'docx' ? descendants(doc, 'body')[0] : doc.documentElement;
    if (!root) throw new Error('문서 본문이 없습니다.');
    const blocks = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.localName === 'tbl') blocks.push(tableText(child));
        else if (child.localName === 'p') {
          const text = inlineText(child).trim(); if (text) blocks.push(text);
          const tables = descendants(child, 'tbl').filter(t => { let p = t.parentElement; while (p !== child) { if (p.localName === 'tbl') return false; p = p.parentElement; } return true; });
          for (const table of tables) blocks.push(tableText(table));
        } else walk(child);
      }
    };
    walk(root); sections.push(blocks.join('\n'));
  }
  return sections.join('\n\n');
}
async function unzip(buffer, format) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/tools/document-mate/vendor/zip-worker.js', { type:'module' });
    const finish = fn => value => { clearTimeout(timer); worker.terminate(); fn(value); };
    const timer = setTimeout(finish(reject), 15000, new Error('파일 읽기가 오래 걸립니다. 더 작은 문서로 다시 시도해 주세요.'));
    worker.onmessage = ({data}) => data.error ? finish(reject)(new Error(data.error)) : finish(resolve)(data.entries);
    worker.onerror = () => finish(reject)(new Error('파일 읽기 도구를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'));
    worker.postMessage({ buffer, format }, [buffer]);
  });
}
async function extractPdf(buffer) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/tools/document-mate/vendor/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported:false, useSystemFonts:true, cMapUrl:'/tools/document-mate/vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'/tools/document-mate/vendor/standard_fonts/', wasmUrl:'/tools/document-mate/vendor/wasm/' });
  task.onPassword = () => task.destroy();
  const timeout = setTimeout(() => task.destroy(), 30000);
  try {
    const doc = await task.promise;
    if (doc.numPages > 40) throw new Error('PDF는 40쪽까지 읽을 수 있습니다. 필요한 페이지만 남겨주세요.');
    const pages = []; const emptyPages = []; let size = 0;
    for (let i=1;i<=doc.numPages;i++) {
      const page = await doc.getPage(i); const reader = page.streamTextContent().getReader();
      let lines = '', lastY = null, itemCount=0;
      try { while(true) {const {value,done}=await reader.read();if(done)break;
        for (const item of value.items) {
          if (!('str' in item)) continue;
          if(++itemCount>20000)throw new Error('한 페이지의 구조가 너무 복잡합니다. 필요한 부분을 복사해 입력해 주세요.');
          const y = item.transform?.[5];
          if (lastY !== null && Math.abs(y-lastY)>3) lines += '\n';
          lines += item.str + (item.hasEOL ? '\n' : ' '); lastY = y;
          if(size+lines.length>MAX_TEXT)throw new Error(LIMIT_MESSAGE);
        }
      }} finally { await reader.cancel().catch(()=>{}); }
      lines = lines.trim(); if (!lines) emptyPages.push(i);
      size += lines.length; if (size > MAX_TEXT) throw new Error(LIMIT_MESSAGE);
      pages.push(`[${i}쪽]\n${lines || '[이 페이지에서 읽을 수 있는 텍스트 없음]'}`); page.cleanup();
    }
    if (emptyPages.length === doc.numPages) throw new Error('글자를 읽을 수 없는 스캔 PDF입니다. OCR로 변환하거나 내용을 직접 붙여 넣어주세요.');
    const warnings = ['PDF의 글자와 읽기 순서를 추출했습니다. 표의 열·병합셀·이미지와 일부 기호는 직접 확인해 주세요.'];
    if (emptyPages.length) warnings.push(`${emptyPages.join(', ')}쪽은 텍스트를 읽지 못했습니다. 빠진 내용을 직접 추가해 주세요.`);
    return { text:pages.join('\n\n'),warnings };
  } catch(error) {
    if (/Password|destroy|Worker was terminated/.test(error.message)) throw new Error('암호가 걸렸거나 읽기를 완료하지 못한 PDF입니다. 암호를 해제하거나 더 작은 파일을 사용해 주세요.');
    throw error;
  } finally { clearTimeout(timeout); await task.destroy(); }
}
export async function readDocument(file) {
  if (file.size > MAX_SIZE) throw new Error('파일은 각각 5MB까지 추가할 수 있습니다.');
  if (!file.size) throw new Error('내용이 없는 파일입니다.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (!['pdf','docx','hwpx','txt','md'].includes(ext)) throw new Error('지원 형식은 PDF, DOCX, HWPX, TXT, MD입니다. HWP·이미지는 변환 후 추가해 주세요.');
  let result;
  if (ext === 'pdf') result = await extractPdf(await file.arrayBuffer());
  else if (['docx','hwpx'].includes(ext)) result = {text:extractXmlDocument(await unzip(await file.arrayBuffer(), ext),ext),warnings:[`${ext.toUpperCase()}의 문단·항목·표 텍스트를 읽었습니다. 원본 서식·이미지·머리말·각주는 재현하지 않으니 추출 내용을 확인해 주세요.`]};
  else result = {text:new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),warnings:[]};
  if (!result.text.trim()) throw new Error('읽을 수 있는 본문이 없습니다. 텍스트를 직접 입력해 주세요.');
  if (result.text.length>MAX_TEXT) throw new Error(LIMIT_MESSAGE);
  return result;
}
