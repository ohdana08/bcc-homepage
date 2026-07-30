import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPerformanceLearningContext,
  classifyInboundReply,
  dateKeyInTimeZone,
  externalCommentsEnabled,
  formatBodyLines,
  ensureNumberedItems,
  ensureThreeNumberedLogic,
  normalizeShortLines,
  publishTimesForCampaign,
  replyCheckIntervalMinutes,
  sanitizeGeneratedLines,
  shouldRegeneratePendingCampaign,
  validateCommentReady,
  validateHumanVoiceBatch,
  validatePublishReadyPost,
  zonedDateTimeToUtc,
} from '../lib/threads-autopilot.js';

const DAILY_TYPES = ['problem', 'tip', 'backstage', 'template', 'sale'];

test('Asia/Seoul 날짜 키를 만든다', () => {
  const date = new Date('2026-07-26T15:30:00.000Z');
  assert.equal(dateKeyInTimeZone(date, 'Asia/Seoul'), '2026-07-27');
});

test('서울 현지 발행 시각을 UTC로 바꾼다', () => {
  assert.equal(
    zonedDateTimeToUtc('2026-07-27', '08:30', 'Asia/Seoul').toISOString(),
    '2026-07-26T23:30:00.000Z',
  );
});

test('구조화된 짧은 줄을 3문단 본문으로 바꾼다', () => {
  assert.equal(
    formatBodyLines(['후크다.', '상황이다.', '차이가 났다.', '행동을 바꿨다.', '넌 어디가 막혀?']),
    '후크다.\n\n상황이다.\n차이가 났다.\n\n행동을 바꿨다.\n넌 어디가 막혀?',
  );
});

test('긴 생성 문장을 단어 경계에서 10자 이하로 정리하고 마지막 질문만 남긴다', () => {
  const lines = normalizeShortLines([
    '내 얘기 같지 않았다.',
    '회사 정보, 어디서?',
    '공식 자료를 봤다.',
    '판단을 바꿨다.',
    '넌 어디서 찾니?',
  ], { finalQuestion: true });
  assert.ok(lines.length >= 5 && lines.length <= 10);
  assert.ok(lines.every((line) => line.length <= 10));
  assert.equal(lines.join('').match(/[?？]/g)?.length, 1);
  assert.match(lines.at(-1), /[?？]$/);
});

test('가운뎃점으로 연결된 항목도 단어 중간을 자르지 않는다', () => {
  const source = '성장·장점·단점·동기·포부';
  const lines = normalizeShortLines([source]);
  assert.ok(lines.every((line) => line.length <= 10));
  assert.equal(lines.join(''), source);
});

test('저장형 댓글에 짧은 번호 항목을 최소 2개 만든다', () => {
  const lines = ensureNumberedItems(['공식 자료 확인', '회사 기준 확인', '내 경험 연결']);
  assert.equal(lines.filter((line) => /^\d+[.)]\s*/.test(line)).length, 2);
  assert.ok(lines.every((line) => line.length <= 10));
});

test('완전 자동 본문 중간 세 줄은 자르지 않고 1·2·3 번호를 확정한다', () => {
  assert.deepEqual(ensureThreeNumberedLogic([
    '후크입니다.',
    '첫 번째 판단입니다.',
    '기존 7. 번호도 다시 정리합니다.',
    '세 번째 근거입니다.',
    '추가 설명입니다.',
    '프로필 링크에서 확인하세요.',
  ]), [
    '후크입니다.',
    '1. 첫 번째 판단입니다.',
    '2. 기존 7. 번호도 다시 정리합니다.',
    '3. 세 번째 근거입니다.',
    '추가 설명입니다.',
    '프로필 링크에서 확인하세요.',
  ]);
});

test('외부 댓글은 권한 승인 전까지 기본 비활성화한다', () => {
  assert.equal(externalCommentsEnabled({}), false);
  assert.equal(externalCommentsEnabled({ THREADS_EXTERNAL_COMMENTS_ENABLED: 'false' }), false);
  assert.equal(externalCommentsEnabled({ THREADS_EXTERNAL_COMMENTS_ENABLED: 'true' }), true);
  assert.equal(externalCommentsEnabled({ THREADS_EXTERNAL_COMMENTS_ENABLED: ' TRUE ' }), true);
});

