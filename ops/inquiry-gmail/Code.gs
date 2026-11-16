/** Separate free Gmail notification worker. No inquiry/database writes. */
const BCC_MAIL = Object.freeze({
  recipient: 'ohdana08@gmail.com',
  endpoint: 'https://bccconsulting.kr/api/claude101-suite?fn=inquiry-notifications',
  links: {
    simple: 'https://bcc-admin-eight.vercel.app/',
    detailed: 'https://bccconsulting.kr/admin-lecture-requests.html'
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

/** Sends two marked emails through the production mail helper, without fetching/writing inquiries. */
function sendTestEmails() {
  if (MailApp.getRemainingDailyQuota() < 2) throw new Error('Need quota for two test emails');
  const tag = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd-HHmmss');
  ['simple', 'detailed'].forEach(function(kind) { sendInquiryMail_(kind, new Date().toISOString(), tag); });
  console.log('Test emails sent; tag=' + tag + '; no inquiry records created');
}

/** Run once after configuring INQUIRY_NOTIFICATION_SECRET in Script Properties. */
function enableNotifications() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    if ((props.getProperty('INQUIRY_NOTIFICATION_SECRET') || '').length < 32) throw new Error('Configure notification secret first');
    if (!props.getProperty('BCC_START_AT')) props.setProperty('BCC_START_AT', new Date().toISOString());
    const triggers = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'pollInquiryNotifications'; });
    if (!triggers.length) ScriptApp.newTrigger('pollInquiryNotifications').timeBased().everyMinutes(1).create();
    triggers.slice(1).forEach(function(t) { ScriptApp.deleteTrigger(t); });
    console.log('Notification worker enabled; historical inquiries excluded');
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
    props.setProperty('BCC_LAST_OK', new Date().toISOString());
    console.log('Notification check completed');
  } finally { lock.releaseLock(); }
}
