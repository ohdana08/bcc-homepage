// The BCC OAuth return address is already registered. Forward only this tab's
// pending mentoring PKCE return to its own confirmation screen.
(()=>{
 try {
  if (!sessionStorage.getItem('bcc-mentoring-pkce') || !sessionStorage.getItem('bcc-mentoring-flow')) return;
  const query=new URLSearchParams(location.search);
  const code=query.get('code');
  if(code) location.replace('/student-works/mentoring-auth.html?'+new URLSearchParams({code}));
 } catch { /* Other admin visits follow the normal login flow. */ }
})();
