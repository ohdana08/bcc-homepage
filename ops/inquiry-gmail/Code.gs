/** Separate free Gmail notification worker. No inquiry/database writes. */
const BCC_MAIL = Object.freeze({
  recipient: 'ohdana08@gmail.com',
  endpoint: 'https://bccconsulting.kr/api/claude101-suite?fn=inquiry-notifications',
  links: {
    simple: 'https://bcc-admin-eight.vercel.app/',
    detailed: 'https://bccconsulting.kr/admin-lecture-requests.html',
    survey: 'https://bccconsulting.kr/admin-training-needs.html',
    admin_action: 'https://bccconsulting.kr/admin-lecture-desk.html'
  },
  labels: { simple: '간단 문의', detailed: '상세 강의 의뢰서' }
});

function sendInquiryMail_(kind, createdAt, testTag) {
  if (!Object.prototype.hasOwnProperty.call(BCC_MAIL.links, kind)) throw new Error('Invalid inquiry kind');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Free email quota exhausted; retry later');
  const test = Boolean(testTag);
  const title = (test ? '[시험] ' : '') + '[BCC 강의문의] ' + BCC_MAIL.labels[kind] + (test ? ' 알림 확인 ' + testTag : ' 접수');
  const body = (test ? '실제 문의가 아닌 알림 수신 시험입니다. 문의 기록은 생성하지 않았습니다.' : BCC_MAIL.labels[kind] + '가 접수되었습니다.') +
    '\n\n' + (test ? '시험 시각: ' : '접수 시각: ') + Utilities.formatDate(new Date(createdAt), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') +
    '\n관리자 화면: ' + BCC_MAIL.links[kind] + '\n\n로그인 후 내용을 확인해 주세요. 이름·연락처·문의 내용은 이 메일에 포함하지 않습니다.';
  MailApp.sendEmail({ to: BCC_MAIL.recipient, subject: title, body: body, name: 'BCC 강의문의 알림' });
}

/** Sends three marked emails through the production mail helper, without fetching/writing inquiries. */
function sendTestEmails() {
  if (MailApp.getRemainingDailyQuota() < 3) throw new Error('Need quota for three test emails');
  const tag = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss');
  ['simple', 'detailed'].forEach(function(kind) { sendInquiryMail_(kind, new Date().toISOString(), tag); });
  sendSummaryMail_({kind:'survey',id:'synthetic',title:'가상 기관 · AI 경험 카드',created_at:new Date().toISOString(),summary_text:'알림 수신 확인용 가상 요약입니다. 실제 교육생 응답이 아닙니다.\n응답: 20명 / 예정 20명\n해본 AI 작업: 이미지 만들기 12명\n필요한 도움: AI에 요청하기 8명\n더 알고 싶은 내용: 회의록 정리 방법'}, tag);
  console.log('Test emails sent; tag=' + tag + '; no inquiry records created');
}

/** Run once after configuring INQUIRY_NOTIFICATION_SECRET in Script Properties. */
function enableNotifications() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    if ((props.getProperty('INQUIRY_NOTIFICATION_SECRET') || '').length < 32) throw new Error('Configure notification secret first');
    if (!props.getProperty('BCC_SURVEY_START_AT')) props.setProperty('BCC_SURVEY_START_AT', new Date().toISOString());
    if (!props.getProperty('BCC_ADMIN_ACTION_START_AT')) props.setProperty('BCC_ADMIN_ACTION_START_AT', new Date().toISOString());
    if (!props.getProperty('BCC_START_AT')) props.setProperty('BCC_START_AT', new Date().toISOString());
    const triggers = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'pollInquiryNotifications'; });
    // Install before removing only our previous triggers: a creation failure must
    // leave the current worker running. Existing checkpoints and sent IDs stay intact.
    ScriptApp.newTrigger('pollInquiryNotifications').timeBased().everyHours(1).create();
    triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });
    props.setProperty('BCC_POLL_INTERVAL_MINUTES', '60');
    console.log('Notification worker enabled; hourly checks; historical inquiries excluded');
  } finally { lock.releaseLock(); }
}

function pollInquiryNotifications() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const baseline = props.getProperty('BCC_START_AT');
    const secret = props.getProperty('INQUIRY_NOTIFICATION_SECRET');
    if (!baseline || !secret) throw new Error('Worker not initialized');
    const deadline = Date.now() + 240000;
    // Fixed upper bound + overlap covers concurrent commits; failed runs retain the previous checkpoint.
    const until = new Date(Date.now() - 5000).toISOString();
    const kinds = ['simple', 'detailed'];
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      const checkpoint = props.getProperty('BCC_CHECKPOINT_' + kind) || baseline;
      const since = new Date(Math.max(Date.parse(baseline), Date.parse(checkpoint) - 600000)).toISOString();
      if (Date.parse(since) > Date.parse(until)) continue;
      let offset = 0;
      let more = true;
      while (more) {
        if (Date.now() > deadline) return;
        const response = UrlFetchApp.fetch(BCC_MAIL.endpoint, {
          method: 'post', contentType: 'application/json', followRedirects: false, muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + secret },
          payload: JSON.stringify({ kind: kind, since: since, until: until, offset: offset })
        });
        if (response.getResponseCode() !== 200) throw new Error('Notification API HTTP ' + response.getResponseCode());
        const page = JSON.parse(response.getContentText());
        if (!Array.isArray(page.events) || typeof page.hasMore !== 'boolean') throw new Error('Invalid notification response');
        for (let i = 0; i < page.events.length; i++) {
          const event = page.events[i];
          if (event.kind !== kind || !/^[a-zA-Z0-9-]{1,100}$/.test(event.id) || !Number.isFinite(Date.parse(event.created_at))) throw new Error('Invalid event');
          const key = 'BCC_SENT_' + kind + '_' + event.id;
          if (!props.getProperty(key)) {
            if (Date.now() > deadline) return;
            sendInquiryMail_(kind, event.created_at);
            // At-least-once: a crash between send and this write can cause a duplicate, never silently mark before sending.
            props.setProperty(key, event.created_at);
          }
        }
        offset += page.events.length;
        more = page.hasMore;
        if (more && page.events.length === 0) throw new Error('Invalid empty page');
      }
      props.setProperty('BCC_CHECKPOINT_' + kind, until);
      const oldest = Date.parse(until) - 600000;
      const values = props.getProperties();
      Object.keys(values).forEach(function(key) {
        if (key.indexOf('BCC_SENT_' + kind + '_') === 0 && Date.parse(values[key]) < oldest) props.deleteProperty(key);
      });
    }
    pollSummaryNotifications_(props, secret, deadline, until);
    props.setProperty('BCC_LAST_OK', new Date().toISOString());
    console.log('Notification check completed');
  } finally { lock.releaseLock(); }
}


