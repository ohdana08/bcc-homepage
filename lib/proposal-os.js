import { createHash } from 'node:crypto';

const CASE_STATUSES = new Set([
  'inquiry',
  'analyzing',
  'drafted',
  'reviewing',
  'sent',
  'waiting',
  'won',
  'lost',
  'on_hold',
]);

const CASE_FIELDS = [
  'institution_name',
  'institution_type',
  'contact_name',
  'contact_email',
  'contact_phone',
  'inquiry_date',
  'lecture_date',
  'audience',
  'audience_size',
  'duration_hours',
  'budget',
  'inquiry_text',
  'goals',
  'constraints',
  'status',
  'next_action',
  'next_action_at',
  'source',
];

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    demand_analysis: {
      type: 'object',
      properties: {
        institution_summary: { type: 'string' },
        stated_needs: { type: 'array', items: { type: 'string' } },
        inferred_needs: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        unknowns: { type: 'array', items: { type: 'string' } },
      },
      required: ['institution_summary', 'stated_needs', 'inferred_needs', 'constraints', 'unknowns'],
      additionalProperties: false,
    },
    recommendation: {
      type: 'object',
      properties: {
        course_title: { type: 'string' },
        fit_reason: { type: 'string' },
        target: { type: 'string' },
        duration: { type: 'string' },
        delivery_format: { type: 'string' },
        expected_outcomes: { type: 'array', items: { type: 'string' } },
      },
      required: ['course_title', 'fit_reason', 'target', 'duration', 'delivery_format', 'expected_outcomes'],
      additionalProperties: false,
    },
    proposal: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        executive_summary: { type: 'string' },
        background: { type: 'string' },
        objectives: { type: 'array', items: { type: 'string' } },
        operation_plan: { type: 'array', items: { type: 'string' } },
        differentiators: { type: 'array', items: { type: 'string' } },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'executive_summary', 'background', 'objectives', 'operation_plan', 'differentiators', 'assumptions'],
      additionalProperties: false,
    },
    curriculum: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          session: { type: 'integer' },
          title: { type: 'string' },
          minutes: { type: 'integer' },
          objective: { type: 'string' },
          activities: { type: 'array', items: { type: 'string' } },
          output: { type: 'string' },
        },
        required: ['session', 'title', 'minutes', 'objective', 'activities', 'output'],
        additionalProperties: false,
      },
    },
    email: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
      additionalProperties: false,
    },
    qa: {
      type: 'object',
      properties: {
        facts_to_verify: { type: 'array', items: { type: 'string' } },
        risk_flags: { type: 'array', items: { type: 'string' } },
        completeness_score: { type: 'integer' },
      },
      required: ['facts_to_verify', 'risk_flags', 'completeness_score'],
      additionalProperties: false,
    },
  },
  required: ['demand_analysis', 'recommendation', 'proposal', 'curriculum', 'email', 'qa'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 기관교육 제안 실무자다.
기관 문의를 오예림 강사의 실제 강의 이력과 운영 규칙에 연결해 요구분석, 추천 강의, 제안서, 커리큘럼, 이메일 초안을 만든다.

원칙:
1. 제공된 기관 문의와 승인된 BCC 지식만 근거로 사용한다.
2. 확인되지 않은 경력·성과·기관 정보·가격·일정은 만들지 않는다.
3. 명시된 요구와 합리적 추론을 구분하고, 추론은 inferred_needs에만 둔다.
4. 확인이 필요한 내용은 unknowns와 facts_to_verify에 남긴다.
5. 다른 기관의 담당자명·금액·개인정보를 새 제안에 옮기지 않는다.
6. 커리큘럼은 대상, 시간, 환경, 실습 결과물을 고려해 실제 운영 가능하게 만든다.
7. 이메일은 결론을 앞에 두고 짧고 정중하게 쓴다. 실제 발송은 사람이 검수한다.
8. BCC의 강점은 추상적으로 칭찬하지 말고 제공된 이력과 운영 경험에서 확인되는 범위로만 표현한다.
9. 출력은 지정된 JSON 스키마만 사용한다.`;

function clean(value, max = 20000) {
  return String(value ?? '').trim().slice(0, max);
}

function compactCaseInput(body) {
  const row = {};
  for (const key of CASE_FIELDS) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === '' || value == null) row[key] = null;
    else if (['audience_size', 'duration_hours', 'budget'].includes(key)) row[key] = Number(value) || null;
    else row[key] = clean(value, key === 'inquiry_text' ? 30000 : 3000);
  }
  if (row.status && !CASE_STATUSES.has(row.status)) delete row.status;
  return row;
}

function parseJson(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
}

function searchTerms(proposalCase) {
  return [
    proposalCase.institution_name,
    proposalCase.institution_type,
    proposalCase.audience,
    proposalCase.goals,
    proposalCase.inquiry_text,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[^0-9a-zA-Z가-힣]+/)
    .filter((word) => word.length >= 2)
    .slice(0, 80);
}

function selectKnowledge(rows, proposalCase) {
  const terms = searchTerms(proposalCase);
  return (rows || [])
    .map((row) => {
      const haystack = `${row.title || ''} ${row.content || ''}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { ...row, score };
    })
    .sort((a, b) => b.score - a.score || String(b.synced_at).localeCompare(String(a.synced_at)))
    .slice(0, 12)
    .map((row) => ({
      title: row.title,
      source_path: row.source_path,
      source_kind: row.source_kind,
      content: clean(row.content, 6000),
    }));
}

