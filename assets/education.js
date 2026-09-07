/* Course context is a fixed public value, never user-entered personal data. */
(function () {
  var topics = { ai: '부산 AI 교육', startup: '부산 창업교육' };
  var topic = new URLSearchParams(location.search).get('education');
  var message = document.getElementById('lf-message');
  if (topics[topic] && message && !message.value.trim()) {
    message.value = topics[topic] + ' 문의\n기관명: \n교육 대상·인원: \n희망 일정·시간: \n원하는 실습 결과물: ';
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-education-action]');
    if (!link || !/^(www\.)?bccconsulting\.kr$/.test(location.hostname)) return;
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'education_navigation', {
        education_topic: link.dataset.educationTopic || 'overview',
        education_action: link.dataset.educationAction,
        page_path: location.pathname
      });
    }
  });
})();
