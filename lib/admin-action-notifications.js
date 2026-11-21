import { mergeCase } from './lecture-desk-domain.js';

const PAGE = 100;
const ISO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
const instant = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const koreaDate = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
function checked(result) {
  if (result.error) throw new Error('Admin notification query unavailable');
  return result.data || [];
}
async function lastEvent(db, caseId, kind, followupDate, until) {
  let query = db.from('lecture_desk_events').select('event_id,created_at,revision').eq('case_id', caseId).lte('created_at', until);
  query = kind ? query.eq('payload->>kind', kind) : query.eq('payload->fields->>followup_on', followupDate);
  return checked(await query.order('revision', { ascending: false }).limit(1))[0];
}

/** Read-only snapshot of the actionable buckets displayed in the lecture desk.
 * The offset applies to sorted output events, not source rows, so filtering never
 * makes a sparse source page look like the end of the event stream.
 */
export async function getAdminActionNotificationEvents(db, { since, until, offset = 0, now = until }) {
  const start = instant(since), end = instant(until), nowMs = instant(now);
  if (start === null || end === null || nowMs === null || start > end || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid admin notification window');
  const today = koreaDate(Math.min(end, nowMs));
  const events = [];
  const append = (item, action, id, at) => {
    const timestamp = instant(at);
    if (timestamp === null || timestamp < start || timestamp > end) return;
    const institution = text(item.institution_name) || '기관';
    const course = text(item.topic || item.project_name) || '강의';
    const label = action === 'review' ? '검토할 제안' : '후속 연락일 도래';
    events.push({ kind: 'admin_action', id, created_at: new Date(timestamp).toISOString(), title: `${institution} · ${label}`, summary_text: `${institution} / ${course}\n${label}${action === 'followup' ? ': ' + item.desk.followup_on : ''}\n관리자 강의 업무함에서 확인해 주세요.` });
  };
  for (let sourceOffset = 0; ; sourceOffset += PAGE) {
    const cases = checked(await db.from('proposal_cases').select('id,institution_name,project_name,status,next_action_at,created_at,updated_at').lte('created_at', until).order('created_at', { ascending: true }).order('id', { ascending: true }).range(sourceOffset, sourceOffset + PAGE - 1));
    if (!cases.length) break;
    const ids = cases.map(c => c.id);
    const [states, operations] = await Promise.all([
      db.from('lecture_desk_state').select('case_id,revision,stage,fields,prepared_stale,proposal_pending,followup_on,followup_suggested,updated_at').in('case_id', ids),
      db.from('lecture_operations').select('case_id,checklist').in('case_id', ids),
    ]);
    const stateMap = new Map(checked(states).map(row => [row.case_id, row]));
    const operationMap = new Map(checked(operations).map(row => [row.case_id, row]));
    for (const base of cases) {
      if (!ISO_ID.test(base.id)) continue;
      const state = stateMap.get(base.id);
      const item = mergeCase(base, state);
      if (!state && operationMap.get(base.id)?.checklist?.completed === true) item.desk.stage = 'completed';
      if (/^QA(?:[_\s-]|$)/i.test(item.institution_name || '') || /테스트|실제 강의 아님/.test(`${item.institution_name || ''} ${item.project_name || ''}`)) continue;
      const stage = item.desk.stage;
      const active = !['completed', 'closed', 'on_hold'].includes(stage);
      const review = active && Boolean(item.desk.revision) && !item.desk.prepared_stale && (item.desk.proposal_pending === true || (item.desk.proposal_pending === undefined && stage === 'proposal_ready'));
      if (review) {
        const prepared = await lastEvent(db, base.id, 'proposal_ready', null, until);
        // A stable preparation event is required. A later unrelated state update
        // must never make an old pending proposal look newly prepared.
        if (prepared && ISO_ID.test(prepared.event_id)) append(item, 'review', `review-${base.id}-${prepared.event_id}`, prepared.created_at);
      }
      const followup = item.desk.followup_on || (base.next_action_at && instant(base.next_action_at) !== null ? koreaDate(base.next_action_at) : '');
      const eligible = !['closed', 'on_hold'].includes(stage) && (active || (stage === 'completed' && Boolean(item.desk.fields?.followup_on) && !item.desk.followup_suggested));
      if (eligible && /^\d{4}-\d{2}-\d{2}$/.test(followup) && followup <= today) {
        const midnight = instant(`${followup}T00:00:00+09:00`);
        const assigned = state ? await lastEvent(db, base.id, null, followup, until) : null;
        const at = Math.max(midnight ?? 0, instant(assigned?.created_at) ?? instant(base.created_at) ?? 0);
        append({ ...item, desk: { ...item.desk, followup_on: followup } }, 'followup', `followup-${base.id}-${followup.replaceAll('-', '')}`, new Date(at).toISOString());
      }
    }
    if (cases.length < PAGE) break;
  }
  events.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const page = events.slice(offset, offset + PAGE);
  return { events: page, hasMore: offset + PAGE < events.length, nextOffset: offset + page.length };
}
