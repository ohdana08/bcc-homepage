(() => {
  const root = document.querySelector('[data-works-library]');
  if (!root) return;
  const cards = [...root.querySelectorAll('[data-work]')];
  const filters = [...root.querySelectorAll('[data-filter]')];
  const search = root.querySelector('#work-search');
  const count = root.querySelector('#work-count');
  const empty = root.querySelector('#work-empty');
  let category = '전체';
  function apply() {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    cards.forEach(card => {
      card.hidden = !(category === '전체' || card.dataset.category === category) || !card.textContent.toLocaleLowerCase().includes(query);
      if (!card.hidden) visible += 1;
    });
    count.textContent = `등록된 ${cards.length}개 중 ${visible}개 작품`;
    empty.hidden = visible !== 0;
  }
  filters.forEach(button => button.addEventListener('click', () => {
    category = button.dataset.filter;
    filters.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    apply();
  }));
  search.addEventListener('input', apply);
  root.querySelector('[data-reset]').addEventListener('click', () => {
    search.value = '';
    filters[0].click();
    search.focus();
  });
  root.querySelector('[data-works-tools]').hidden = false;
  const dialog = document.querySelector('#work-dialog');
  if (typeof dialog.showModal !== 'function') return;
  let opener;
  root.querySelectorAll('[data-preview]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    opener = link;
    const card = link.closest('[data-work]');
    dialog.querySelector('h2').textContent = card.querySelector('h3').textContent;
    dialog.querySelector('[data-dialog-content]').replaceChildren(card.querySelector('template').content.cloneNode(true));
    dialog.showModal();
    dialog.querySelector('[data-close]').focus();
  }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => opener?.focus());
})();
