import { Unzip, UnzipInflate } from 'fflate';

self.onmessage = ({ data }) => {
  try {
    const bytes = new Uint8Array(data.buffer);
    if (bytes.length > 5 * 1024 * 1024) throw new Error('파일은 5MB 이하여야 합니다.');
    let count = 0, total = 0, pending = 0;
    const entries = {};
    const unzip = new Unzip(file => {
      if (++count > 1200) throw new Error('내부 항목이 너무 많은 문서입니다.');
      const wanted = data.format === 'docx' ? file.name === 'word/document.xml' : /^Contents\/section\d+\.xml$/.test(file.name);
      if (!wanted) return;
      if (Object.hasOwn(entries, file.name)) throw new Error('중복된 내부 문서가 있습니다.');
      if ((file.originalSize || 0) > 2 * 1024 * 1024) throw new Error('문서의 텍스트 구조가 너무 큽니다.');
      if (Object.keys(entries).length >= 40) throw new Error('문서 구역은 40개까지 읽을 수 있습니다.');
      entries[file.name] = null;
      let size = 0; const chunks = []; pending++;
      file.ondata = (error, chunk, final) => {
        if (error) throw new Error('문서의 압축을 해제하지 못했습니다.');
        size += chunk.length; total += chunk.length;
        if (size > 2 * 1024 * 1024 || total > 4 * 1024 * 1024) throw new Error('압축 해제한 문서가 너무 큽니다.');
        chunks.push(chunk);
        if (final) {
          const all = new Uint8Array(size); let offset = 0;
          for (const part of chunks) { all.set(part, offset); offset += part.length; }
          entries[file.name] = new TextDecoder('utf-8', { fatal: true }).decode(all);
          pending--;
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let pos = 0; pos < bytes.length; pos += 4096) unzip.push(bytes.subarray(pos, pos + 4096), pos + 4096 >= bytes.length);
    if (pending || !Object.keys(entries).length) throw new Error('문서 본문을 찾을 수 없습니다. 암호화되지 않은 DOCX 또는 HWPX인지 확인해 주세요.');
    self.postMessage({ entries });
  } catch (error) { self.postMessage({ error: error.message || '파일을 읽지 못했습니다.' }); }
};
