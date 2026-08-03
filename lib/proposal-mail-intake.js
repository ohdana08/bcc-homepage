import { timingSafeEqual } from 'node:crypto';
import { HwpxReader, detectFormat, hwpToText } from '@ssabrojs/hwpxjs';
import { generateProposal } from './proposal-os.js';

const MAX_BODY_CHARS = 60000;
const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 2_000_000;
const MAX_TOTAL_ATTACHMENT_BYTES = 2_800_000;
const SOURCE_PREFIX = 'gmail:';

function clean(value, max = 10000) {
  return String(value ?? '').trim().slice(0, max);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseAddress(value) {
  const text = clean(value, 500);
  const bracket = text.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  if (bracket) return { name: clean(bracket[1], 160), email: clean(bracket[2], 254).toLowerCase() };
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  return { name: clean(text.replace(email, '').replace(/[<>"']/g, ''), 160), email: email.toLowerCase() };
}

function extractForwardedEnvelope(body, fallbackFrom, fallbackSubject) {
  const text = clean(body, MAX_BODY_CHARS);
  const fromLine = text.match(/^(?:보낸\s*사람|보낸사람|From)\s*:\s*(.+)$/im)?.[1];
  const subjectLine = text.match(/^(?:제목|Subject)\s*:\s*(.+)$/im)?.[1];
  const from = parseAddress(fromLine || fallbackFrom);
  return {
    from,
    subject: clean(subjectLine || fallbackSubject || '(제목 없음)', 500),
  };
}

function inferInstitutionName(subject, senderName, senderEmail) {
  const bracketed = clean(subject, 500).match(/^\s*\[([^\]]{2,120})\]/)?.[1];
  if (bracketed) return clean(bracketed.replace(/문의|강의요청|강의 요청$/g, ''), 160);
  const cleanedName = clean(senderName, 160).replace(/\s*(담당자|주임|대리|과장|팀장|센터장|선생님|님)\s*$/g, '');
  if (cleanedName && !/@/.test(cleanedName)) return cleanedName;
  const domain = String(senderEmail || '').split('@')[1]?.split('.')[0] || '';
  return clean(domain || '기관명 확인 필요', 160);
}

function attachmentBytes(base64) {
  try {
    return Buffer.byteLength(String(base64 || ''), 'base64');
  } catch {
    return 0;
  }
}

function normalizeAttachments(items) {
  const attachments = Array.isArray(items) ? items.slice(0, MAX_ATTACHMENT_COUNT) : [];
  let total = 0;
  return attachments.map((item) => {
    const data = String(item?.data_base64 || '').replace(/\s+/g, '');
    const size = attachmentBytes(data);
    total += size;
    if (!item?.filename || !data) throw Object.assign(new Error('첨부파일 이름 또는 데이터가 비어 있습니다.'), { httpStatus: 400 });
    if (size > MAX_ATTACHMENT_BYTES) throw Object.assign(new Error(`첨부파일이 너무 큽니다: ${clean(item.filename, 180)}`), { httpStatus: 413 });
    return {
      filename: clean(item.filename, 220),
      mimeType: clean(item.mime_type || 'application/octet-stream', 120).toLowerCase(),
      data,
      size,
    };
  }).map((item) => {
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw Object.assign(new Error('첨부파일 전체 용량이 자동 처리 한도를 넘었습니다.'), { httpStatus: 413 });
    }
    return item;
  });
}

async function extractAttachment(item) {
  const bytes = new Uint8Array(Buffer.from(item.data, 'base64'));
  const extension = item.filename.toLowerCase().split('.').pop() || '';
  const format = detectFormat(bytes);

  if (format === 'hwp' || extension === 'hwp') {
    return { text: await hwpToText(bytes), sourceBlocks: [], status: 'HWP 텍스트 추출 완료' };
  }
  if (format === 'hwpx' || extension === 'hwpx') {
    const reader = new HwpxReader();
    await reader.loadFromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return { text: await reader.extractText(), sourceBlocks: [], status: 'HWPX 텍스트 추출 완료' };
  }
  if (item.mimeType === 'application/pdf' || extension === 'pdf') {
    return {
      text: '',
      sourceBlocks: [
        { type: 'text', text: `# 기관 첨부 PDF: ${item.filename}` },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: item.data } },
      ],
      status: 'PDF 원문을 AI 검토 자료로 전달',
    };
  }
  if (/^image\/(jpeg|png|gif|webp)$/.test(item.mimeType)) {
    return {
      text: '',
      sourceBlocks: [
        { type: 'text', text: `# 기관 첨부 이미지: ${item.filename}` },
        { type: 'image', source: { type: 'base64', media_type: item.mimeType, data: item.data } },
      ],
      status: '이미지를 AI 검토 자료로 전달',
    };
  }
  if (/^(text\/|application\/(json|csv|xml))/.test(item.mimeType) || ['txt', 'md', 'csv', 'json', 'xml'].includes(extension)) {
    return { text: Buffer.from(item.data, 'base64').toString('utf8'), sourceBlocks: [], status: '텍스트 추출 완료' };
  }
  return { text: '', sourceBlocks: [], status: '자동 추출 미지원 — 사람이 원본 확인 필요' };
}

async function prepareSources(attachments) {
  const textSections = [];
  const sourceBlocks = [];
  const statuses = [];
  for (const item of attachments) {
    try {
      const extracted = await extractAttachment(item);
      if (extracted.text) textSections.push(`[기관 첨부양식: ${item.filename}]\n${clean(extracted.text, 30000)}`);
      sourceBlocks.push(...extracted.sourceBlocks);
      statuses.push({ filename: item.filename, status: extracted.status, size: item.size });
    } catch (error) {
      statuses.push({ filename: item.filename, status: `추출 실패 — ${clean(error?.message || error, 240)}`, size: item.size });
      textSections.push(`[첨부파일 확인 필요: ${item.filename}]\n자동 추출에 실패했습니다. 사람이 원본을 확인해야 합니다.`);
    }
  }
  return { textSections, sourceBlocks, statuses };
}

function bullet(items, render = (item) => String(item)) {
  return Array.isArray(items) && items.length ? items.map((item) => `- ${render(item)}`).join('\n') : '- 없음';
}

function renderResultText({ proposalCase, output, envelope, attachmentStatuses }) {
  const demand = output.demand_analysis || {};
  const recommendation = output.recommendation || {};
  const proposal = output.proposal || {};
  const qa = output.qa || {};
  const form = proposal.institution_form || {};
  const email = output.email_draft || {};
  const curriculum = Array.isArray(output.curriculum) ? output.curriculum : [];

  return `강메일 기관 제안 자동처리 결과

[원본]
기관: ${proposalCase.institution_name || '확인 필요'}
제목: ${envelope.subject}
보낸사람: ${envelope.from.name || '-'} <${envelope.from.email || '-'}>
수신시각: ${proposalCase.inquiry_date || '-'}

[첨부파일 처리]
${bullet(attachmentStatuses, (item) => `${item.filename}: ${item.status}`)}

[확정 사실]
${bullet(demand.confirmed_facts, (item) => `${item.fact} (근거: ${item.source})`)}

[추가 확인 질문]
${bullet(demand.unknowns)}

[추천 과정]
과정명: ${recommendation.course_title || '-'}
대상: ${recommendation.target || '-'}
시간: ${recommendation.duration || '-'}
형태: ${recommendation.delivery_format || '-'}
추천 이유: ${recommendation.fit_reason || '-'}

[무료 도구 인계 흐름]
${bullet(recommendation.tool_workflow, (item) => `${item.step}. ${item.tool} — ${item.task} → ${item.output} (${item.free_plan_note})`)}

[제안서 요약]
${proposal.executive_summary || '-'}

목표
${bullet(proposal.objectives)}

운영안
${bullet(proposal.operation_plan)}

[커리큘럼]
${bullet(curriculum, (item) => `${item.session}차시 | ${item.title} | ${item.minutes}분 | ${item.tool}\n  목표: ${item.objective}\n  활동: ${(item.activities || []).join(' / ')}\n  결과물: ${item.output}\n  검수: ${item.verification_point}`)}

[기관 양식에 옮길 문장]
교육 목적: ${form.purpose || '-'}
교육 목표:
${bullet(form.objectives)}
핵심 내용:
${bullet(form.core_contents)}
교육 방법:
${bullet(form.teaching_methods)}
기대 효과:
${bullet(form.expected_effects)}

[기관 회신 이메일 초안]
제목: ${email.subject || '-'}

${email.body || '-'}

[최종 검수]
사실 확인 필요:
${bullet(qa.facts_to_verify)}
위험 신호:
${bullet(qa.risk_flags)}
유료 기능 의존:
${bullet(qa.paid_feature_dependencies)}
출처 범위:
${bullet(qa.source_coverage)}
완성도: ${qa.completeness_score ?? '-'}

※ 이 결과는 초안입니다. 실제 기관 발송은 Daum 메일에서 검수한 뒤 진행하세요.`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function resolveOwnerId(db) {
  const configured = clean(process.env.PROPOSAL_OWNER_ID, 80);
  if (configured) return configured;
  const { data, error } = await db.from('profiles').select('id').eq('is_admin', true).limit(1).maybeSingle();
  if (error || !data?.id) throw new Error('기관 제안 소유 관리자 계정을 찾지 못했습니다.');
  return data.id;
}

async function latestOutput(db, caseId) {
  const { data, error } = await db
    .from('proposal_outputs')
    .select('*')
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function handleProposalMailIntake(req, res, { db, client }) {
  const configuredSecret = process.env.PROPOSAL_MAIL_SECRET;
  const providedSecret = req.headers['x-bcc-mail-secret'];
  if (!configuredSecret || configuredSecret.length < 24) {
    return res.status(503).json({ error: '메일 자동화 비밀값이 설정되지 않았습니다.' });
  }
  if (!safeEqual(providedSecret, configuredSecret)) return res.status(401).json({ error: 'Unauthorized' });

  const resultRecipient = clean(process.env.PROPOSAL_RESULT_EMAIL, 254).toLowerCase();
  if (!resultRecipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resultRecipient)) {
    return res.status(503).json({ error: '결과 수신 이메일이 설정되지 않았습니다.' });
  }

  const payload = req.body?.message || {};
  const messageId = clean(payload.message_id, 240);
  const receivedAt = clean(payload.received_at, 80);
  const body = clean(payload.plain_body, MAX_BODY_CHARS);
  const attachments = normalizeAttachments(payload.attachments);
  if (!messageId || (!body && !attachments.length)) {
    return res.status(400).json({ error: '메일 ID와 본문 또는 첨부파일이 필요합니다.' });
  }

  const envelope = extractForwardedEnvelope(body, payload.from, payload.subject);
  const { textSections, sourceBlocks, statuses } = await prepareSources(attachments);
  const inquiryText = clean([
    `[기관 이메일]\n제목: ${envelope.subject}\n보낸사람: ${envelope.from.name} <${envelope.from.email}>\n\n${body}`,
    ...textSections,
  ].join('\n\n'), 80000);
  const source = `${SOURCE_PREFIX}${messageId}`;

  let { data: proposalCase, error: caseLookupError } = await db
    .from('proposal_cases')
    .select('*')
    .eq('source', source)
    .limit(1)
    .maybeSingle();
  if (caseLookupError) throw caseLookupError;

  if (!proposalCase) {
    const ownerId = await resolveOwnerId(db);
    const date = /^\d{4}-\d{2}-\d{2}/.test(receivedAt) ? receivedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const { data, error } = await db.from('proposal_cases').insert({
      owner_id: ownerId,
      institution_name: inferInstitutionName(envelope.subject, envelope.from.name, envelope.from.email),
      contact_name: envelope.from.name || null,
      contact_email: envelope.from.email || null,
      inquiry_date: date,
      inquiry_text: inquiryText,
      source,
      status: 'inquiry',
      next_action: 'Daum 메일에서 자동 생성 초안 검수',
    }).select('*').single();
    if (error) throw error;
    proposalCase = data;
  }

  let output = await latestOutput(db, proposalCase.id);
  if (!output) {
    const previousStatus = proposalCase.status;
    try {
      output = await generateProposal({ db, client, caseId: proposalCase.id, sourceBlocks });
    } catch (error) {
      await db.from('proposal_cases').update({ status: previousStatus, updated_at: new Date().toISOString() }).eq('id', proposalCase.id);
      throw error;
    }
  }

  const text = renderResultText({ proposalCase, output, envelope, attachmentStatuses: statuses });
  return res.json({
    ok: true,
    dedupe_key: source,
    case_id: proposalCase.id,
    output_id: output.id,
    mail: {
      recipient: resultRecipient,
      subject: clean(`[강메일 처리완료] ${envelope.subject}`, 200),
      text,
      html: `<div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.65;white-space:pre-wrap">${escapeHtml(text)}</div>`,
    },
  });
}

export const __test = {
  extractForwardedEnvelope,
  inferInstitutionName,
  normalizeAttachments,
  renderResultText,
  safeEqual,
};
