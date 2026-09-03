(function () {
  'use strict';

  var ENDPOINT = 'https://bcc-admin-eight.vercel.app/api/lead';
  var form = document.getElementById('workroomForm');
  var status = document.getElementById('formStatus');

  function track(name, params) {
    try {
      if (typeof gtag === 'function') gtag('event', name, params || {});
    } catch (error) {}
  }

  function source() {
    try {
      var query = new URLSearchParams(location.search);
      var values = [];
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (key) {
        var value = query.get(key);
        if (value) values.push(key + '=' + value);
      });
      return (values.join('&') || (document.referrer ? 'referrer=' + document.referrer : 'direct')).slice(0, 200);
    } catch (error) {
      return 'direct';
    }
  }

  function setStatus(message, kind) {
    status.textContent = message;
    status.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  document.querySelectorAll('[data-track]').forEach(function (link) {
    link.addEventListener('click', function () {
      track('workroom_cta_clicked', { placement: link.dataset.track });
    });
  });

  if (!form) return;

  form.addEventListener('focusin', function () {
    if (form.dataset.started) return;
    form.dataset.started = 'true';
    track('workroom_application_started');
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');

    if (!form.checkValidity()) {
      form.reportValidity();
      setStatus('필수 항목을 확인해 주세요.', 'error');
      track('workroom_application_validation_error');
      return;
    }

    var message = [
      '[AI 업무 작업실 파일럿]',
      '업무: ' + form.workflow.value,
      '반복 주기: ' + form.frequency.value,
      '사용 AI: ' + form.tool.value,
      '막히는 지점: ' + form.pain.value.trim(),
      '비식별 샘플 제공 가능: 예'
    ].join('\n');

    var payload = {
      name: form.name.value.trim(),
      contact: form.contact.value.trim(),
      request_type: 'general',
      message: message,
      source: source(),
      consent: true,
      website: form.website.value
    };

    button.disabled = true;
    setStatus('신청 내용을 보내고 있습니다…');

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      if (response.status === 201) {
        setStatus('신청이 완료되었습니다. 영업일 24시간 안에 가능 여부를 답변드릴게요.', 'success');
        track('workroom_application_submitted', { workflow: form.workflow.value, frequency: form.frequency.value });
        form.reset();
        status.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (response.status === 429) throw new Error('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      return response.json().then(function (data) {
        throw new Error(data && data.error ? data.error : '전송에 실패했습니다. 다시 시도해 주세요.');
      }).catch(function (error) {
        if (error instanceof SyntaxError) throw new Error('전송에 실패했습니다. 다시 시도해 주세요.');
        throw error;
      });
    }).catch(function (error) {
      setStatus(error.message || '네트워크 오류로 전송하지 못했습니다.', 'error');
      track('workroom_application_failed');
    }).finally(function () {
      button.disabled = false;
    });
  });
})();
