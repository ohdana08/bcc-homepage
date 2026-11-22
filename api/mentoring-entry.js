// Public gallery entrance and exchange of a verified BCC identity for a private,
// browser-bound, single-use workspace ticket. Participant data stays on its owner service.
export default async function enterWorkspace(req, res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  const fail=(status,error)=>res.status(status).json({error});
  if (!['GET','HEAD','POST'].includes(req.method)) return fail(405,'지원하지 않는 요청입니다.');
  try {
    const host=new URL(process.env.MENTORING_ORIGIN);
    if(host.protocol!=='https:' || host.username || host.password || host.origin!==process.env.MENTORING_ORIGIN) return fail(503,'작업공간 연결을 확인해주세요.');
    if(req.method!=='POST') return res.redirect(302,host.origin+'/student-works/mentoring/');
    if(req.headers.origin!=='https://bccconsulting.kr' || !/^application\/json\b/i.test(req.headers['content-type']||'')) return fail(403,'BCC 본인 확인 화면에서 다시 시도해주세요.');
    const token=req.headers.authorization||'';
    if(!/^Bearer [A-Za-z0-9_.-]{32,8192}$/.test(token)) return fail(401,'등록 이메일로 로그인해주세요.');
    const {flow,code=''}=req.body||{};
    if(typeof flow!=='string' || !/^[\w-]{43}$/.test(flow) || typeof code!=='string'||code.length>256) return fail(400,'입장 화면에서 다시 시작해주세요.');
    const identity=await fetch(new URL('/auth/v1/user',process.env.SUPABASE_URL),{
      headers:{Authorization:token,apikey:process.env.SUPABASE_ANON_KEY},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!identity.ok) return fail(identity.status>=500?503:401,'이메일 본인 확인을 다시 진행해주세요.');
    const user=await identity.json();
    if(!user.email_confirmed_at||!user.email||user.is_anonymous) return fail(403,'확인이 완료된 이메일이 필요합니다.');
    const secret=process.env.MENTORING_ADMIN_SECRET;
    if(!secret||secret.length<32) return fail(503,'관리자에게 작업공간 연결을 문의해주세요.');
    const upstream=await fetch(host.origin+'/api/internal/participant-ticket',{method:'POST',
      headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
      body:JSON.stringify({verified_email:user.email,flow,code}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!upstream.ok) return fail([400,401,403,429].includes(upstream.status)?upstream.status:503,
      upstream.status===429?'잠시 후 다시 시도해주세요.':'등록 이메일과 초대코드를 확인해주세요. 입장 시간이 지났다면 다시 시작해주세요.');
    const {ticket}=await upstream.json();
    if(!/^[\w-]{43}$/.test(ticket||'')) return fail(503,'입장 정보를 다시 요청해주세요.');
    return res.json({ticket,redeem_url:host.origin+'/api/auth/redeem'});
  } catch {return fail(503,'잠시 후 다시 시도해주세요.');}
}
