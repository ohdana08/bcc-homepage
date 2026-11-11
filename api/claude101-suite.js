// Claude 101·운영 도구 API 묶음 — Vercel Hobby 함수 수 제한 안에서 여러 기능을 한 함수로 처리한다.
// (손님용 회원·결제 기능은 2026-11-12 제거. 실습팩 판매는 그로블 링크로만 한다.)
import publicSample from '../lib/claude101-api/public-sample.js';
import documentMate from '../lib/document-mate/handler.js';
import { handleProjectInstruction } from '../lib/project-instruction/handler.js';
import { loadPrivateSajuHtml } from '../lib/saju-preview/load.js';
import { handleSajuAdmin } from '../lib/saju-preview/handler.js';
import { handleProjectInstructionUsage } from '../lib/project-instruction/telemetry-handler.js';

import { handleLectureOperations } from '../lib/lecture-operations.js';
import { handleLectureRequest } from '../lib/lecture-request.js';
import { handleLectureRequestAttachments } from '../lib/lecture-request-attachments.js';

const HANDLERS = {
  'lecture-operations': handleLectureOperations,
  'lecture-request': handleLectureRequest,
  'lecture-request-attachments': handleLectureRequestAttachments,
  'public-sample': publicSample,
  'document-mate': documentMate,
  'project-instruction': handleProjectInstruction,
  'saju-admin': (req, res) => handleSajuAdmin(req, res, { loadHtml: loadPrivateSajuHtml }),
  'project-instruction-usage': handleProjectInstructionUsage,
};

export default async function handler(req, res) {
  const handle = HANDLERS[String(req.query?.fn || '')];
  if (!handle) return res.status(404).json({ error: 'not found' });
  return handle(req, res);
}
