export const CLAUDE101_COURSE_ASSETS = [
  {
    id: '1-1',
    videoPath: 'lessons/1-1/claude101-vod-1-1-v3.mp4',
    subtitlePath: 'lessons/1-1/claude101-vod-1-1-v3-ko.srt',
    downloads: [
      { id: 'meeting-memo', path: 'lessons/1-1/meeting-memo.txt' },
      { id: 'prompts', path: 'lessons/1-1/prompts.txt' },
      { id: 'review-checklist', path: 'lessons/1-1/review-checklist.txt' },
      { id: 'report', path: 'lessons/1-1/meeting-report.docx' },
    ],
  },
  {
    id: '1-2',
    videoPath: 'lessons/1-2/claude101-vod-1-2-v1.mp4',
    subtitlePath: 'lessons/1-2/claude101-vod-1-2-v1-ko.srt',
    downloads: [
      { id: 'customer-inquiries', path: 'lessons/1-2/customer-inquiries.csv' },
      { id: 'prompts', path: 'lessons/1-2/prompts.txt' },
      { id: 'review-checklist', path: 'lessons/1-2/review-checklist.txt' },
      { id: 'answer-key', path: 'lessons/1-2/answer-key.csv' },
      { id: 'answer-workbook', path: 'lessons/1-2/customer-inquiries-analysis.xlsx' },
    ],
  },
  {
    id: '1-3',
    videoPath: 'lessons/1-3/claude101-vod-1-3-v1.mp4',
    subtitlePath: 'lessons/1-3/claude101-vod-1-3-v1-ko.srt',
    downloads: [
      { id: 'operations-report', path: 'lessons/1-3/customer-inquiry-operations-report.txt' },
      { id: 'prompts', path: 'lessons/1-3/prompts.md' },
      { id: 'review-checklist', path: 'lessons/1-3/review-checklist.md' },
      { id: 'slide-answer-key', path: 'lessons/1-3/slide-answer-key.txt' },
      { id: 'final-deck', path: 'lessons/1-3/customer-inquiry-operations-deck.pptx' },
    ],
  },
  {
    id: '1-4',
    videoPath: 'lessons/1-4/claude101-vod-1-4-v1.mp4',
    subtitlePath: 'lessons/1-4/claude101-vod-1-4-v1-ko.srt',
    downloads: [
      { id: 'ai-summary-draft', path: 'lessons/1-4/ai-summary-draft.txt' },
      { id: 'source-csv', path: 'lessons/1-4/customer-inquiries.csv' },
      { id: 'prompts', path: 'lessons/1-4/prompts.md' },
      { id: 'review-template', path: 'lessons/1-4/ai-review-master-checklist.md' },
      { id: 'answer-key', path: 'lessons/1-4/answer-key.md' },
    ],
  },
  {
    id: '1-5',
    videoPath: 'lessons/1-5/claude101-vod-1-5-v1.mp4',
    subtitlePath: 'lessons/1-5/claude101-vod-1-5-v1-ko.srt',
    downloads: [
      { id: 'project-instructions', path: 'lessons/1-5/project-instructions.md' },
      { id: 'week2-csv', path: 'lessons/1-5/customer-inquiries-week2.csv' },
      { id: 'week2-answer-key', path: 'lessons/1-5/answer-key-week2.md' },
      { id: 'prompts', path: 'lessons/1-5/prompts.md' },
    ],
  },
  {
    id: '1-6',
    videoPath: 'lessons/1-6/claude101-vod-1-6-v1.mp4',
    subtitlePath: 'lessons/1-6/claude101-vod-1-6-v1-ko.srt',
    downloads: [
      { id: 'procedure-template', path: 'lessons/1-6/my-work-ai-procedure.md' },
      { id: 'example-procedure', path: 'lessons/1-6/example-weekly-sales-procedure.md' },
      { id: 'orders-csv', path: 'lessons/1-6/weekly-orders-deidentified.csv' },
      { id: 'orders-answer-key', path: 'lessons/1-6/answer-key-orders.md' },
      { id: 'deidentify-guide', path: 'lessons/1-6/data-classification-guide.md' },
      { id: 'prompts', path: 'lessons/1-6/prompts.md' },
    ],
  },
];

export function listClaude101AssetPaths() {
  return CLAUDE101_COURSE_ASSETS.flatMap((lesson) => [
    lesson.videoPath,
    lesson.subtitlePath,
    ...lesson.downloads.map((item) => item.path),
  ]);
}

export function mapClaude101SignedAssets(signedAssets = []) {
  const urls = new Map(signedAssets.map((item) => [item.path, item.signedUrl || item.url || null]));
  return CLAUDE101_COURSE_ASSETS.map((lesson) => ({
    id: lesson.id,
    videoUrl: urls.get(lesson.videoPath) || null,
    subtitleUrl: urls.get(lesson.subtitlePath) || null,
    downloads: lesson.downloads.map((item) => ({
      id: item.id,
      url: urls.get(item.path) || null,
    })),
  }));
}

export async function createClaude101SignedAssets(db, bucket, expiresIn = 3600) {
  if (!bucket) return mapClaude101SignedAssets();
  const { data, error } = await db.storage
    .from(bucket)
    .createSignedUrls(listClaude101AssetPaths(), expiresIn);
  if (error || !Array.isArray(data)) return mapClaude101SignedAssets();
  return mapClaude101SignedAssets(data);
}
