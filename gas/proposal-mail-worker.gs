// 강메일 — BCC 기관 제안 작업메일 자동화
// 지정된 Daum 발신 메일만 자동 라벨 → BCC 서버 처리 → 지정한 Daum 주소 한 곳으로만 결과 전달
// 원발신자에게 답장하거나 CC/BCC를 추가하지 않는다.

var BCC_PROPOSAL_ENDPOINT = 'https://bcc-homepage.vercel.app/api/cardnews-generate';
var BCC_TASK_LABEL = '강메일_작업함';
var BCC_PROCESSED_LABEL = '강메일_처리완료';
var BCC_PROCESSING_LABEL = '강메일_처리중';
var BCC_ERROR_LABEL = '강메일_오류';
var BCC_RESULT_PREFIX = '[강메일 처리완료]';
var BCC_MAX_MESSAGES_PER_RUN = 10;
var BCC_MAX_ATTACHMENT_BYTES = 2000000;
var BCC_MAX_TOTAL_ATTACHMENT_BYTES = 2500000;

function setupBccProposalMailbox() {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('BCC_MAIL_SECRET');
  var expectedRecipient = String(properties.getProperty('BCC_RESULT_EMAIL') || '').trim().toLowerCase();
  var forwarderEmail = String(properties.getProperty('BCC_FORWARDER_EMAIL') || '').trim().toLowerCase();
  if (!secret || secret.length < 24) {
    throw new Error('프로젝트 설정의 스크립트 속성에 BCC_MAIL_SECRET을 먼저 등록하세요.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedRecipient)) {
    throw new Error('프로젝트 설정의 스크립트 속성에 BCC_RESULT_EMAIL을 먼저 등록하세요.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwarderEmail)) {
    throw new Error('프로젝트 설정의 스크립트 속성에 BCC_FORWARDER_EMAIL을 먼저 등록하세요.');
  }

  getOrCreateBccLabel_(BCC_TASK_LABEL);
  getOrCreateBccLabel_(BCC_PROCESSED_LABEL);
  getOrCreateBccLabel_(BCC_PROCESSING_LABEL);
  getOrCreateBccLabel_(BCC_ERROR_LABEL);

  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'processBccProposalInbox';
  });
  if (!exists) {
    ScriptApp.newTrigger('processBccProposalInbox').timeBased().everyMinutes(5).create();
  }
}

function processBccProposalInbox() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('BCC_MAIL_SECRET');
    var expectedRecipient = String(properties.getProperty('BCC_RESULT_EMAIL') || '').trim().toLowerCase();
    var forwarderEmail = String(properties.getProperty('BCC_FORWARDER_EMAIL') || '').trim().toLowerCase();
    if (!secret || secret.length < 24) throw new Error('BCC_MAIL_SECRET이 없습니다.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedRecipient)) throw new Error('BCC_RESULT_EMAIL이 없습니다.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwarderEmail)) throw new Error('BCC_FORWARDER_EMAIL이 없습니다.');

    var taskLabel = getOrCreateBccLabel_(BCC_TASK_LABEL);
    var processedLabel = getOrCreateBccLabel_(BCC_PROCESSED_LABEL);
    var processingLabel = getOrCreateBccLabel_(BCC_PROCESSING_LABEL);
    var errorLabel = getOrCreateBccLabel_(BCC_ERROR_LABEL);
    // 전체 받은편지함이 아니라 지정한 Daum 주소에서 전달된 메일만 찾는다.
    var threads = GmailApp.search('in:inbox newer_than:30d from:(' + forwarderEmail + ')', 0, 30);
    var handled = 0;

    for (var i = 0; i < threads.length && handled < BCC_MAX_MESSAGES_PER_RUN; i++) {
      var thread = threads[i];
      var messages = thread.getMessages();

      for (var j = 0; j < messages.length && handled < BCC_MAX_MESSAGES_PER_RUN; j++) {
        var message = messages[j];
        var messageId = message.getId();
        if (properties.getProperty('DONE_' + messageId)) continue;
        if (!isAllowedBccForwarder_(message.getFrom(), forwarderEmail)) continue;
        if (String(message.getSubject() || '').indexOf(BCC_RESULT_PREFIX) === 0) continue;

        thread.addLabel(taskLabel);
        thread.addLabel(processingLabel);
        try {
          var payload = buildBccPayload_(message);
          var response = UrlFetchApp.fetch(BCC_PROPOSAL_ENDPOINT, {
            method: 'post',
            contentType: 'application/json',
            headers: { 'X-BCC-Mail-Secret': secret },
            payload: JSON.stringify({ engine: 'proposal_mail_intake', message: payload }),
            muteHttpExceptions: true
          });

          var status = response.getResponseCode();
          var parsed = JSON.parse(response.getContentText() || '{}');
          if (status < 200 || status >= 300 || !parsed.mail) {
            throw new Error(parsed.error || ('BCC 서버 오류: HTTP ' + status));
          }
          if (!parsed.mail.recipient || !parsed.mail.subject || !parsed.mail.text) {
            throw new Error('BCC 서버가 고정 결과 수신자 또는 결과 본문을 반환하지 않았습니다.');
          }
          if (String(parsed.mail.recipient).trim().toLowerCase() !== expectedRecipient) {
            throw new Error('BCC 서버 수신자와 Gmail 허용 수신자가 일치하지 않습니다.');
          }

          // 받는 사람은 Script Properties의 허용 주소 한 곳만 사용한다. 원발신자·CC·BCC는 사용하지 않는다.
          GmailApp.sendEmail(expectedRecipient, parsed.mail.subject, parsed.mail.text, {
            htmlBody: parsed.mail.html || undefined,
            name: '강메일',
            replyTo: expectedRecipient
          });

          properties.setProperty('DONE_' + messageId, new Date().toISOString());
          thread.addLabel(processedLabel);
          thread.removeLabel(errorLabel);
          thread.markRead();
          handled++;
        } catch (error) {
          thread.addLabel(errorLabel);
          console.error('BCC proposal mail failed', messageId, error && error.message ? error.message : error);
        } finally {
          thread.removeLabel(processingLabel);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function buildBccPayload_(message) {
  var attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  var totalBytes = 0;
  var encoded = attachments.slice(0, 10).map(function(blob) {
    var bytes = blob.getBytes();
    totalBytes += bytes.length;
    if (bytes.length > BCC_MAX_ATTACHMENT_BYTES) {
      throw new Error('첨부파일이 자동 처리 한도를 넘었습니다: ' + blob.getName());
    }
    if (totalBytes > BCC_MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error('첨부파일 전체 용량이 자동 처리 한도를 넘었습니다.');
    }
    return {
      filename: blob.getName() || 'attachment',
      mime_type: blob.getContentType() || 'application/octet-stream',
      data_base64: Utilities.base64Encode(bytes)
    };
  });

  return {
    message_id: message.getId(),
    thread_id: message.getThread().getId(),
    from: message.getFrom(),
    subject: message.getSubject(),
    received_at: message.getDate().toISOString(),
    plain_body: String(message.getPlainBody() || '').slice(0, 60000),
    attachments: encoded
  };
}

function getOrCreateBccLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function isAllowedBccForwarder_(fromValue, allowedEmail) {
  var match = String(fromValue || '').toLowerCase().match(/<([^<>\s]+@[^<>\s]+)>/);
  var email = match ? match[1] : String(fromValue || '').trim().toLowerCase();
  return email === String(allowedEmail || '').trim().toLowerCase();
}
