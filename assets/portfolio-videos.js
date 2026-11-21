// Keep every poster as a working YouTube link until the visitor chooses to play it here.
let restorePoster;

for (const poster of document.querySelectorAll('.video-screen a')) {
  poster.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (restorePoster) restorePoster();

    const id = new URL(poster.href).searchParams.get('v');
    const player = document.createElement('iframe');
    player.title = poster.getAttribute('aria-label');
    player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    player.allowFullscreen = true;
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    player.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&playsinline=1';
    poster.replaceWith(player);
    player.focus();
    restorePoster = () => player.replaceWith(poster);
  });
}