async function listCases(db) {
  const { data, error } = await db
    .from('proposal_cases')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

async function getCaseBundle(db, id) {
  const [{ data: proposalCase, error }, { data: outputs }, { data: learnings }] = await Promise.all([
    db.from('proposal_cases').select('*').eq('id', id).single(),
    db.from('proposal_outputs').select('*').eq('case_id', id).order('version', { ascending: false }),
    db.from('proposal_learnings').select('*').eq('case_id', id).order('created_at', { ascending: false }),
  ]);
  if (error) throw error;
  return { case: proposalCase, outputs: outputs || [], learnings: learnings || [] };
}

async function generateProposal({ db, client, caseId }) {
  const { data: proposalCase, error } = await db.from('proposal_cases').select('*').eq('id', caseId).single();
  if (error || !proposalCase) throw error || new Error('기관 문의를 찾지 못했습니다.');

  await db.from('proposal_cases').update({ status: 'analyzing', updated_at: new Date().toISOString() }).eq('id', caseId);

  const { data: knowledgeRows, error: knowledgeError } = await db
    .from('proposal_knowledge')
    .select('title, source_path, source_kind, content, synced_at')
    .eq('active', true)
    .limit(120);
  if (knowledgeError) throw knowledgeError;
  const knowledge = selectKnowledge(knowledgeRows, proposalCase);

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: PROPOSAL_SCHEMA } },
    messages: [{
      role: 'user',
      content: `# 새 기관 문의\n${JSON.stringify(proposalCase, null, 2)}\n\n# 승인된 BCC 지식\n${JSON.stringify(knowledge, null, 2)}`,
    }],
  });

  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('이 요청은 생성이 거절되었습니다.'), { httpStatus: 422 });
  const block = msg.content.find((item) => item.type === 'text');
  if (!block) throw new Error('AI 응답이 비어 있습니다.');
  const result = parseJson(block.text);

  const { data: latest } = await db
    .from('proposal_outputs')
    .select('version')
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = Number(latest?.version || 0) + 1;

  const { data: output, error: insertError } = await db
    .from('proposal_outputs')
    .insert({
      case_id: caseId,
      version,
      demand_analysis: result.demand_analysis,
      recommendation: result.recommendation,
      proposal: result.proposal,
      curriculum: result.curriculum,
      email_draft: result.email,
      qa: result.qa,
      knowledge_sources: knowledge.map(({ title, source_path, source_kind }) => ({ title, source_path, source_kind })),
    })
    .select('*')
    .single();
  if (insertError) throw insertError;

  await db
    .from('proposal_cases')
    .update({ status: 'drafted', updated_at: new Date().toISOString() })
    .eq('id', caseId);
  return output;
}

