// The BCC OAuth return address is already registered. Forward only this tab's
// pending mentoring PKCE return to its own confirmation screen.
(()=>{
 try {
  const query=new URLSearchParams(location.search);
  const failed=query.get('error_code')||new URLSearchParams(location.hash.slice(1)).get('error_code');
  // 뒤로가기로 지난 Google 계정 선택 화면에서 다시 고르면 인증 상태가 맞지 않아 Supabase가 여기로 보낸다.
  if (failed==='bad_oauth_state') {
   if (sessionStorage.getItem('bcc-mentoring-flow')) location.replace('/student-works/mentoring-auth.html');
   else if (Date.now()-Number(sessionStorage.getItem('bcc-mentoring-done')||0)<10*60*1000) {sessionStorage.removeItem('bcc-mentoring-done'); location.replace('https://bcc-modu-mentoring.vercel.app/student-works/mentoring/');}
   return;
  }
  if (!sessionStorage.getItem('bcc-mentoring-pkce') || !sessionStorage.getItem('bcc-mentoring-flow')) return;
  const code=query.get('code');
  if(code && !/reset-password/.test(location.pathname||'')) location.replace('/student-works/mentoring-auth.html?'+new URLSearchParams({code}));
 } catch { /* Other admin visits follow the normal login flow. */ }
})();
