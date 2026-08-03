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
        confirmed_facts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fact: { type: 'string' },
              source: { type: 'string' },
            },
            required: ['fact', 'source'],
            additionalProperties: false,
          },
        },
        stated_needs: { type: 'array', items: { type: 'string' } },
        inferred_needs: { type: 'array', items: { type: 'string' } },
        constraints: { type: 'array', items: { type: 'string' } },
        source_conflicts: { type: 'array', items: { type: 'string' } },
        unknowns: { type: 'array', items: { type: 'string' } },
      },
      required: ['institution_summary', 'confirmed_facts', 'stated_needs', 'inferred_needs', 'constraints', 'source_conflicts', 'unknowns'],
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
        tool_workflow: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'integer' },
              tool: { type: 'string' },
              task: { type: 'string' },
              output: { type: 'string' },
              free_plan_note: { type: 'string' },
            },
            required: ['step', 'tool', 'task', 'output', 'free_plan_note'],
            additionalProperties: false,
          },
        },
      },
      required: ['course_title', 'fit_reason', 'target', 'duration', 'delivery_format', 'expected_outcomes', 'tool_workflow'],
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
        institution_form: {
          type: 'object',
          properties: {
            course_name: { type: 'string' },
            purpose: { type: 'string' },
            objectives: { type: 'array', items: { type: 'string' } },
            core_contents: { type: 'array', items: { type: 'string' } },
            teaching_methods: { type: 'array', items: { type: 'string' } },
            expected_effects: { type: 'array', items: { type: 'string' } },
            participant_preparation: { type: 'array', items: { type: 'string' } },
            institution_preparation: { type: 'array', items: { type: 'string' } },
          },
          required: ['course_name', 'purpose', 'objectives', 'core_contents', 'teaching_methods', 'expected_effects', 'participant_preparation', 'institution_preparation'],
          additionalProperties: false,
        },
      },
      required: ['title', 'executive_summary', 'background', 'objectives', 'operation_plan', 'differentiators', 'assumptions', 'institution_form'],
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
          tool: { type: 'string' },
          verification_point: { type: 'string' },
          free_plan_safe: { type: 'boolean' },
        },
        required: ['session', 'title', 'minutes', 'objective', 'activities', 'output', 'tool', 'verification_point', 'free_plan_safe'],
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
        paid_feature_dependencies: { type: 'array', items: { type: 'string' } },
        source_coverage: { type: 'array', items: { type: 'string' } },
        completeness_score: { type: 'integer' },
      },
      required: ['facts_to_verify', 'risk_flags', 'paid_feature_dependencies', 'source_coverage', 'completeness_score'],
      additionalProperties: false,
    },
  },
  required: ['demand_analysis', 'recommendation', 'proposal', 'curriculum', 'email', 'qa'],
  additionalProperties: false,
};

// Anthropic structured outputs compile the JSON schema into a grammar. The full
// proposal document is intentionally rich, so sending every nested section in
// one request can exceed the compiled-grammar limit. Keep the exact section
// schemas, but generate them in three smaller, schema-validated passes.
const PROPOSAL_SCHEMA_GROUPS = [
  {
    keys: ['demand_analysis', 'recommendation'],
    maxTokens: 5000,
    instruction: '먼저 기관 요구를 분석하고 적합한 과정과 무료 도구 인계 흐름을 추천한다. confirmed_facts는 최대 8개, 나머지 배열은 최대 5개, tool_workflow는 4단계 이내로 간결하게 쓴다.',
  },
  {
    keys: ['proposal', 'curriculum'],
    maxTokens: 7000,
    instruction: '확정된 요구분석과 추천안을 바탕으로 제안서 본문과 실제 운영 가능한 커리큘럼을 작성한다. 각 제안서 배열은 최대 5개, 커리큘럼은 최대 8차시, 차시별 활동은 최대 4개로 제한하고 각 설명은 2문장 이내로 쓴다.',
  },
  {
    keys: ['email', 'qa'],
    maxTokens: 4000,
    instruction: '앞서 작성된 제안 내용을 바탕으로 기관 회신 이메일 초안과 최종 검수 결과를 작성한다. 이메일 본문은 700자 이내, 각 검수 배열은 최대 8개로 쓴다.',
  },
];

