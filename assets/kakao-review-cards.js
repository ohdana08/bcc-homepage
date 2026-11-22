// Public excerpts contain only the words selected for publication.
(() => {
  const excerpts = window.BCC_KAKAO_REVIEWS;
  if (!Array.isArray(excerpts) || !excerpts.length) return;

  for (const element of document.querySelectorAll('[data-kakao-review-count]')) {
    element.textContent = excerpts.length;
  }
  for (const element of document.querySelectorAll('[data-kakao-review-total]')) {
    element.textContent = ' · 카카오 후기 ' + excerpts.length + '건';
  }
  function quote(text) {
    const block = document.createElement('blockquote');
    block.textContent = text;
    return block;
  }
  const list = document.getElementById('kakao-review-list');
  if (list) {
    list.replaceChildren(...excerpts.map(quote));
    document.getElementById('kakao-reviews').hidden = false;
    document.getElementById('kakao-review-stat').hidden = false;
  }
  const grid = document.getElementById('home-review-grid');
  if (grid) {
    const previews = excerpts.slice(0, 2).map(text => {
      const link = document.createElement('a');
      link.className = 'rv-tile';
      link.href = '/reviews.html#kakao-reviews';
      link.dataset.educationAction = 'review-wall';
      const caption = document.createElement('span');
      caption.textContent = '카카오 채널 · 교육생 후기';
      link.append(quote(text), caption);
      return link;
    });
    grid.prepend(...previews);
  }
})();
