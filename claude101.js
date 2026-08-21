(function () {
  'use strict';

  document.querySelectorAll('[data-copy-target]').forEach(function (button) {
    button.addEventListener('click', async function () {
      var target = document.getElementById(button.getAttribute('data-copy-target'));
      if (!target) return;
      var original = button.textContent;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        button.textContent = '복사됨';
      } catch (error) {
        button.textContent = '선택해서 복사';
      }
      window.setTimeout(function () { button.textContent = original; }, 1600);
    });
  });

  var checklist = document.querySelector('[data-checklist]');
  if (!checklist) return;
  var key = checklist.getAttribute('data-checklist');
  var checks = Array.from(checklist.querySelectorAll('input[type="checkbox"]'));

  try {
    var saved = JSON.parse(localStorage.getItem(key) || '[]');
    checks.forEach(function (input, index) { input.checked = Boolean(saved[index]); });
  } catch (error) {}

  checklist.addEventListener('change', function () {
    try {
      localStorage.setItem(key, JSON.stringify(checks.map(function (input) { return input.checked; })));
    } catch (error) {}
  });
})();