const SYSTEM_PROMPT = `너는 BCC(Business Career Consulting)의 기관교육 제안 실무자다.
기관 문의를 오예림 강사의 실제 강의 이력과 운영 규칙에 연결해 요구분석, 추천 강의, 제안서, 커리큘럼, 이메일 초안을 만든다.

원칙:
1. 제공된 기관 문의와 승인된 BCC 지식만 근거로 사용한다.
2. 확인되지 않은 경력·성과·기관 정보·가격·일정은 만들지 않는다.
3. 입력은 [기관 이메일], [통화 전사본], [기관 첨부양식], [기타 메모], [운영 조건]으로 구분될 수 있다. confirmed_facts에는 사실과 출처 이름을 함께 적고, 서로 다른 내용은 source_conflicts로 보낸다.
4. 명시된 요구와 합리적 추론을 구분하고, 추론은 inferred_needs에만 둔다.
5. 이메일에 없는 내용이 통화 전사본에 있으면 통화 전사본을 근거로 쓸 수 있지만, 모호한 발화는 unknowns에 질문으로 남긴다.
6. 확인이 필요한 내용은 unknowns와 facts_to_verify에 남긴다.
7. 다른 기관의 담당자명·금액·개인정보를 새 제안에 옮기지 않는다.
8. 커리큘럼은 대상, 시간, 환경, 실습 결과물을 고려해 실제 운영 가능하게 만든다. 시간이 확인되지 않았다면 임의로 확정하지 말고 추천안임을 명시한다.
9. 이메일은 결론을 앞에 두고 짧고 정중하게 쓴다. 실제 발송은 사람이 검수한다.
10. BCC의 강점은 추상적으로 칭찬하지 말고 제공된 이력과 운영 경험에서 확인되는 범위로만 표현한다.
11. 수정 이유와 재발방지 규칙이 제공되면 새 버전에 반영한다.

AI 리터러시·무료 도구 과정 규칙:
- 수강생 환경이 무료 버전이면 NotebookLM Standard와 Claude Free만으로 끝나는 흐름을 설계한다.
- 기본 흐름은 '허가된 자료 준비 → NotebookLM에서 출처 기반 사실·쟁점 정리 → Claude에서 목적에 맞는 문서로 변환 → 사람이 출처·개인정보·저작권 검수'다.
- NotebookLM에는 PDF, 웹페이지, 유튜브, 오디오, Google Docs/Slides, DOCX, TXT, MD, CSV, PPTX 등 공식 지원 형식만 안내한다. HWP/HWPX는 직접 지원된다고 단정하지 말고 PDF·DOCX 변환 또는 텍스트 붙여넣기를 안내한다.
- Claude Free에서는 채팅, 글쓰기·편집, 텍스트·이미지 분석, 웹 검색 범위만 사용한다. Claude Code, Research, 유료 Projects·커넥터, API 키를 수강생 필수 조건으로 넣지 않는다.
- 무료 사용량은 제한되고 변동될 수 있으므로 한 실습은 짧은 소스 묶음과 재사용 가능한 프롬프트 1~2개로 완주하게 한다.
- 윤리·보안·저작권은 별도 이론으로 끝내지 말고 모든 실습에 '업로드 가능 여부 판단, 개인정보 가명처리, 출처 확인, 결과물 사람 검수' 체크포인트로 넣는다.
- 각 차시의 free_plan_safe를 엄격히 판정하고 유료 의존이 있으면 paid_feature_dependencies에 구체적으로 적는다. 이상적인 결과는 빈 배열이다.

출력 규칙:
- tool_workflow는 NotebookLM과 Claude의 역할을 섞지 말고, 단계별 입력과 결과물의 인계가 보이게 쓴다.
- institution_form은 기관 강의계획서·수업지도안 양식에 옮겨 적기 쉬운 행정 문장으로 쓴다.
- source_coverage에는 이메일·전사본·첨부양식·BCC 지식 중 실제 제공된 것과 빠진 것을 적는다.
- 출력은 지정된 JSON 스키마만 사용한다.`;

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
    else row[key] = clean(value, key === 'inquiry_text' ? 80000 : 6000);
  }
  if (row.status && !CASE_STATUSES.has(row.status)) delete row.status;
  return row;
}

