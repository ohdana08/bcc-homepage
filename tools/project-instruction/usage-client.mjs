// BCC usage-v1. Node.js 20+ server only. No dependencies or automatic tracking.
const ENDPOINT = 'https://bccconsulting.kr/api/project-instruction-usage?action=event';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['eventId','outcome','durationMs','review','endUserConsent','baselineSeconds','workSeconds','workTimeSource','comparableTask','checkedItems','correctItems','checkMethod','criteriaVersion'];
const integer = (n,min,max) => Number.isInteger(n) && n >= min && n <= max;
function valid(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k=>!FIELDS.includes(k))) return false;
  if (!UUID.test(e.eventId || '') || !['completed','failed'].includes(e.outcome) || !integer(e.durationMs,0,86400000) || !['not_reviewed','accepted','corrected','rejected'].includes(e.review) || e.endUserConsent !== true) return false;
  const time = ['baselineSeconds','workSeconds','workTimeSource','comparableTask'];
  if (time.some(k=>Object.hasOwn(e,k)) && !(integer(e.baselineSeconds,1,86400) && integer(e.workSeconds,0,86400) && ['measured','self_reported'].includes(e.workTimeSource) && e.comparableTask === true)) return false;
  const check = ['checkedItems','correctItems','checkMethod','criteriaVersion'];
  if (check.some(k=>Object.hasOwn(e,k)) && !(integer(e.checkedItems,1,10000) && integer(e.correctItems,0,e.checkedItems) && ['human_review','reference_check'].includes(e.checkMethod) && typeof e.criteriaVersion === 'string' && /^\d{1,4}(?:\.\d{1,4}){0,2}$/.test(e.criteriaVersion))) return false;
  if (e.outcome === 'failed' && (e.review !== 'not_reviewed' || time.concat(check).some(k=>Object.hasOwn(e,k)))) return false;
  return true;
}
export function createUsageClient({ submissionId, writeToken, enabled = false, mode = 'test', fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const configured = UUID.test(submissionId || '') && /^[a-f0-9]{64}$/i.test(writeToken || '') && ['test','live'].includes(mode) && typeof fetchImpl === 'function';
  return {
    async record(event) {
      if (enabled !== true || typeof window !== 'undefined') return { ok:false, reason:'disabled' };
      if (event?.endUserConsent !== true) return { ok:false, reason:'consent_required' };
      if (!configured || !valid(event)) return { ok:false, reason:'invalid_event' };
      // A retry reuses the complete immutable payload and event ID.
      const eventId = event.eventId.toLowerCase();
      const body = JSON.stringify({ id:submissionId.toLowerCase(), event:{ ...event, eventId, mode } });
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController(); let timer;
        try {
          const task = (async () => {
            const response = await fetchImpl(ENDPOINT, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + writeToken }, body, signal:controller.signal, redirect:'error', credentials:'omit' });
            if (!response.ok) return { ok:false, status:response.status, retry:response.status >= 500 };
            const value = await response.json();
            if (value.ok !== true || value.eventId !== eventId || value.mode !== mode || typeof value.replayed !== 'boolean' || !Number.isFinite(Date.parse(value.receivedAt))) return { ok:false, retry:true };
            return { ok:true, eventId:value.eventId, receivedAt:value.receivedAt, replayed:value.replayed, mode:value.mode };
          })();
          const timedOut = new Promise(resolve => { timer=setTimeout(()=>{ controller.abort(); resolve({ok:false,retry:true}); }, Math.max(50,Math.min(5000,Number(timeoutMs)||3000))); });
          const result = await Promise.race([task,timedOut]);
          if (result.ok) return result;
          if (!result.retry) return { ok:false, reason:'rejected', status:result.status };
        } catch { /* Never throw transport errors into the actual work or log credentials. */ }
        finally { clearTimeout(timer); controller.abort(); }
      }
      return { ok:false, reason:'unavailable' };
    },
  };
}