test('발행 경과 시간에 따라 댓글 확인 주기를 5분, 30분, 3시간으로 늦춘다', () => {
  const publishedAt = new Date('2026-07-30T00:00:00.000Z');
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-30T00:05:00.000Z')), 5);
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-30T00:59:59.000Z')), 5);
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-30T01:00:00.000Z')), 30);
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-30T05:59:59.000Z')), 30);
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-30T06:00:00.000Z')), 180);
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-30T23:59:59.000Z')), 180);
  assert.equal(replyCheckIntervalMinutes(publishedAt, new Date('2026-07-31T00:00:00.000Z')), null);
});

test('일반 댓글은 자동 답변하고 민감 댓글은 보류한다', () => {
  assert.deepEqual(
    classifyInboundReply('가격은 얼마인가요? 구성도 궁금해요.'),
    { autoReply: true, reason: null },
  );
  assert.deepEqual(
    classifyInboundReply('결제했는데 환불하고 싶어요.'),
    { autoReply: false, reason: '환불·취소' },
  );
  assert.deepEqual(
    classifyInboundReply('할인 가능해요? 조금만 깎아주세요.'),
    { autoReply: false, reason: '가격 협상' },
  );
  assert.deepEqual(
    classifyInboundReply('제 전화번호와 계좌번호를 남길게요.'),
    { autoReply: false, reason: '개인정보' },
  );
  assert.deepEqual(
    classifyInboundReply('이건 법적으로 문제 없는 건가요?'),
    { autoReply: false, reason: '법률·분쟁' },
  );
});

function validPost(contentType, lines, zeroLines = ['기준을 보자.', '사실만 쓴다.', '근거를 찾자.', '한 줄씩 본다.', '오늘 고친다.']) {
  return {
    content_type: contentType,
    text: `${lines[0]}\n\n${lines.slice(1, -1).join('\n')}\n\n${lines.at(-1)}`,
    self_comment_0: zeroLines.join('\n'),
    self_comment_6h: ['다시 읽었다.', '군더더길 뺐다.', '사실만 남겼다.'].join('\n'),
  };
}

test('통합 배치는 SSA·고객 언어·10자 줄·댓글을 검증한다', () => {
  const posts = [
    validPost('problem', [
      '첫 줄이 틀렸다.',
      'AI 티가 났다.',
      '장면이 없었다.',
      '행동을 넣었다.',
      '넌 어디가 막혀?',
    ]),
    validPost('tip', [
      '순서가 바뀌었다.',
      '뭘 먼저 쓸까.',
      '공고부터 봤다.',
      '근거를 골랐다.',
      '넌 뭘 먼저 봐?',
    ], ['1. 공고 보기', '2. 근거 찾기', '한 줄로 쓴다.', '사실만 남긴다.', '소리 내 읽는다.']),
    validPost('backstage', [
      '완벽주의를 뺐다.',
      '가상 예시였다.',
      '행동을 적었다.',
      '변화를 붙였다.',
      '넌 뭘 지우겠어?',
    ]),
    validPost('template', [
      '회사명이 틀렸다.',
      'AI가 지어냈다.',
      '공식 글을 봤다.',
      '근거만 남겼다.',
      '넌 어디서 확인해?',
    ], ['1. 공고 확인', '2. 회사 확인', '날짜를 적는다.', '출처를 남긴다.', '추측은 뺀다.']),
    validPost('sale', [
      '도구도 못 한다.',
      '경험은 못 만든다.',
      '순서만 줄여준다.',
      '검증은 네 몫이다.',
      '넌 어디서 멈춰?',
    ]),
  ];
  assert.deepEqual(validateHumanVoiceBatch(posts), []);
});

