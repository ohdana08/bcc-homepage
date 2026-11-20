(function () {
  "use strict";
  var KEY = "bcc-codex-setup-v1";

  // 시연 영상이 준비되면 video 값에 "/assets/demo/파일명.mp4"를 넣으면 단계 안에 자동으로 보입니다.
  var STEPS = [
    {
      title: "Codex 설치하고 로그인하기",
      time: "약 10분",
      video: "",
      tasks: [
        { text: "Windows용 ChatGPT 앱을 설치해요.", link: "https://developers.openai.com/codex/windows/windows-app", label: "공식 설치 페이지 열기" },
        { text: "앱을 열고 ChatGPT 계정으로 로그인한 뒤, 왼쪽에서 Codex로 바꿔요." },
        { text: "바탕화면이나 문서 폴더에 'BCC실습' 폴더를 만들고, Codex에서 '프로젝트 추가'로 그 폴더를 열어요." },
        { text: "입력창 아래 권한이 'Ask for approval(승인받기)'인지 확인해요. 전체 접근은 켜지 않아요." }
      ],
      prompt: "안녕! 지금 열린 폴더 경로가 어디인지, 그리고 네가 이 폴더 안의 파일을 읽고 만들 수 있는지 쉬운 말로 알려줘.",
      check: "Codex가 열린 폴더 경로를 답했어요."
    },
    {
      title: "실습 폴더로 내 노트북에서 앱 띄우기",
      time: "약 15분",
      video: "",
      tasks: [
        { text: "실습 폴더 ZIP을 받아 압축을 풀어요.", link: "/tools/codex-setup/bcc-codex-starter.zip", label: "실습 폴더 받기 (ZIP)", download: true },
        { text: "Node.js LTS 버전을 설치해요. 설치 화면은 기본값 그대로 '다음'만 누르면 돼요.", link: "https://nodejs.org/ko/download", label: "Node.js 받기" },
        { text: "Git for Windows를 설치해요. 역시 기본값 그대로 진행해요.", link: "https://git-scm.com/install/windows", label: "Git 받기" },
        { text: "Codex를 껐다 켠 뒤, 압축 푼 'bcc-codex-practice' 폴더를 프로젝트로 열어요." }
      ],
      prompt: "AGENTS.md를 먼저 읽어줘. 그다음 Node.js, npm, Git이 설치돼 있는지 버전만 확인하고, 이 앱을 내 컴퓨터에서 실행해서 브라우저로 볼 수 있는 주소를 알려줘.",
      check: "브라우저에서 '내 첫 AI 앱' 화면을 봤어요."
    },
    {
      title: "GitHub에 내 코드 올리기",
      time: "약 15분",
      video: "",
      tasks: [
        { text: "GitHub에 가입하거나 로그인해요. (Google 계정으로 가입 가능)", link: "https://github.com/signup", label: "GitHub 열기" },
        { text: "오른쪽 위 + → New repository에서 이름을 'bcc-codex-practice'로 만들어요. Private(비공개)로 두고, 다른 옵션은 체크하지 않아요.", link: "https://github.com/new", label: "새 저장소 만들기" },
        { text: "만든 저장소 주소(https://github.com/내아이디/bcc-codex-practice)를 복사해 둬요." }
      ],
      prompt: "이 폴더를 Git으로 관리하고, 내 GitHub 저장소 [여기에 저장소 주소 붙여넣기]에 연결해줘. 처음엔 main 브랜치로 올려줘. 올리기 전에 어느 저장소·브랜치로 가는지 먼저 보여주고 내 승인을 받아. 로그인이 필요하면 브라우저 로그인 창을 띄워줘. 토큰은 쓰지 마.",
      check: "GitHub 저장소 페이지에 내 파일들이 보여요."
    },
    {
      title: "Vercel에 연결해서 인터넷 주소 만들기",
      time: "약 10분",
      video: "",
      tasks: [
        { text: "Vercel에 'Continue with GitHub'로 가입하거나 로그인해요. 요금제는 Hobby(무료)를 골라요.", link: "https://vercel.com/signup", label: "Vercel 열기" },
        { text: "Add New → Project를 눌러요.", link: "https://vercel.com/new", label: "새 프로젝트 화면" },
        { text: "목록에서 'bcc-codex-practice' 옆 Import를 눌러요. 안 보이면 아래 '자주 막히는 곳'을 보세요." },
        { text: "설정은 바꾸지 말고 Deploy를 눌러요. 완료되면 나오는 주소를 열어 봐요." }
      ],
      prompt: "",
      check: "vercel.app 주소에서 '내 첫 AI 앱' 화면이 열려요."
    },
    {
      title: "말로 수정하고 미리보기로 확인하기",
      time: "약 10분",
      video: "",
      tasks: [
        { text: "아래 문장을 Codex에 보내고, 계획과 테스트 결과를 확인한 뒤 승인해요." },
        { text: "Vercel 프로젝트의 Deployments 화면에서 'practice' 브랜치로 새로 생긴 배포(Preview)를 열어요." },
        { text: "바뀐 제목이 보이면 세팅 완료예요. 운영 주소(main)는 그대로인 것도 확인해요." }
      ],
      prompt: "첫 화면 제목을 '[내 프로젝트 이름]'으로 바꿔줘. 바꾸기 전에 계획을 보여주고, 바꾼 뒤 npm test를 돌려서 결과를 알려줘. 그다음 practice라는 새 브랜치를 만들어서, 내가 승인하면 GitHub에 올려줘. main은 건드리지 마.",
      check: "Vercel 미리보기 주소에서 바뀐 제목을 봤어요."
    }
  ];

  var state = load();
  var list = document.getElementById("steps");

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { done: [], open: 0 }; }
    catch (e) { return { done: [], open: 0 }; }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render() {
    list.textContent = "";
    STEPS.forEach(function (s, i) {
      var done = state.done.indexOf(i) > -1;
      var li = el("li", "step" + (done ? " is-done" : "") + (state.open === i ? " is-open" : ""));
      var head = el("button", "step-head");
      head.type = "button";
      head.setAttribute("aria-expanded", String(state.open === i));
      head.appendChild(el("span", "step-num", done ? "✓" : String(i + 1)));
      var ht = el("span", "step-title");
      ht.appendChild(el("strong", null, s.title));
      ht.appendChild(el("small", null, s.time));
      head.appendChild(ht);
      head.addEventListener("click", function () { state.open = state.open === i ? -1 : i; save(); render(); });
      li.appendChild(head);

      if (state.open === i) {
        var body = el("div", "step-body");
        if (s.video) {
          var v = el("video", "step-video");
          v.src = s.video; v.controls = true; v.muted = true; v.playsInline = true; v.preload = "metadata";
          body.appendChild(v);
        }
        var ul = el("ol", "tasks");
        s.tasks.forEach(function (t) {
          var item = el("li", null, t.text);
          if (t.link) {
            var a = el("a", "link-btn", t.label + " ↗");
            a.href = t.link;
            if (t.download) { a.setAttribute("download", ""); a.textContent = t.label + " ↓"; }
            else { a.target = "_blank"; a.rel = "noopener"; }
            item.appendChild(document.createTextNode(" "));
            item.appendChild(a);
          }
          ul.appendChild(item);
        });
        body.appendChild(ul);

        if (s.prompt) {
          var box = el("div", "prompt");
          box.appendChild(el("p", "prompt-label", "Codex에 보낼 문장"));
          box.appendChild(el("p", "prompt-text", s.prompt));
          var copy = el("button", "copy", "복사하기");
          copy.type = "button";
          copy.addEventListener("click", function () { copyText(s.prompt, copy); });
          box.appendChild(copy);
          body.appendChild(box);
        }

        var lab = el("label", "check");
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = done;
        cb.addEventListener("change", function () {
          if (cb.checked) { if (!done) state.done.push(i); state.open = nextOpen(i); }
          else { state.done = state.done.filter(function (x) { return x !== i; }); }
          save(); render();
        });
        lab.appendChild(cb);
        lab.appendChild(el("span", null, s.check));
        body.appendChild(lab);
        li.appendChild(body);
      }
      list.appendChild(li);
    });
    var n = state.done.length;
    document.getElementById("progress-fill").style.width = (n / STEPS.length * 100) + "%";
    document.getElementById("progress-text").textContent = n + " / " + STEPS.length + " 단계 완료";
    document.getElementById("done-box").hidden = n !== STEPS.length;
  }

  function nextOpen(i) {
    for (var k = i + 1; k < STEPS.length; k++) if (state.done.indexOf(k) < 0) return k;
    for (k = 0; k < STEPS.length; k++) if (state.done.indexOf(k) < 0) return k;
    return -1;
  }

  function copyText(text, btn) {
    var ok = function () { btn.textContent = "복사됨"; setTimeout(function () { btn.textContent = "복사하기"; }, 1500); };
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(ok, fallback); }
    else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  document.getElementById("reset").addEventListener("click", function () {
    if (!confirm("진행 체크를 모두 지울까요?")) return;
    state = { done: [], open: 0 }; save(); render();
  });

  render();
})();
