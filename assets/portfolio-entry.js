(() => {
  const header = document.querySelector('.entry-header');
  const hero = document.querySelector('.entry-hero');
  if (!header || !hero) return;

  function closeMenus(event) {
    for (const menu of header.querySelectorAll('details[open]')) {
      if (!menu.contains(event.target) || event.target.closest('a[href]')) {
        menu.open = false;
      }
    }
  }

  document.addEventListener('click', closeMenus);
  document.addEventListener('focusin', event => {
    for (const menu of header.querySelectorAll('details[open]')) {
      if (!menu.contains(event.target)) menu.open = false;
    }
  });
  header.addEventListener('keydown', event => {
    const menu = event.target.closest('details[open]');
    if (menu && event.key === 'Escape') {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      document.body.classList.toggle('viewing-entry-hero', entry.isIntersecting);
    });
    observer.observe(hero);
  }
})();
