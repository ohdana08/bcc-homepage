// Claude 101 실습팩 소개 페이지 — 구매 문의 버튼.
// 2026-11-12 손님용 회원·결제 시스템 제거: 로그인·그로블 결제창 연동 대신 카톡 채널 문의로 연결한다.
// 그로블 상품 링크가 생기면 PURCHASE_URL만 그 주소로 바꾸면 된다.
const PURCHASE_URL = 'https://pf.kakao.com/_xbrxjxkxj/chat';

function track(name, params) {
  try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (_) {}
}

document.querySelectorAll('[data-purchase]').forEach((element) => {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    track('purchase_inquiry_clicked', { product_id: 'claude101-pro', channel: 'kakao' });
    window.open(PURCHASE_URL, '_blank', 'noopener');
  });
});
