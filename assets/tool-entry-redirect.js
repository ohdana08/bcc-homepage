// Old bookmarks may include a category fragment, which never reaches the server.
(() => {
  const destinations = new Map([
    ['#job', '/employment-tools/'],
    ['#coach-job', '/employment-tools/#coach-job'],
    ['#startup', '/startup-tools/'],
    ['#coach-startup', '/startup-tools/#coach-startup'],
    ['#coach-marketing', '/startup-tools/#coach-marketing'],
    ['#marketing-research', '/startup-tools/#marketing-research'],
    ['#work', '/work-tools/'],
  ]);
  const origin = location.hostname === 'ohdana08.github.io' ? 'https://bccconsulting.kr' : location.origin;
  const destination = new URL(destinations.get(location.hash) || '/#tool-entries', origin);
  destination.search = location.search;
  location.replace(destination.href);
})();