export async function handleProposal(req, res, { db, client, user }) {
  const body = req.body || {};
  const action = clean(body.action, 40);

  if (action === 'list') {
    const [cases, knowledgeResult] = await Promise.all([
      listCases(db),
      db.from('proposal_knowledge').select('*', { count: 'exact', head: true }).eq('active', true),
    ]);
    return res.json({ cases, knowledge_count: knowledgeResult.count || 0 });
  }

  if (action === 'get') {
    if (!body.id) return res.status(400).json({ error: '문의 ID가 필요합니다.' });
    return res.json(await getCaseBundle(db, body.id));
  }

  if (action === 'create') {
    const row = compactCaseInput(body.case || {});
    if (!row.institution_name || !row.inquiry_text) {
      return res.status(400).json({ error: '기관명과 문의 내용을 입력해 주세요.' });
    }
    const { data, error } = await db
      .from('proposal_cases')
      .insert({ ...row, owner_id: user.id, status: row.status || 'inquiry' })
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ case: data });
  }

  if (action === 'update') {
    if (!body.id) return res.status(400).json({ error: '문의 ID가 필요합니다.' });
    const changes = compactCaseInput(body.changes || {});
    changes.updated_at = new Date().toISOString();
    const { data, error } = await db.from('proposal_cases').update(changes).eq('id', body.id).select('*').single();
    if (error) throw error;
    return res.json({ case: data });
  }

  if (action === 'generate') {
    if (!body.id) return res.status(400).json({ error: '문의 ID가 필요합니다.' });
    const { data: before } = await db.from('proposal_cases').select('status').eq('id', body.id).single();
    try {
      const output = await generateProposal({ db, client, caseId: body.id });
      return res.json({ output, bundle: await getCaseBundle(db, body.id) });
    } catch (error) {
      if (before?.status) {
        await db.from('proposal_cases').update({ status: before.status, updated_at: new Date().toISOString() }).eq('id', body.id);
      }
      throw error;
    }
  }

  if (action === 'feedback') {
    const feedback = body.feedback || {};
    if (!body.id || !feedback.observed_issue || !feedback.correction_reason) {
      return res.status(400).json({ error: '문제와 수정 이유를 입력해 주세요.' });
    }
    const { data, error } = await db
      .from('proposal_learnings')
      .insert({
        case_id: body.id,
        output_id: feedback.output_id || null,
        category: clean(feedback.category || '기타', 80),
        observed_issue: clean(feedback.observed_issue, 5000),
        correction_reason: clean(feedback.correction_reason, 5000),
        corrected_text: clean(feedback.corrected_text, 12000),
        recurrence_rule: clean(feedback.recurrence_rule, 5000),
        rule_status: 'candidate',
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ learning: data });
  }

  if (action === 'sync_knowledge') {
    const documents = Array.isArray(body.documents) ? body.documents.slice(0, 250) : [];
    if (!documents.length) return res.status(400).json({ error: '동기화할 옵시디언 문서가 없습니다.' });
    const rows = documents
      .filter((doc) => doc?.source_path && doc?.content)
      .map((doc) => {
        const content = clean(doc.content, 30000);
        return {
          source_path: clean(doc.source_path, 600),
          source_hash: createHash('sha256').update(content).digest('hex'),
          source_kind: clean(doc.source_kind || 'lecture_record', 80),
          title: clean(doc.title || doc.source_path, 300),
          content,
          metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {},
          active: true,
          synced_at: new Date().toISOString(),
        };
      });
    const { error } = await db.from('proposal_knowledge').upsert(rows, { onConflict: 'source_path' });
    if (error) throw error;
    return res.json({ synced: rows.length });
  }

  return res.status(400).json({ error: '지원하지 않는 기관 제안 작업입니다.' });
}

export const __test = { compactCaseInput, selectKnowledge };
