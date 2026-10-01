import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

export function draftMarkdown(draft) {
  const esc=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g,'\\$1');
  return [`# ${esc(draft.title)}`, '', ...draft.sections.flatMap(section => [`## ${esc(section.heading)}`, '', esc(section.content), '']), '---', '검토용 초안입니다. 수치·날짜·기관 양식과 [확인 필요] 항목을 확인한 뒤 제출하세요.', '', '## 제출 전 확인', ...(draft.unknowns.length ? draft.unknowns.map(s=>`- [ ] ${esc(s)}`) : ['- [ ] 원자료와 최종 대조']), '', '## 근거를 확인할 표현', ...(draft.unsupportedExpressions.length ? draft.unsupportedExpressions.map(s=>`- ${esc(s)}`) : ['- 별도 표시 없음. 원자료와 직접 대조하세요.']), '', '## 첨부하면 좋은 자료', ...draft.suggestedAttachments.map(s=>`- ${esc(s)}`)].join('\n');
}
export async function draftDocx(draft) {
  const p = (text, options={}) => new Paragraph({ ...options, children:[new TextRun({text, font:'맑은 고딕'})], spacing:{after:140,line:320} });
  const children = [p(draft.title,{heading:HeadingLevel.TITLE}), p('검토용 초안 · 제출 전 사실과 기관 양식을 확인하세요.')];
  for (const section of draft.sections) { children.push(p(section.heading,{heading:HeadingLevel.HEADING_1})); for(const line of section.content.split('\n')) children.push(p(line)); }
  children.push(p('제출 전 확인',{heading:HeadingLevel.HEADING_1}));
  for (const text of draft.unknowns) children.push(p(`□ ${text}`));
  children.push(p('수치·날짜·기관 양식 및 [확인 필요] 항목을 원자료와 대조해 주세요.'));
  if (draft.unsupportedExpressions.length) {children.push(p('근거를 확인할 표현',{heading:HeadingLevel.HEADING_1}));for(const text of draft.unsupportedExpressions) children.push(p(text));}
  if (draft.suggestedAttachments.length) {children.push(p('첨부하면 좋은 자료',{heading:HeadingLevel.HEADING_1}));for(const text of draft.suggestedAttachments) children.push(p(`• ${text}`));}
  return Packer.toBlob(new Document({creator:'AI문서메이트',title:draft.title,description:'사용자 검토가 필요한 업무문서 초안',styles:{default:{document:{run:{font:'맑은 고딕',size:22}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},children}]}));
}
