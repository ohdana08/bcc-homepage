const dialog = document.querySelector('dialog');
const media = document.querySelector('#media');
let opener;
let openedFromList = false;

function showWork() {
  const card = document.getElementById(location.hash.slice(1));
  if (!card?.matches('article')) {
    if (dialog.open) dialog.close();
    return;
  }
  opener = card.querySelector('.work-link');
  const title = card.querySelector('h2').textContent;
  document.querySelector('#work-title').textContent = title;
  document.querySelector('#note').textContent = card.querySelector('p').textContent;
  media.replaceChildren();
  for (const image of card.querySelectorAll('img')) {
    if (!card.dataset.video) {
      media.append(image.cloneNode());
      continue;
    }
    const player = document.createElement('video');
    player.controls = true;
    player.playsInline = true;
    player.preload = 'metadata';
    player.poster = image.src;
    player.src = image.src.replace(/\.webp$/, '.mp4');
    player.setAttribute('aria-label', image.alt);
    media.append(player);
  }
  if (!dialog.open) dialog.showModal();
}

document.querySelector('.grid').addEventListener('click', event => {
  const link = event.target.closest('.work-link');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState(null, '', link.hash);
  openedFromList = true;
  showWork();
  const player = media.querySelector('video');
  if (player) player.play().catch(() => { /* Playback controls remain available. */ });
});
dialog.addEventListener('close', () => {
  media.replaceChildren();
  if (location.hash && document.getElementById(location.hash.slice(1))?.matches('article')) {
    if (openedFromList) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
  }
  openedFromList = false;
  opener?.focus({preventScroll:true});
});
window.addEventListener('hashchange', showWork);
showWork();