test('범용 카피와 고객 언어가 없는 배치를 거부한다', () => {
  const posts = Array.from({ length: 5 }, (_, index) => ({
    content_type: DAILY_TYPES[index],
    text: `너무 긴 첫 문장입니다 ${index}.\n\n일반적인 설명입니다.\n\n도움이 되셨다면 확인해주세요.`,
    self_comment_0: '짧다.',
    self_comment_6h: 'https://example.com',
  }));
  const problems = validateHumanVoiceBatch(posts);
  assert.ok(problems.some((problem) => problem.includes('범용 카피')));
  assert.ok(problems.some((problem) => problem.includes('고객 언어')));
  assert.ok(problems.some((problem) => problem.includes('10자를 넘는 줄')));
  assert.ok(problems.some((problem) => problem.includes('링크 또는 해시태그')));
});

test('캠페인별 고객 언어 패턴을 주입해 검증한다', () => {
  const jiwonfitPatterns = [/몰라서/, /복붙/, /막히|막혔/];
  const posts = [
    validPost('problem', ['공고를 놓쳤다.', '언제 나오는지', '몰라서였다.', '알림을 걸었다.', '넌 어디서 봐?']),
    validPost('tip', ['복붙이 문제다.', '기준이 달랐다.', '목차를 바꿨다.', '근거를 옮겼다.', '넌 뭘 바꾸겠어?'],
      ['1. 목차 확인', '2. 근거 배치', '한 줄씩 본다.', '사실만 남긴다.', '다시 읽는다.']),
    validPost('backstage', ['새벽에 고쳤다.', '가상 예시였다.', '순서를 바꿨다.', '판단이 변했다.', '넌 뭘 고치겠어?']),
    validPost('template', ['목차가 먼저다.', '항목을 나눴다.', '근거를 붙였다.', '출처를 남겼다.', '넌 뭐부터 써?'],
      ['1. 항목 정리', '2. 근거 연결', '날짜를 적는다.', '출처를 남긴다.', '추측은 뺀다.']),
    validPost('sale', ['계획서가 막혔다.', '도구는 못 한다.', '순서만 줄인다.', '검증은 네 몫.', '넌 어디서 멈춰?']),
  ];
  assert.deepEqual(validateHumanVoiceBatch(posts, jiwonfitPatterns), []);
  const problems = validateHumanVoiceBatch(posts);
  assert.ok(problems.some((problem) => problem.includes('고객 언어')));
});

test('최근 실제 성과는 상위 글의 구조 신호로만 요약한다', () => {
  const context = buildPerformanceLearningContext([
    {
      content_type: 'tip',
      text: '공고부터 봤다.\n\n본문',
      metrics: { views: 900, likes: 20, replies: 3, reposts: 1, quotes: 0, shares: 4 },
    },
    {
      content_type: 'sale',
      text: '도구도 못 한다.\n\n본문',
      metrics: { views: 300, likes: 5, replies: 1, reposts: 0, quotes: 0, shares: 1 },
    },
  ]);
  assert.match(context, /tip/);
  assert.match(context, /조회 900/);
  assert.match(context, /반응 28/);
  assert.ok(context.indexOf('tip') < context.indexOf('sale'));
});


