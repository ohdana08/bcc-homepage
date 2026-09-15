/* Only fixed public education categories are included in analytics. */
(function () {
  'use strict';
  var topics = {
    ai: '기업·기관 AI 실무교육', startup: 'AI 활용 창업교육',
    marketing: 'AI 활용 마케팅 교육', institution: '기관 맞춤 교육 상담',
    individual: '개인 학습·컨설팅 상담'
  };
  var message = document.getElementById('lf-message');
  var interest = document.getElementById('lf-education');
  var previousTemplate = '';
  function knownTopic(topic) { return Object.prototype.hasOwnProperty.call(topics, topic); }
  function applyTopic(topic) {
    if (!knownTopic(topic)) return;
    if (interest) interest.value = topic;
    if (!message) return;
    var template = topics[topic] + ' 문의\n' +
      (topic === 'individual' ? '배우고 싶은 내용: \n현재 사업·업무: \n궁금한 점: ' :
        '기관명: \n교육 대상·인원: \n희망 일정·시간: \n원하는 실습 결과물: ');
    if (!message.value.trim() || message.value === previousTemplate) {
      message.value = template;
      previousTemplate = template;
    }
  }
  applyTopic(new URLSearchParams(location.search).get('education'));
  if (interest) interest.addEventListener('change', function () {
    if (interest.value) applyTopic(interest.value);
    else if (message && message.value === previousTemplate) {
      message.value = ''; previousTemplate = '';
    }
  });
  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-education-action]');
    if (!link) return;
    var topic = link.dataset.educationTopic;
    if (link.dataset.educationAction === 'inquiry' && message && knownTopic(topic)) {
      var url = new URL(link.href, location.href);
      var homePath = function (path) { return path === '/' || path === '/index.html'; };
      if (url.origin === location.origin && homePath(url.pathname) && homePath(location.pathname) &&
          !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
        event.preventDefault();
        applyTopic(topic);
        location.hash = 'contact';
      }
    }
    if (!/^(www\.)?bccconsulting\.kr$/.test(location.hostname)) return;
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'education_navigation', {
        education_topic: knownTopic(topic) ? topic : 'overview',
        education_action: link.dataset.educationAction,
        page_path: location.pathname
      });
    }
  });
})();
