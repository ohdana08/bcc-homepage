import { summarizeResponses, seoulDateString } from './training-needs.js';
import { EXPERIENCE_SCHEMA, summarizeExperienceResponses } from './ai-experience-card.js';

const tidy = (value, max = 800) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일 삭제]')
  .replace(/(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[전화번호 삭제]');
const fields = { experience_tasks:'해본 AI 작업', creation_process:'제작 경험', desired_work:'만들고 싶은 결과물', support_needs:'필요한 도움' };

export function surveyCompletion(survey, rows, at) {
  if (survey.is_sample || survey.status === 'draft') return null;
  const candidates = [];
  if (['closed','analyzed'].includes(survey.status) && Date.parse(survey.updated_at) <= Date.parse(at)) candidates.push({ reason:'관리자 마감', completed_at:survey.updated_at });
  if (survey.response_deadline && survey.response_deadline < seoulDateString(new Date(at))) {
    const deadline = new Date(Date.parse(survey.response_deadline + 'T00:00:00+09:00') + 86400000).toISOString();
    candidates.push({ reason:'응답 마감일 도달', completed_at:deadline });
  }
  const expected = survey.expected_response_count;
  if (Number.isInteger(expected) && expected > 0 && rows.length >= expected) candidates.push({ reason:'예정 응답 인원 도달', completed_at:rows[expected - 1].submitted_at });
  return candidates.filter(item => Number.isFinite(Date.parse(item.completed_at)) && Date.parse(item.completed_at) <= Date.parse(at))
    .sort((a,b) => Date.parse(a.completed_at) - Date.parse(b.completed_at))[0] || null;
}

export function surveySummaryText(survey, rows, completion) {
  const legacyRows = rows.filter(row=>row.answers?.schema_version !== EXPERIENCE_SCHEMA);
  const summary = summarizeResponses(legacyRows);
  const card = summarizeExperienceResponses(rows);
  const lines = [tidy(survey.institution_label,160) + ' · ' + tidy(survey.title,200),
    '알림 기준: ' + completion.reason, '응답: ' + rows.length + '명' + (survey.expected_response_count > 0 ? ' / 예정 ' + survey.expected_response_count + '명' : ''),
    '응답자가 알려준 경험과 희망을 수업 기획에 참고하는 요약입니다. 능력 점수나 등급이 아닙니다.',
    '\n[나의 AI 경험 카드 · ' + card.sample_size + '명]'];
  for (const [key,label] of Object.entries(fields)) {
    const entries = card.distributions[key] || [];
    lines.push(label + ' (문항 응답 ' + (card.answered_counts[key] || 0) + '명): ' + (entries.length ? entries.map(x=>tidy(x.label,100) + ' ' + x.count + '명').join(', ') : '응답 없음'));
  }
  const wishes = rows.filter(row=>row.answers?.schema_version === 'ai_experience_v2').map(row=>tidy(row.answers.desired_detail,400)).filter(Boolean);
  const needs = card.support_details || [];
  if (wishes.length) lines.push('\n[만들고 싶은 일 · 자유응답 ' + wishes.length + '건]', ...wishes.slice(0,20).map(x=>'- '+x), ...(wishes.length>20?['나머지는 관리자 화면에서 확인해 주세요.']:[]));
  if (needs.length) lines.push('\n[더 알고 싶은 내용 · AI로 잘 안되는 업무]', ...needs.slice(0,20).map(x=>'- '+tidy(x)), ...(needs.length>20?['나머지는 관리자 화면에서 확인해 주세요.']:[]));
  if (summary.legacy_sample_size) {
    lines.push('\n[기존 설문 · ' + legacyRows.length + '명 · 별도 집계]' + (legacyRows.length>500 ? '\n아래 기존 문항 집계는 최초 500명 기준입니다. 전체 응답 수와 구분해 주세요.' : ''));
    for (const [key,label] of [['ai_experience','AI 사용 경험'],['desired_topics','배우고 싶은 주제'],['pain_points','막히는 점']]) {
      const entries=summary.distributions[key]||[];
      lines.push(label+': '+(entries.map(x=>tidy(x.label,100)+' '+x.count+'명').join(', ')||'응답 없음'));
    }
  }
  lines.push('\n[수업 준비에 반영할 점]');
  const wanted=card.distributions.desired_work?.[0], help=card.distributions.support_needs?.[0];
  if (wanted && !['undecided','other'].includes(wanted.value)) lines.push('- 가장 많이 선택한 '+tidy(wanted.label,100)+' 실습을 우선 검토해 주세요 ('+wanted.count+'명).');
  if (help && !['none','unsure','other'].includes(help.value)) lines.push('- '+tidy(help.label,100)+' 지원을 준비해 주세요 ('+help.count+'명).');
  if (!wanted&&!help) lines.push('- 응답이 적거나 기존 설문만 있어 구체적인 수업 구성은 전체 응답을 확인해 결정해 주세요.');
  lines.push('- 복수 선택 응답이므로 항목별 인원 합계는 전체 응답자 수와 다를 수 있습니다.', '- 파일과 작품 링크는 이메일에 포함하지 않습니다.');
  return lines.join('\n');
}

export async function surveyNotificationPage(db, {until, offset=0}) {
  const pageSize=25;
  const {data:surveys,error}=await db.from('training_need_surveys')
    .select('id,institution_label,title,response_deadline,expected_response_count,status,is_sample,created_at,updated_at')
    .eq('is_sample',false).neq('status','draft').lte('created_at',until).order('id',{ascending:true}).range(offset,offset+pageSize-1);
  if(error) throw error;
  const events=[];
  for(const survey of surveys) {
    const rows=[];
    for(let start=0;start<=2000;start+=500) {
      const {data:batch,error:responseError}=await db.from('training_need_responses').select('answers,submitted_at,id')
        .eq('survey_id',survey.id).lte('submitted_at',until).order('submitted_at',{ascending:true}).order('id',{ascending:true}).range(start,start+499);
      if(responseError) throw responseError;
      if(start===2000 && batch.length) throw new Error('Survey exceeds supported response cap');
      rows.push(...batch);
      if(batch.length<500) break;
    }
    const completion=surveyCompletion(survey,rows,until);
    if(completion) events.push({kind:'survey',id:String(survey.id),created_at:completion.completed_at,institution_label:tidy(survey.institution_label,160),title:tidy(survey.institution_label,100)+' · '+tidy(survey.title,100),summary_text:surveySummaryText(survey,rows,completion)});
  }
  return {events,hasMore:surveys.length===pageSize,nextOffset:offset+surveys.length};
}
