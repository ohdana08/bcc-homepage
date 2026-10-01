import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, VerticalAlign } from 'docx';
const esc=text=>String(text??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g,'\\$1');
const heading=s=>s.heading&&s.heading!=='본문'?s.heading:'';
function reviewLines(draft) {
  return ['제출 전 검토 메모',...(draft.unknowns||[]),...(draft.unsupportedExpressions||[]),...(draft.qualityNotes||[]),...(draft.suggestedAttachments||[]).map(x=>`준비 검토: ${x}`),'수신자·수치·날짜·관련 근거·실제 붙임과 기관 양식을 확인하세요.'];
}
export function draftPlainText(draft,{includeReview=false}={}) {
  const out=[];
  if(draft.recipient)out.push(`수신  ${draft.recipient}`);
  out.push(draft.title,'');
  for(const s of draft.sections){if(heading(s))out.push(heading(s));if(s.content)out.push(s.content);if(s.table?.headers?.length){out.push(s.table.headers.join('\t'));for(const row of s.table.rows)out.push(row.join('\t'));}out.push('');}
  if(draft.closing)out.push(draft.closing);
  if(draft.sender)out.push('',draft.sender);
  if(includeReview)out.push('','---',...reviewLines(draft));
  return out.join('\n').trim();
}
export function draftMarkdown(draft,{includeReview=false}={}) {
  const out=[`# ${esc(draft.title)}`,''];
  if(draft.recipient)out.push(`수신: ${esc(draft.recipient)}`,'');
  for(const s of draft.sections){if(heading(s))out.push(`## ${esc(heading(s))}`,'');if(s.content)out.push(esc(s.content),'');if(s.table?.headers?.length){out.push(`| ${s.table.headers.map(esc).join(' | ')} |`,`| ${s.table.headers.map(()=>'---').join(' | ')} |`,...s.table.rows.map(row=>`| ${row.map(x=>esc(x).replace(/\n/g,'<br>')).join(' | ')} |`),'');}}
  if(draft.closing)out.push(esc(draft.closing),'');if(draft.sender)out.push(esc(draft.sender),'');
  if(includeReview)out.push('---','',...reviewLines(draft).map(esc));
  return out.join('\n').trim();
}
export async function draftDocx(draft,{includeReview=false}={}) {
  const p=(text,options={})=>new Paragraph({spacing:{after:120,line:340},...options,children:[new TextRun({text:String(text??''),font:'맑은 고딕',color:'000000',...(options.run||{})})]});
  const children=[];
  if(draft.recipient)children.push(p(`수신  ${draft.recipient}`,{spacing:{after:180,line:340}}));
  children.push(p(draft.title,{heading:HeadingLevel.TITLE,keepNext:true,spacing:{after:320,line:400},run:{bold:true,size:32}}));
  for(const s of draft.sections){
    if(heading(s))children.push(p(heading(s),{heading:HeadingLevel.HEADING_1,keepNext:true,spacing:{before:200,after:120,line:340},run:{bold:true,size:24}}));
    for(const line of (s.content||'').split('\n'))if(line.trim())children.push(p(line,{widowControl:true}));
    if(s.table?.headers?.length){
      const columns=s.table.headers.length;
      const widths=columns===2?[2200,7438]:Array.from({length:columns},(_,i)=>i===0?Math.floor(9638*.22):Math.floor(9638*.78/(columns-1)));
      const border={style:BorderStyle.SINGLE,size:4,color:'D9D9D9'};
      const cell=(text,i,header=false)=>new TableCell({width:{size:widths[i],type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,margins:{top:110,bottom:110,left:130,right:130},shading:{fill:header?'EDF0F2':'FFFFFF'},children:String(text??'').split('\n').map(line=>p(line,{spacing:{after:0,line:300},run:{bold:header,size:21}}))});
      children.push(new Table({width:{size:9638,type:WidthType.DXA},columnWidths:widths,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},rows:[new TableRow({tableHeader:true,children:s.table.headers.map((x,i)=>cell(x,i,true))}),...s.table.rows.map(row=>new TableRow({cantSplit:true,children:s.table.headers.map((_,i)=>cell(row[i]||'',i))}))]}));
      children.push(p('',{spacing:{after:100}}));
    }
  }
  if(draft.closing)for(const line of draft.closing.split('\n'))children.push(p(line));
  if(draft.sender)children.push(p(draft.sender,{alignment:'center',spacing:{before:280,after:120},run:{bold:true,size:26}}));
  if(includeReview){const notes=reviewLines(draft);children.push(p(notes.shift(),{heading:HeadingLevel.HEADING_1,pageBreakBefore:true,run:{bold:true,size:24}}));for(const line of notes)children.push(p(line,{run:{size:20}}));}
  return Packer.toBlob(new Document({creator:'AI문서메이트',title:draft.title,description:'사용자가 확인하고 수정할 업무문서 초안',styles:{default:{document:{run:{font:'맑은 고딕',size:22,color:'000000'},paragraph:{spacing:{line:340}}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',run:{font:'맑은 고딕',size:32,bold:true,color:'000000'}},{id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',run:{font:'맑은 고딕',size:24,bold:true,color:'000000'}}]},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,bottom:1134,left:1134,right:1134}}},children}]}));
}