/** Known endpoints only; never include uploaded files or arbitrary destination URLs. */
function sendSummaryMail_(event, testTag) {
  if (['survey','admin_action'].indexOf(event.kind) < 0) throw new Error('Invalid summary kind');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Free email quota exhausted; retry later');
  const prefix = event.kind === 'survey' ? '[BCC 수요조사 요약] ' : '[BCC 관리자 알림] ';
  const subject = (testTag ? '[시험] ' : '') + prefix + String(event.title || '').replace(/[\r\n]/g,' ').slice(0,200) + (testTag ? ' '+testTag : '');
  const body = (testTag ? '실제 데이터가 아닌 알림 수신 시험입니다.\n\n' : '') + event.summary_text +
    '\n\n관리자 화면: ' + BCC_MAIL.links[event.kind] + '\n자세한 내용은 로그인 후 확인해 주세요.';
  MailApp.sendEmail({to:BCC_MAIL.recipient,subject:subject,body:body,name:'BCC 관리자 알림'});
}

function pollSummaryNotifications_(props, secret, deadline, until) {
  const streams = [['survey','BCC_SURVEY_START_AT'],['admin_action','BCC_ADMIN_ACTION_START_AT']];
  for (let k=0;k<streams.length;k++) {
    const kind=streams[k][0], baselineKey=streams[k][1];
    // Upgrading a previously enabled worker never replays old completion events.
    if (!props.getProperty(baselineKey)) props.setProperty(baselineKey,new Date().toISOString());
    const baseline=props.getProperty(baselineKey);
    let offset=0, more=true;
    while(more) {
      if (Date.now()>deadline) throw new Error('Summary check will resume on next run');
      const response=UrlFetchApp.fetch(BCC_MAIL.endpoint,{
        method:'post',contentType:'application/json',followRedirects:false,muteHttpExceptions:true,
        headers:{Authorization:'Bearer '+secret},payload:JSON.stringify({kind:kind,since:'1970-01-01T00:00:00.000Z',until:until,offset:offset})
      });
      if(response.getResponseCode()!==200) throw new Error('Summary API HTTP '+response.getResponseCode());
      const page=JSON.parse(response.getContentText());
      if(!Array.isArray(page.events)||typeof page.hasMore!=='boolean') throw new Error('Invalid summary page');
      for(let i=0;i<page.events.length;i++) {
        const event=page.events[i];
        if(event.kind!==kind||!/^[a-zA-Z0-9-]{1,100}$/.test(event.id)||!Number.isFinite(Date.parse(event.created_at))||typeof event.summary_text!=='string'||event.summary_text.length>40000||typeof event.title!=='string') throw new Error('Invalid summary event');
        const key='BCC_SENT_'+kind+'_'+event.id;
        if(props.getProperty(key)) continue;
        if(Date.parse(event.created_at)<Date.parse(baseline)) {props.setProperty(key,'historical');continue;}
        if(Date.now()>deadline) throw new Error('Summary check will resume on next run');
        sendSummaryMail_(event);
        // Permanent key: reopening a survey or refreshing the dashboard must not resend.
        props.setProperty(key,event.created_at);
      }
      const next=page.nextOffset===undefined ? offset+page.events.length : page.nextOffset;
      if(page.hasMore&&(!Number.isInteger(next)||next<=offset)) throw new Error('Invalid summary pagination');
      offset=next;more=page.hasMore;
    }
  }
}


/** Safe operational status: never print credentials or individual response text. */
function showNotificationStatus() {
  const props=PropertiesService.getScriptProperties();
  const count=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='pollInquiryNotifications';}).length;
  console.log(JSON.stringify({recipient:BCC_MAIL.recipient,trigger_count:count,poll_interval_minutes:props.getProperty('BCC_POLL_INTERVAL_MINUTES'),configured:Boolean(props.getProperty('INQUIRY_NOTIFICATION_SECRET')),inquiries_started:props.getProperty('BCC_START_AT'),surveys_started:props.getProperty('BCC_SURVEY_START_AT'),admin_actions_started:props.getProperty('BCC_ADMIN_ACTION_START_AT'),last_success:props.getProperty('BCC_LAST_OK')}));
}