test('두 캠페인은 반응형 번호 글과 전환 CTA를 함께 검증한다', () => {
  const posts = [
    ['사업아이템부터 찾지 마세요.', '프로필 링크에서 내 단계 공고를 확인하세요.'],
    ['공고문은 끝까지 읽어야 합니다.', '댓글에 지금 가장 막힌 기준을 남겨주세요.'],
    ['지원금은 먼저 받는 돈이 아닙니다.', '프로필 링크에서 조건 진단을 시작하세요.'],
    ['계획서 목차부터 쓰지 마세요.', '댓글에 공고명만 남겨도 다음 기준을 알려드릴게요.'],
    ['딱지원핏도 경험을 만들진 못합니다.', '프로필 링크에서 맞는 공고를 찾아보세요.'],
  ].map(([hook, conclusion], index) => ({
    content_type: DAILY_TYPES[index],
    text: `${hook}\n\n1. 지원사업은 사업아이템보다 현재 단계가 먼저입니다.\n2. 같은 아이템도 매출과 업력에 따라 보는 공고가 달라집니다.\n3. 계획서는 공고 평가표부터 읽어야 방향이 잡힙니다.\n${conclusion}`,
    self_comment_0: '지역과 업력부터 적습니다.\n그다음 모집 시기를 봅니다.\n마지막에 평가표를 확인합니다.',
    self_comment_6h: '아이템보다 조건을 먼저 봅니다.\n조건이 맞아야 다음 단계가 열립니다.\n공고문은 끝까지 읽습니다.',
  }));
  assert.deepEqual(validateHumanVoiceBatch(posts, [/공고/, /계획서/, /막히/], {
    maxLineLength: 60,
    requireQuestionCta: false,
    requireNumberedStructure: true,
    minParagraphs: 2,
    minZeroCommentLines: 3,
    requireCta: true,
    minProfileLinkCtas: 3,
    strictLineItems: true,
  }), []);
});

function campaignReadyPost(overrides = {}) {
  return {
    content_type: 'tip',
    text: [
      '사업아이템보다 현재 단계를 먼저 보세요.',
      '',
      '1. 업력과 매출에 따라 신청할 수 있는 공고가 달라집니다.',
      '2. 모집 시기와 지역 조건을 함께 확인해야 합니다.',
      '3. 계획서는 공고 평가표의 순서대로 근거를 배치합니다.',
      '프로필 링크에서 내 조건에 맞는 공고를 확인하세요.',
    ].join('\n'),
    self_comment_0: [
      '사업자등록일로 업력을 먼저 계산합니다.',
      '최근 결산 자료에서 매출 구간을 확인합니다.',
      '마지막으로 소재지 제한을 확인합니다.',
    ].join('\n'),
    self_comment_6h: [
      '공고마다 업력 계산 기준일이 다를 수 있습니다.',
      '신청 마감일이 기준인지 공고일이 기준인지 읽습니다.',
      '모호한 조건은 담당 기관에 확인한 뒤 적습니다.',
    ].join('\n'),
    ...overrides,
  };
}

test('두 캠페인의 확정 발행 시각을 분리한다', () => {
  assert.deepEqual(
    publishTimesForCampaign({ id: 'default' }),
    ['08:10', '10:30', '12:20', '18:10', '21:20'],
  );
  assert.deepEqual(
    publishTimesForCampaign({ id: 'jiwonfit' }),
    ['08:30', '10:50', '12:40', '15:30', '18:30'],
  );
});

test('완결된 번호형 본문과 구체적 CTA만 발행 준비로 인정한다', () => {
  assert.deepEqual(validatePublishReadyPost(campaignReadyPost()), []);
});

test('일반 질문은 CTA로 인정하지 않는다', () => {
  const post = campaignReadyPost({
    text: campaignReadyPost().text.replace(
      '프로필 링크에서 내 조건에 맞는 공고를 확인하세요.',
      '내 조건도 확인해봤나요?',
    ),
  });
  assert.ok(validatePublishReadyPost(post)
    .some((problem) => problem.includes('목적지와 행동이 분명한 CTA')));
});

test('중간에서 끊긴 셀프 댓글은 게시하지 않는다', () => {
  const problems = validateCommentReady(
    '사업 목표를 한 문장으로 적습니다.\n평가표와 근거를 대조합니다.\n3. 지금까지',
  );
  assert.ok(problems.some((problem) => problem.includes('미완성 문장')));
});

test('마침표 뒤 인용부호로 끝난 문장은 완결 문장으로 인정한다', () => {
  assert.deepEqual(validateCommentReady([
    "직무 연결 선택 예시는 이렇다.",
    "가상 예시는 '팀 과제에서 일정 관리를 맡았다.'",
    '선택 이유와 행동을 함께 적습니다.',
  ].join('\n')), []);
});