function parseJson(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
}

function groupedSchema(keys) {
  return {
    type: 'object',
    properties: Object.fromEntries(keys.map((key) => [key, PROPOSAL_SCHEMA.properties[key]])),
    required: keys,
    additionalProperties: false,
  };
}

async function generateStructuredGroup(client, { keys, maxTokens, instruction, userContent }) {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: `${SYSTEM_PROMPT}\n\n이번 단계의 역할: ${instruction}`,
    output_config: { format: { type: 'json_schema', schema: groupedSchema(keys) } },
    messages: [{ role: 'user', content: userContent }],
  });

  if (msg.stop_reason === 'refusal') {
    throw Object.assign(new Error('이 요청은 생성이 거절되었습니다.'), { httpStatus: 422 });
  }
  if (msg.stop_reason === 'max_tokens') {
    throw Object.assign(new Error(`제안서 ${keys.join('/')} 생성 분량이 한도를 넘었습니다. 내용을 줄여 다시 시도해 주세요.`), { httpStatus: 502 });
  }
  const block = msg.content.find((item) => item.type === 'text');
  if (!block) throw new Error('AI 응답이 비어 있습니다.');
  return parseJson(block.text);
}

function searchTerms(proposalCase) {
  return [
    proposalCase.institution_name,
    proposalCase.institution_type,
    proposalCase.audience,
    proposalCase.goals,
    proposalCase.constraints,
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

export async function getCaseBundle(db, id) {
  const [{ data: proposalCase, error }, { data: outputs }, { data: learnings }] = await Promise.all([
    db.from('proposal_cases').select('*').eq('id', id).single(),
    db.from('proposal_outputs').select('*').eq('case_id', id).order('version', { ascending: false }),
    db.from('proposal_learnings').select('*').eq('case_id', id).order('created_at', { ascending: false }),
  ]);
  if (error) throw error;
  return { case: proposalCase, outputs: outputs || [], learnings: learnings || [] };
}

export async function generateProposal({ db, client, caseId, sourceBlocks = [] }) {
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

  const { data: learningRows, error: learningError } = await db
    .from('proposal_learnings')
    .select('category, observed_issue, correction_reason, corrected_text, recurrence_rule, rule_status, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (learningError) throw learningError;
  const learningRules = (learningRows || []).map((row) => ({
    category: row.category,
    issue: clean(row.observed_issue, 1200),
    reason: clean(row.correction_reason, 1200),
    corrected_text: clean(row.corrected_text, 2000),
    recurrence_rule: clean(row.recurrence_rule, 1200),
    status: row.rule_status,
  }));

  const casePrompt = `# 새 기관 문의\n${JSON.stringify(proposalCase, null, 2)}\n\n# 승인된 BCC 지식\n${JSON.stringify(knowledge, null, 2)}\n\n# 이 사례의 수정·재발방지 규칙\n${JSON.stringify(learningRules, null, 2)}`;
  const userContent = sourceBlocks.length
    ? [{ type: 'text', text: casePrompt }, ...sourceBlocks]
    : casePrompt;

  const result = {};
  for (let index = 0; index < PROPOSAL_SCHEMA_GROUPS.length; index += 1) {
    const group = PROPOSAL_SCHEMA_GROUPS[index];
    const completedContext = Object.keys(result).length
      ? `\n\n# 앞 단계에서 확정된 결과\n${JSON.stringify(result, null, 2)}`
      : '';
    const groupUserContent = index === 0
      ? userContent
      : `${casePrompt}${completedContext}`;
    Object.assign(result, await generateStructuredGroup(client, {
      ...group,
      userContent: groupUserContent,
    }));
  }

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