test('공개 본문과 댓글에 조회·반응 수치를 넣지 않는다', () => {
  const post = campaignReadyPost({
    text: campaignReadyPost().text.replace(
      '사업아이템보다 현재 단계를 먼저 보세요.',
      '직전 글은 조회 321 · 좋아요 7 · 답글 2였어.',
    ),
  });
  assert.ok(validatePublishReadyPost(post)
    .some((problem) => problem.includes('조회·반응 수치')));
});

test('근거 없는 경력 연수와 사용자 반응을 사회적 증거로 쓰지 않는다', () => {
  const careerClaim = campaignReadyPost({
    text: campaignReadyPost().text.replace(
      '사업아이템보다 현재 단계를 먼저 보세요.',
      '12년 교육 현장에서 이 질문을 수십 번 받았습니다.',
    ),
  });
  assert.ok(validatePublishReadyPost(careerClaim)
    .some((problem) => problem.includes('근거가 확인되지 않은')));
  assert.ok(validateCommentReady([
    '지원핏 사용 후 가장 자주 나온 반응이 있습니다.',
    '고객이 공고를 처음 알았다고 말했습니다.',
    '이 반응을 다음 글에 반영했습니다.',
  ].join('\n')).some((problem) => problem.includes('근거가 확인되지 않은')));
});

test('생성 결과의 근거 없는 사회적 증거와 댓글 CTA를 안전 문장으로 치환한다', () => {
  const safetyFallbacks = [
    '확인된 공고 원문과 보유 자료만 근거로 남깁니다.',
    '검증되지 않은 선정 사례나 고객 반응은 쓰지 않습니다.',
  ];
  assert.deepEqual(sanitizeGeneratedLines([
    '12년 교육 현장에서 이 질문을 수십 번 받았습니다.',
    '공고 원문의 평가 항목을 확인합니다.',
    '지원핏 사용 후 가장 자주 나온 반응이 있습니다.',
  ], { safetyFallbacks }), [
    safetyFallbacks[0],
    '공고 원문의 평가 항목을 확인합니다.',
    safetyFallbacks[1],
  ]);
  assert.deepEqual(sanitizeGeneratedLines([
    '프로필 링크에서 전체 순서를 확인하세요.',
    '공고 원문의 날짜를 다시 확인합니다.',
  ], { comments: true, safetyFallbacks }), [
    safetyFallbacks[0],
    '공고 원문의 날짜를 다시 확인합니다.',
  ]);
});


test('미발행 두 캠페인의 구형 예약글만 새 리듬으로 교체한다', () => {
  const queuedLegacy = Array.from({ length: 5 }, () => ({ status: 'queued', text: '구형 형식' }));
  assert.equal(shouldRegeneratePendingCampaign({ id: 'jiwonfit' }, queuedLegacy), true);
  assert.equal(shouldRegeneratePendingCampaign({ id: 'default' }, queuedLegacy), true);
  assert.equal(shouldRegeneratePendingCampaign({ id: 'jiwonfit' }, [
    ...queuedLegacy.slice(0, 4),
    { status: 'published', text: '1. 이미 발행됨' },
  ]), false);
  assert.equal(shouldRegeneratePendingCampaign({ id: 'jiwonfit' }, Array.from(
    { length: 5 },
    () => ({ status: 'queued', text: '후크\n1. 번호 전개' }),
  )), true);
  const readyPosts = DAILY_TYPES.map((contentType, index) => {
    const base = campaignReadyPost({ content_type: contentType });
    return {
      ...base,
      text: base.text
        .replace(
          '사업아이템보다 현재 단계를 먼저 보세요.',
          `${index + 1}번째 공고도 현재 단계를 먼저 보세요.`,
        )
        .replace(
          '프로필 링크에서 내 조건에 맞는 공고를 확인하세요.',
          `프로필 링크에서 ${index + 1}번째 조건의 공고를 확인하세요.`,
        ),
      status: 'queued',
    };
  });
  assert.equal(shouldRegeneratePendingCampaign({
    id: 'jiwonfit',
    customer_language_patterns: ['공고'],
  }, readyPosts), false);
});
