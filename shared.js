"use strict";
/* Apply the saved colour mode before first paint to avoid a flash. */
try{
  document.documentElement.dataset.mode =
    localStorage.getItem("btp.mode") || "dark";
}catch(e){ /* localStorage may be blocked; default stays dark */ }

/* =====================================================================
   BEYOND THE POINT — shared runtime
   Loaded by index.html and every chNN.html chapter page via
   <script src="shared.js"></script>. Everything lives on window.BTP.

   CONTRACT FOR CHAPTER PAGES
   ---------------------------------------------------------------------
   Every chapter page is expected to include, in its <header>:
     <span id="streak">0</span>  and  <span id="xp">0</span>
   and to call BTP.paintStats() once on load (BTP.addXP already repaints).

   Sections below:
     1. SAVE / XP / STREAK           BTP.load, addXP, touchStreak, paintStats
     2. MISC UTILS                   BTP.shuffle, toast, indianCommas, numberName, say
     3. QUIZ ENGINE                  BTP.setupQuiz(QUESTIONS, opts)
     4. NUMBER LINE WIDGET           BTP.NumberLine(config)
     5. BALANCE WIDGET (algebra)     BTP.Balance(containerId)
     6. GRID WIDGET (fractions/HCF)  BTP.Grid(containerId, rows, cols)
     7. SVG / DRAG HELPERS (geometry) BTP.svgEl, BTP.dragPoint, BTP.angleDeg, BTP.dist
   ===================================================================== */

const BTP = {};

/* ---------------------------------------------------------------
   1. SAVE  (localStorage keeps XP + streak between sessions,
   shared across every chapter page — same key, same origin)
   --------------------------------------------------------------- */
(function(){
  const SAVE_KEY = "btp.save.v1";
  let save = load();

  function load(){
    try{
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if(s && typeof s.xp === "number") return s;
    }catch(e){ /* corrupt or first run - fall through */ }
    return { xp:0, streak:0, lastDay:null, done:{} };
  }
  function store(){ localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }

  function touchStreak(){
    const today = new Date().toDateString();
    if(save.lastDay === today) return;
    const y = new Date(Date.now() - 864e5).toDateString();
    save.streak = (save.lastDay === y) ? save.streak + 1 : 1;
    save.lastDay = today;
    store();
  }
  function addXP(n){
    save.xp += n; store(); paintStats();
  }
  function paintStats(){
    const xEl = document.getElementById("xp");
    const sEl = document.getElementById("streak");
    if(xEl) xEl.textContent = save.xp;
    if(sEl) sEl.textContent = save.streak;
  }
  // mark a chapter's quiz as cleared at least once — index.html reads this
  // to show a "done" badge on the chapter card.
  function markDone(chapterId){
    save.done = save.done || {};
    save.done[chapterId] = true;
    store();
  }
  function isDone(chapterId){
    return !!(save.done && save.done[chapterId]);
  }

  BTP.save = save;              // read-only peek, e.g. BTP.save.xp
  BTP.addXP = addXP;
  BTP.touchStreak = touchStreak;
  BTP.paintStats = paintStats;
  BTP.markDone = markDone;
  BTP.isDone = isDone;
})();

/* ---------------------------------------------------------------
   2. MISC UTILS
   --------------------------------------------------------------- */
BTP.toast = function(msg){
  const t = document.getElementById("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(BTP.toast._t);
  BTP.toast._t = setTimeout(()=>t.classList.remove("show"), 1600);
};

BTP.shuffle = function(a){
  a = a.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
};

// picks a random item — handy for rotating mascot phrases so feedback
// doesn't feel like the same canned line every time
BTP.pick = function(arr){ return arr[Math.floor(Math.random()*arr.length)]; };

// "1234567" -> "12,34,567"  (Indian digit grouping, 3-2-2-2 from the right)
BTP.indianCommas = function(n){
  n = Math.round(n);
  const neg = n < 0; n = Math.abs(n);
  const s = String(n);
  if(s.length <= 3) return (neg?"-":"") + s;
  const last3 = s.slice(-3);
  let rest = s.slice(0,-3);
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (neg?"-":"") + rest + "," + last3;
};

const BTP_ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
  "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const BTP_TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

// small-number word, 0-19 direct, else "twenty three" etc (used for XP-scale numbers)
BTP.say = function(n){
  if(n < 20) return BTP_ONES[n];
  return BTP_TENS[Math.floor(n/10)] + (n%10 ? " " + BTP_ONES[n%10] : "");
};

// full Indian-system number name, e.g. 4050678 -> "forty lakh fifty thousand six hundred seventy eight"
BTP.numberName = function(n){
  n = Math.round(n);
  if(n === 0) return "zero";
  const neg = n < 0; n = Math.abs(n);
  function twoDigit(x){ return x < 20 ? BTP_ONES[x] : BTP_TENS[Math.floor(x/10)] + (x%10 ? " " + BTP_ONES[x%10] : ""); }
  function threeDigit(x){
    const h = Math.floor(x/100), r = x%100;
    let out = h ? BTP_ONES[h] + " hundred" : "";
    if(r) out += (h ? " " : "") + twoDigit(r);
    return out;
  }
  let crore = Math.floor(n/1e7); n %= 1e7;
  let lakh  = Math.floor(n/1e5); n %= 1e5;
  let thou  = Math.floor(n/1e3); n %= 1e3;
  let rest  = n;
  const parts = [];
  if(crore) parts.push(threeDigit(crore) + " crore");
  if(lakh)  parts.push(twoDigit(lakh) + " lakh");
  if(thou)  parts.push(twoDigit(thou) + " thousand");
  if(rest)  parts.push(threeDigit(rest));
  return (neg ? "minus " : "") + parts.join(" ");
};

/* ---------------------------------------------------------------
   3. QUIZ ENGINE
   Reusable "Challenge" tab: shuffles a question bank, shows N of
   them, tracks right/wrong, awards XP, shows a done screen.

   Expects this markup inside the page (ids are fixed by convention —
   copy the block from any existing chapter's Challenge panel):

     <div class="bar"><i id="qbar"></i></div>
     <div id="qbox">
       <div class="book" id="qsrc">SECTION</div>
       <div class="quest"><div class="q" id="qq">…</div><div class="meta" id="qm"></div></div>
       <div class="opts" id="qopts"></div>
       <div class="fb" id="qfb"></div>
       <button class="btn hide" id="qnext">Next &rarr;</button>
     </div>
     <div id="qdone" class="hide" style="text-align:center;padding:26px 0">
       <div style="font-size:44px">🏆</div>
       <h2 style="margin:10px 0">Chapter cleared</h2>
       <p class="lede" id="qscore"></p>
       <button class="btn" id="qagain">Play again</button>
     </div>

   QUESTIONS: [{ src, q, opts:[...], a:<index of correct opt>, why }, ...]
   opts (optional): { count:6, xp:10, chapterId:"p1c1",
     onAnswer(correct, clickedButtonEl) }  // fires right after each answer —
     hook a mascot reaction / BTP.confetti / BTP.shakeEl here if you want one
   --------------------------------------------------------------- */
BTP.setupQuiz = function(QUESTIONS, opts){
  opts = opts || {};
  const count = opts.count || Math.min(6, QUESTIONS.length);
  const xpPer = opts.xp || 10;
  const chapterId = opts.chapterId || null;

  let quiz = [], qi = 0, qRight = 0;

  /* A reactive mascot lives at the top of the Challenge panel and
     changes expression on every answer. It auto-mounts using the
     page's theme, so no per-chapter markup is needed. */
  let qMascot = null;
  (function initQuizMascot(){
    const box = document.getElementById("qbox");
    if(!box || document.getElementById("btp-quiz-mascot")) return;
    const theme = opts.mascot ||
      (document.body && document.body.dataset.theme) || "aqua";
    const nm = (BTP.MascotThemes[theme] && BTP.MascotThemes[theme].name) || "";
    const row = document.createElement("div");
    row.className = "mascot-row";
    row.style.alignItems = "center";
    const mount = document.createElement("div");
    mount.id = "btp-quiz-mascot";
    const cap = document.createElement("div");
    cap.style.cssText = "flex:1;min-width:180px";
    cap.innerHTML = '<p class="lede" style="margin:0">' +
      (nm ? nm + " is cheering you on — answer and watch!"
          : "Answer and watch the reaction!") + '</p>';
    row.appendChild(mount);
    row.appendChild(cap);
    box.insertBefore(row, box.firstChild);
    qMascot = BTP.Mascot("btp-quiz-mascot", theme);
  })();

  const Q_OK = ["Yes!", "Nice!", "Boom!", "Great!"];
  const Q_NO = ["Oops!", "Almost!", "Try again!", "So close!"];

  function start(){
    quiz = BTP.shuffle(QUESTIONS).slice(0, count).map(q=>{
      const right = q.opts[q.a];
      const shuffledOpts = BTP.shuffle(q.opts);
      return Object.assign({}, q, { opts: shuffledOpts, a: shuffledOpts.indexOf(right) });
    });
    qi = 0; qRight = 0;
    document.getElementById("qdone").classList.add("hide");
    document.getElementById("qbox").classList.remove("hide");
    loadQ();
  }

  function loadQ(){
    const q = quiz[qi];
    document.getElementById("qsrc").textContent = q.src || "";
    document.getElementById("qq").textContent   = q.q;
    document.getElementById("qm").textContent   = "Question " + (qi+1) + " of " + quiz.length;
    document.getElementById("qbar").style.width = (qi / quiz.length * 100) + "%";
    document.getElementById("qfb").className = "fb";
    document.getElementById("qnext").classList.add("hide");

    const box = document.getElementById("qopts");
    box.innerHTML = "";
    q.opts.forEach((o,i)=>{
      const b = document.createElement("button");
      b.className = "opt"; b.textContent = o;
      b.onclick = ()=>answer(i);
      box.appendChild(b);
    });
  }

  function answer(i){
    const q  = quiz[qi];
    const bs = [...document.getElementById("qopts").children];
    bs.forEach(b => b.disabled = true);
    bs[q.a].classList.add("right");

    const fb = document.getElementById("qfb");
    const correct = i === q.a;
    if(correct){
      qRight++; BTP.addXP(xpPer); BTP.touchStreak();
      fb.className = "fb good show";
      fb.innerHTML = "<b>Correct.</b> " + q.why + " <span style='opacity:.75'>+" + xpPer + " XP</span>";
      BTP.toast("+" + xpPer + " XP");
      BTP.sound.right();
      if(qMascot){ qMascot.react("happy"); qMascot.say(BTP.pick(Q_OK), 1600); }
    } else {
      bs[i].classList.add("wrong");
      fb.className = "fb bad show";
      fb.innerHTML = "<b>Not this time.</b> " + q.why;
      BTP.sound.wrong();
      if(qMascot){ qMascot.react("sad"); qMascot.say(BTP.pick(Q_NO), 1600); }
    }
    document.getElementById("qnext").classList.remove("hide");
    if(opts.onAnswer) opts.onAnswer(correct, bs[i]);
  }

  document.getElementById("qnext").onclick = ()=>{
    qi++;
    if(qi >= quiz.length){
      document.getElementById("qbar").style.width = "100%";
      document.getElementById("qbox").classList.add("hide");
      const d = document.getElementById("qdone");
      d.classList.remove("hide");
      document.getElementById("qscore").textContent =
        qRight + " out of " + quiz.length + " — " +
        (qRight === quiz.length ? "perfect run." :
         qRight >= quiz.length-1 ? "one slip, that's all." :
         "worth another go.");
      if(chapterId && qRight >= Math.ceil(quiz.length*0.6)) BTP.markDone(chapterId);
    } else loadQ();
  };
  document.getElementById("qagain").onclick = start;

  return { start };
};

/* ---------------------------------------------------------------
   3C. LEARN ENGINE — concept slides + a short check quiz.
   Each chapter provides slide markup with ids lsld0..lsldN-1 plus the
   nav / check / done scaffold, then calls BTP.setupLearn({...}).

   Required markup inside the Learn <section class="panel">:
     <div class="learn-slide on" id="lsld0">…</div>  (lsld1, lsld2, …)
     <div class="learn-nav" id="learnSlideNav">
       <div class="learn-dots" id="learnDots"></div>
       <button class="btn" id="learnNext">Next &rarr;</button>
     </div>
     <div id="learnCheck" class="hide">
       <div class="quest"><div class="q" id="lcq">…</div></div>
       <div class="opts" id="lcopts"></div>
       <div class="fb" id="lcfb"></div>
       <div class="bar"><i id="lcbar"></i></div>
       <button class="btn hide" id="lcnext">Next &rarr;</button>
     </div>
     <div id="learnDone" class="hide">…</div>

   opts: { slides:<int>, say:[…per slide…], check:[{q,opts,a,why}],
           mascot:<BTP.Mascot instance>, xp:5 }
   --------------------------------------------------------------- */
BTP.setupLearn = function(opts){
  opts = opts || {};
  const n = opts.slides || 1;
  const say = opts.say || [];
  const CHECK = opts.check || [];
  const m = opts.mascot || null;
  const xpPer = opts.xp || 5;
  const OK = ["Yes! Exactly.", "Nailed it.", "Great!"];
  const NO = ["Not quite — look again.", "Close! Try once more.", "Almost!"];
  const ids = [];
  for(let i = 0; i < n; i++) ids.push("lsld" + i);
  let cur = 0, ci = 0, right = 0;
  const el = id => document.getElementById(id);

  function dots(){
    const d = el("learnDots");
    if(d) d.innerHTML = ids.map((_,i)=>
      '<div class="learn-dot' + (i===cur?' on':'') + '"></div>').join("");
  }
  function show(i){
    cur = i;
    ids.forEach((id,idx)=>{
      const s = el(id);
      if(s) s.classList.toggle("on", idx===i);
    });
    dots();
    const nx = el("learnNext");
    if(nx) nx.textContent = (i===n-1) ? "Let's check! \u2192" : "Next \u2192";
    if(m && say[i]) m.say(say[i], 3200);
    if(m) m.react(i===n-1 ? "happy" : "idle");
  }
  const nextBtn = el("learnNext");
  if(nextBtn) nextBtn.onclick = ()=>{
    if(cur < n-1){ show(cur+1); return; }
    const nav = el("learnSlideNav");
    if(nav) nav.classList.add("hide");
    if(CHECK.length) startCheck(); else finish();
  };

  function startCheck(){
    ci = 0; right = 0;
    const done = el("learnDone"); if(done) done.classList.add("hide");
    const box = el("learnCheck"); if(box) box.classList.remove("hide");
    loadCheck();
  }
  function loadCheck(){
    const item = CHECK[ci];
    el("lcq").textContent = item.q;
    el("lcfb").className = "fb";
    el("lcnext").classList.add("hide");
    el("lcbar").style.width = (ci / CHECK.length * 100) + "%";
    const box = el("lcopts"); box.innerHTML = "";
    item.opts.forEach((o,i)=>{
      const b = document.createElement("button");
      b.className = "opt"; b.textContent = o;
      b.onclick = ()=>{
        [...box.children].forEach(x => x.disabled = true);
        box.children[item.a].classList.add("right");
        const fb = el("lcfb");
        if(i === item.a){
          right++; BTP.addXP(xpPer); BTP.touchStreak();
          fb.className = "fb good show";
          fb.innerHTML = "<b>" + BTP.pick(OK) + "</b> " + item.why +
            " <span style='opacity:.75'>+" + xpPer + " XP</span>";
          BTP.toast("+" + xpPer + " XP");
          if(m) m.react("happy");
          BTP.sound.right();
        } else {
          box.children[i].classList.add("wrong");
          fb.className = "fb bad show";
          fb.innerHTML = "<b>" + BTP.pick(NO) + "</b> " + item.why;
          if(m) m.react("sad");
          BTP.sound.wrong();
        }
        el("lcnext").classList.remove("hide");
      };
      box.appendChild(b);
    });
  }
  const lcNext = el("lcnext");
  if(lcNext) lcNext.onclick = ()=>{
    ci++;
    if(ci >= CHECK.length){
      el("lcbar").style.width = "100%";
      el("learnCheck").classList.add("hide");
      finish();
    } else loadCheck();
  };
  function finish(){
    const done = el("learnDone");
    if(done) done.classList.remove("hide");
    if(m) m.say(right === CHECK.length ?
      "Perfect! You're ready." :
      "Good work — now try the activities.", 3200);
  }

  show(0);
  return { show };
};

/* ---------------------------------------------------------------
   3B. SECTION QUIZ ENGINE — a menu of per-textbook-section quizzes
   instead of one combined Challenge. Each section needs 80% (default)
   to be "mastered"; falling short tells the student which section to
   go back and review before retrying. Scores persist across visits.

   Required markup (put this inside your Challenge <section class="panel">):
     <div id="secMenu"></div>
     <div id="secQuizBox" class="hide">
       <button class="btn ghost" id="secBack">&larr; All sections</button>
       <div class="bar"><i id="qbar"></i></div>
       <div class="book" id="qsrc">SECTION</div>
       <div class="quest"><div class="q" id="qq">…</div><div class="meta" id="qm"></div></div>
       <div class="opts" id="qopts"></div>
       <div class="fb" id="qfb"></div>
       <button class="btn hide" id="qnext">Next &rarr;</button>
     </div>
     <div id="secResult" class="hide" style="text-align:center;padding:20px 0"></div>

   SECTIONS: [{ id:"3.2", title:"3.2 · A Tenth Part", questions:[{q,opts,a,why,followUp}, ...] }, ...]
   opts (optional): { chapterId, passPct:0.8, xp:10,
     onAnswer(correct, btnEl), onFinish(passed, section) }

   followUp (optional, per question): {q,opts,a,why} — a second question
   testing the exact same concept. If the student gets the original wrong,
   this is inserted right after it (counts toward the section's score like
   any other question), so a miss can't just be clicked past without
   checking whether the idea actually landed.
   --------------------------------------------------------------- */
BTP.setupSectionQuiz = function(SECTIONS, opts){
  opts = opts || {};
  const chapterId = opts.chapterId || "chapter";
  const passPct = opts.passPct || 0.8;
  const xpPer = opts.xp || 10;

  const SCORE_KEY = "btp.sections.v1";
  function loadScores(){
    try{ return JSON.parse(localStorage.getItem(SCORE_KEY)) || {}; }catch(e){ return {}; }
  }
  function saveScores(s){ localStorage.setItem(SCORE_KEY, JSON.stringify(s)); }
  function scoreKey(secId){ return chapterId + "::" + secId; }
  function getBest(secId){ return loadScores()[scoreKey(secId)] || null; }
  function setBest(secId, pct, passed){
    const s = loadScores();
    const k = scoreKey(secId);
    const prev = s[k];
    s[k] = { pct: (prev && prev.pct > pct) ? prev.pct : pct, passed: passed || !!(prev && prev.passed) };
    saveScores(s);
  }

  let curSection = null, qi = 0, qRight = 0, curQs = [];

  function renderMenu(){
    const box = document.getElementById("secMenu");
    box.innerHTML = SECTIONS.map(sec=>{
      const best = getBest(sec.id);
      let statusHtml;
      if(!best) statusHtml = '<span style="color:var(--dim)">Not tried yet</span>';
      else if(best.passed) statusHtml = '<span style="color:var(--green);font-weight:700">&#10003; Mastered &middot; ' + Math.round(best.pct*100) + '%</span>';
      else statusHtml = '<span style="color:var(--amber);font-weight:700">Needs review &middot; best ' + Math.round(best.pct*100) + '%</span>';
      return '<div class="panel" style="margin-bottom:10px;padding:16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
          '<div><div style="font-weight:700;font-size:15px">' + sec.title + '</div>' +
          '<div style="font-size:12.5px;margin-top:4px">' + statusHtml + '</div></div>' +
          '<button class="btn sec-start-btn" data-sec="' + sec.id + '">' + (best ? "Try again" : "Start") + ' &rarr;</button>' +
        '</div></div>';
    }).join("");
    box.querySelectorAll(".sec-start-btn").forEach(b=>{
      b.onclick = ()=>startSection(b.dataset.sec);
    });
  }

  function startSection(secId){
    curSection = SECTIONS.find(s=>s.id===secId);
    curQs = BTP.shuffle(curSection.questions);
    qi = 0; qRight = 0;
    document.getElementById("secMenu").classList.add("hide");
    document.getElementById("secResult").classList.add("hide");
    document.getElementById("secQuizBox").classList.remove("hide");
    loadQ();
  }

  function loadQ(){
    const q = curQs[qi];
    document.getElementById("qsrc").textContent = curSection.title;
    document.getElementById("qq").textContent = q.q;
    document.getElementById("qm").textContent = q._isFollowUp
      ? "One more like that, to make sure it clicked"
      : "Question " + (qi+1) + " of " + curQs.length;
    document.getElementById("qbar").style.width = (qi/curQs.length*100) + "%";
    document.getElementById("qfb").className = "fb";
    document.getElementById("qnext").classList.add("hide");

    const rightAns = q.opts[q.a];
    const shuffledOpts = BTP.shuffle(q.opts);
    const aIdx = shuffledOpts.indexOf(rightAns);
    const box = document.getElementById("qopts");
    box.innerHTML = "";
    shuffledOpts.forEach((o,i)=>{
      const b = document.createElement("button");
      b.className = "opt"; b.textContent = o;
      b.onclick = ()=>answer(i, aIdx, q);
      box.appendChild(b);
    });
  }

  function answer(i, aIdx, q){
    const bs = [...document.getElementById("qopts").children];
    bs.forEach(b=>b.disabled=true);
    bs[aIdx].classList.add("right");
    const fb = document.getElementById("qfb");
    const correct = i === aIdx;
    if(correct){
      qRight++; BTP.addXP(xpPer); BTP.touchStreak();
      fb.className = "fb good show";
      fb.innerHTML = "<b>Correct.</b> " + q.why + " <span style='opacity:.75'>+" + xpPer + " XP</span>";
      BTP.toast("+" + xpPer + " XP");
      BTP.sound.right();
    } else {
      bs[i].classList.add("wrong");
      fb.className = "fb bad show";
      fb.innerHTML = "<b>Not quite.</b> " + q.why;
      BTP.sound.wrong();
      // Same-concept follow-up: rather than letting a miss just get
      // clicked past, queue one more question on the exact same idea
      // right after this one, so we actually check it landed.
      if(q.followUp && !q._isFollowUp){
        curQs.splice(qi+1, 0, Object.assign({}, q.followUp, { _isFollowUp:true }));
      }
    }
    document.getElementById("qnext").classList.remove("hide");
    if(opts.onAnswer) opts.onAnswer(correct, bs[i]);
  }

  document.getElementById("qnext").onclick = ()=>{
    qi++;
    if(qi >= curQs.length) finishSection();
    else loadQ();
  };

  function finishSection(){
    const pct = qRight / curQs.length;
    const passed = pct >= passPct;
    setBest(curSection.id, pct, passed);
    if(passed) BTP.sound.celebrate();

    document.getElementById("secQuizBox").classList.add("hide");
    const res = document.getElementById("secResult");
    res.classList.remove("hide");
    res.innerHTML =
      '<div style="font-size:44px">' + (passed ? "🏆" : "📖") + '</div>' +
      '<h2 style="margin:10px 0">' + (passed ? "Section mastered!" : "Not quite there yet") + '</h2>' +
      '<p class="lede">You got ' + qRight + ' out of ' + curQs.length + ' (' + Math.round(pct*100) + '%). ' +
      (passed
        ? "Nice work on <b>" + curSection.title + "</b> — 80% or higher counts as mastered."
        : "You need <b>80%</b> to master a section. Go back and review <b>" + curSection.title + "</b>, then try again.") +
      '</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">' +
        '<button class="btn" id="secRetry">Try again</button>' +
        '<button class="btn ghost" id="secToMenu">All sections</button>' +
      '</div>';
    document.getElementById("secRetry").onclick = ()=>startSection(curSection.id);
    document.getElementById("secToMenu").onclick = backToMenu;

    const allPassed = SECTIONS.every(s=>{ const b = getBest(s.id); return b && b.passed; });
    if(allPassed) BTP.markDone(chapterId);
    if(opts.onFinish) opts.onFinish(passed, curSection);
  }

  function backToMenu(){
    document.getElementById("secQuizBox").classList.add("hide");
    document.getElementById("secResult").classList.add("hide");
    document.getElementById("secMenu").classList.remove("hide");
    renderMenu();
  }
  document.getElementById("secBack").onclick = backToMenu;

  renderMenu();
  return { renderMenu, startSection };
};

/* ---------------------------------------------------------------
   4. NUMBER LINE WIDGET
   A zoomable / pannable number line on <canvas>. Same engine
   serves decimal chapters (zoom IN reveals tenths/hundredths),
   large-number chapters (zoom OUT reveals thousands/lakhs) and
   integer chapters (negative domain) — only `config` differs.

   Required markup:
     <div class="stage" id="STAGE_ID">
       <canvas id="CANVAS_ID"></canvas>
       <div class="zoombar"><button class="zb" id="ZIN_ID">+</button><button class="zb" id="ZOUT_ID">&minus;</button></div>
       <div class="hint" id="HINT_ID">drag to slide · scroll or pinch to zoom</div>
     </div>

   config = {
     stage, canvas, zin, zout, hint,   // element ids (zin/zout/hint optional)
     domainLo, domainHi,               // hard bounds, e.g. 0,10 or -20,20
     minSpan, maxSpan,                 // deepest / widest zoom (view window width)
     initialSpan,                      // optional starting span (default maxSpan)
     levels: [{step, h, col, lw}, ...] // coarsest first. h = tick height 0-1 of stage height
     fmtLabel(v, levelIndex) -> string // tick label text
     showCrosshair: true|false         // draw centre reading line (explore mode)
   }

   Returned API:
     nl.view / nl.goal        {lo,hi} — current & target window
     nl.x2v(x) / nl.v2x(v)    pixel <-> value conversion (uses view, i.e. this frame's window)
     nl.zoomAt(px, factor)    factor<1 zooms in, >1 zooms out, anchored at pixel px
     nl.panBy(dxPx)
     nl.resetView(lo, hi)
     nl.levelAlpha(step)      0..1 visibility of a tick level at current view
     nl.setMarker({v, state}) state: "right"|"wrong"|"idle"; nl.clearMarker()
     nl.setGhost({v})         dashed "true answer" marker; nl.clearGhost()
     nl.onFrame = fn          called once per animation frame, after draw (paint your readout here)
     nl.onTap = fn(v)         called on a genuine tap/click with the tapped value (set/unset per mode)
     nl.start()               call once after building — wires events + kicks the render loop
   --------------------------------------------------------------- */
BTP.NumberLine = function(config){
  const cfg = Object.assign({
    domainLo:0, domainHi:10, minSpan:0.02, maxSpan:10,
    levels:[{step:1,h:0.55,col:"#e8edff",lw:2}],
    fmtLabel: (v)=>String(v),
    showCrosshair:true
  }, config);

  const stageEl = document.getElementById(cfg.stage);
  const cv  = document.getElementById(cfg.canvas);
  const ctx = cv.getContext("2d");

  const initialSpan = cfg.initialSpan || cfg.maxSpan;
  const initialLo = Math.max(cfg.domainLo, Math.min(cfg.domainHi - initialSpan, (cfg.domainLo+cfg.domainHi-initialSpan)/2));
  let view = { lo:initialLo, hi:initialLo+initialSpan };
  let goal = { lo:initialLo, hi:initialLo+initialSpan };
  let W=0, H=0;
  let marker = null, ghost = null;

  const nl = {};
  nl.view = view; nl.goal = goal;
  nl.onFrame = null;
  nl.onTap = null;

  function resize(){
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width  = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener("resize", resize);

  const clamp = (n,a,b) => n < a ? a : n > b ? b : n;
  nl.x2v = x => view.lo + (x / W) * (view.hi - view.lo);
  nl.v2x = v => ((v - view.lo) / (view.hi - view.lo)) * W;

  nl.zoomAt = function(px, factor){
    const anchor = goal.lo + (px / W) * (goal.hi - goal.lo);
    let span = clamp((goal.hi - goal.lo) * factor, cfg.minSpan, cfg.maxSpan);
    const frac = px / W;
    let lo = anchor - frac * span;
    let hi = lo + span;
    if(lo < cfg.domainLo){ lo = cfg.domainLo; hi = lo + span; }
    if(hi > cfg.domainHi){ hi = cfg.domainHi; lo = hi - span; }
    goal.lo = lo; goal.hi = hi;
  };
  nl.panBy = function(dxPx){
    const span = goal.hi - goal.lo;
    let d = -(dxPx / W) * span;
    let lo = clamp(goal.lo + d, cfg.domainLo, cfg.domainHi - span);
    goal.lo = lo; goal.hi = lo + span;
  };
  nl.resetView = function(lo, hi){ goal.lo = lo; goal.hi = hi; };

  nl.levelAlpha = function(step){
    const px = (step / (view.hi - view.lo)) * W;
    return clamp((px - 5) / 16, 0, 1);
  };
  nl.setMarker = function(m){ marker = m; };
  nl.clearMarker = function(){ marker = null; };
  nl.setGhost = function(g){ ghost = g; };
  nl.clearGhost = function(){ ghost = null; };

  function round3(v){ return Math.round(v*1000)/1000; }

  function draw(){
    ctx.clearRect(0,0,W,H);
    const baseY = H * 0.62;

    ctx.strokeStyle = "#2a3763"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(W, baseY); ctx.stroke();

    for(let li = 0; li < cfg.levels.length; li++){
      const L = cfg.levels[li];
      const a = nl.levelAlpha(L.step);
      if(a <= 0.01) continue;

      const i0 = Math.ceil (view.lo / L.step - 1e-9);
      const i1 = Math.floor(view.hi / L.step + 1e-9);
      if(i1 - i0 > 4000) continue;

      ctx.globalAlpha = a;
      ctx.strokeStyle = L.col;
      ctx.lineWidth   = L.lw;
      ctx.fillStyle   = L.col;
      ctx.font        = (li===0 ? "700 " : "600 ") + (li===0?14:12) + "px Segoe UI, system-ui, sans-serif";
      ctx.textAlign   = "center";

      const tickH   = H * L.h;
      const labelPx = (L.step / (view.hi - view.lo)) * W;
      const parentStep = li>0 ? cfg.levels[li-1].step : null;

      for(let i = i0; i <= i1; i++){
        const v = round3(i * L.step);
        if(parentStep && Math.abs(Math.round(v/parentStep)*parentStep - v) < L.step*1e-6) continue;
        const x = nl.v2x(v);
        if(x < -40 || x > W + 40) continue;

        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, baseY - tickH);
        ctx.stroke();

        // Show the label whenever it actually fits in the space between ticks —
        // measured against the real (possibly multi-digit, comma-formatted) text,
        // rather than a flat pixel guess that only held up on wide desktop canvases.
        const label = cfg.fmtLabel(v, li);
        const textW = ctx.measureText(label).width;
        if(labelPx > textW + 10){
          // Only nudge labels sitting exactly on the domain's own start/end (e.g.
          // "1,00,000" at the far right) fully on-canvas — those can never be
          // scrolled to and would otherwise be permanently half-clipped by the
          // container. Mid-scroll ticks near the viewport edge are left alone so
          // they don't get shoved into their neighbour's label.
          const atDomainEdge = v <= cfg.domainLo + 1e-9 || v >= cfg.domainHi - 1e-9;
          const tx = atDomainEdge ? Math.min(W - textW/2 - 2, Math.max(textW/2 + 2, x)) : x;
          ctx.fillText(label, tx, baseY + 19);
        }
      }
      ctx.globalAlpha = 1;
    }

    if(ghost){
      const x = nl.v2x(ghost.v);
      if(x > -20 && x < W+20){
        ctx.globalAlpha = .85;
        ctx.setLineDash([4,4]);
        ctx.strokeStyle = "#3ddc84"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, baseY - H*0.5); ctx.lineTo(x, baseY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#3ddc84"; ctx.textAlign = "center";
        ctx.font = "700 12px Segoe UI, system-ui, sans-serif";
        ctx.fillText("here", x, baseY - H*0.5 - 6);
        ctx.globalAlpha = 1;
      }
    }

    if(marker){
      const x = nl.v2x(marker.v);
      const col = marker.state === "right" ? "#3ddc84"
                : marker.state === "wrong" ? "#ff6b81" : "#ffc857";
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY - H*0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, baseY - H*0.5, 6, 0, 7); ctx.fill();
    }

    if(cfg.showCrosshair){
      ctx.strokeStyle = "#ffffff55"; ctx.lineWidth = 1; ctx.setLineDash([3,4]);
      ctx.beginPath(); ctx.moveTo(W/2, 8); ctx.lineTo(W/2, baseY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(W/2, baseY, 4, 0, 7); ctx.fill();
    }
  }

  function tick(){
    const k = 0.18;
    view.lo += (goal.lo - view.lo) * k;
    view.hi += (goal.hi - view.hi) * k;
    if(Math.abs(goal.lo-view.lo) < 1e-7) view.lo = goal.lo;
    if(Math.abs(goal.hi-view.hi) < 1e-7) view.hi = goal.hi;
    draw();
    if(nl.onFrame) nl.onFrame();
    requestAnimationFrame(tick);
  }

  /* ---- pointer: drag to pan, wheel to zoom, pinch on touch ---- */
  let dragging=false, moved=0, lastX=0, pinch=null, tapOK=false;
  function dist(t){
    const dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY;
    return Math.hypot(dx,dy) || 1;
  }
  function fadeHint(){
    if(nl._hintGone || !cfg.hint) return;
    nl._hintGone = true;
    const h = document.getElementById(cfg.hint);
    if(!h) return;
    h.style.opacity = 0;
    setTimeout(()=>h.classList.add("hide"), 500);
  }

  function wireEvents(){
    stageEl.addEventListener("pointerdown", e=>{
      if(e.pointerType === "touch" && e.isPrimary === false) return;
      dragging=true; moved=0; lastX=e.clientX; tapOK=true;
      stageEl.classList.add("drag"); stageEl.setPointerCapture(e.pointerId);
    });
    stageEl.addEventListener("pointermove", e=>{
      if(!dragging || pinch) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX; moved += Math.abs(dx);
      nl.panBy(dx);
      fadeHint();
    });
    stageEl.addEventListener("pointerup", e=>{
      dragging=false; stageEl.classList.remove("drag");
      if(moved < 6 && tapOK && !pinch && nl.onTap){
        const r = cv.getBoundingClientRect();
        nl.onTap(nl.x2v(e.clientX - r.left));
      }
      tapOK = false;
    });
    stageEl.addEventListener("pointercancel", ()=>{ dragging=false; stageEl.classList.remove("drag"); });

    stageEl.addEventListener("wheel", e=>{
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      nl.zoomAt(e.clientX - r.left, e.deltaY > 0 ? 1.16 : 0.86);
      fadeHint();
    }, {passive:false});

    stageEl.addEventListener("touchstart", e=>{
      if(e.touches.length === 2){
        dragging = false; tapOK = false;
        pinch = dist(e.touches);
      }
    },{passive:true});
    stageEl.addEventListener("touchmove", e=>{
      if(e.touches.length === 2 && pinch){
        e.preventDefault();
        const d = dist(e.touches);
        const r = cv.getBoundingClientRect();
        const mid = (e.touches[0].clientX + e.touches[1].clientX)/2 - r.left;
        nl.zoomAt(mid, pinch / d);
        pinch = d; fadeHint();
      }
    },{passive:false});
    stageEl.addEventListener("touchend", ()=>{ pinch = null; });

    if(cfg.zin)  document.getElementById(cfg.zin).onclick  = ()=>{ nl.zoomAt(W/2, 0.6); fadeHint(); };
    if(cfg.zout) document.getElementById(cfg.zout).onclick = ()=>{ nl.zoomAt(W/2, 1/0.6); };
  }

  // Re-measure the canvas — call this whenever the stage becomes visible
  // after being hidden (e.g. switching into its tab from a tab without a
  // ruler), since a hidden canvas measures as 0-width and nothing else
  // re-triggers this automatically.
  nl.resize = resize;

  nl.start = function(){
    resize();
    wireEvents();
    requestAnimationFrame(tick);
  };

  return nl;
};

/* ---------------------------------------------------------------
   5. BALANCE WIDGET — a two-pan weighing scale for algebra
   chapters (letter-numbers, finding the unknown). Tilts toward
   the heavier side; visual only, chapter code owns the logic of
   what "solving" means.

   const bal = BTP.Balance("balanceStage");
   bal.render(leftItems, rightItems);
     items: [{label:"x", value:5, unit:false}, {label:"3", value:3, unit:true}, ...]
     (unit:true items are drawn in the cyan "known number" colour,
      unit:false/omitted are drawn violet as the unknown/variable)
   --------------------------------------------------------------- */
BTP.Balance = function(containerId){
  const root = document.getElementById(containerId);
  root.innerHTML =
    '<div class="balance-post"></div>' +
    '<div class="balance-beam" id="'+containerId+'-beam"></div>' +
    '<div class="balance-pans">' +
      '<div class="balance-pan" id="'+containerId+'-l"></div>' +
      '<div class="balance-pan" id="'+containerId+'-r"></div>' +
    '</div>';
  root.classList.add("balance-stage");
  const beam = document.getElementById(containerId+"-beam");
  const lPan = document.getElementById(containerId+"-l");
  const rPan = document.getElementById(containerId+"-r");

  function fill(pan, items){
    pan.innerHTML = "";
    (items||[]).forEach(it=>{
      const d = document.createElement("div");
      d.className = "balance-item" + (it.unit ? " unit" : "");
      d.textContent = it.label;
      pan.appendChild(d);
    });
  }

  return {
    render(leftItems, rightItems){
      fill(lPan, leftItems); fill(rPan, rightItems);
      const lSum = (leftItems||[]).reduce((s,i)=>s+(+i.value||0),0);
      const rSum = (rightItems||[]).reduce((s,i)=>s+(+i.value||0),0);
      const diff = Math.max(-12, Math.min(12, lSum - rSum));
      const angle = diff * 1.4; // degrees, left heavier -> tips left down (negative)
      beam.style.transform = "rotate(" + (-angle) + "deg)";
      lPan.style.transform = "translateY(" + (angle*1.6) + "px)";
      rPan.style.transform = "translateY(" + (-angle*1.6) + "px)";
      return { lSum, rSum, balanced: lSum === rSum };
    }
  };
};

/* ---------------------------------------------------------------
   6. GRID WIDGET — rows x cols of cells for fraction bars,
   area models (distributive property), and factor/HCF-LCM grids.

   const g = BTP.Grid("gridStage", 4, 10);   // 4 rows, 10 cols
   g.cells[r][c] is the <div class="grid-cell"> — toggle classes
   yourself: g.cells[1][3].classList.add("on")
   g.fillCount(n, "on")   -- shades the first n cells (row-major)
   g.clear()
   --------------------------------------------------------------- */
BTP.Grid = function(containerId, rows, cols){
  const root = document.getElementById(containerId);
  root.classList.add("grid-stage");
  root.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
  root.innerHTML = "";
  const cells = [];
  for(let r=0;r<rows;r++){
    const rowArr = [];
    for(let c=0;c<cols;c++){
      const d = document.createElement("div");
      d.className = "grid-cell";
      d.dataset.r = r; d.dataset.c = c;
      root.appendChild(d);
      rowArr.push(d);
    }
    cells.push(rowArr);
  }
  return {
    el: root, cells, rows, cols,
    clear(){ cells.flat().forEach(c=>{ c.className = "grid-cell"; }); },
    fillCount(n, cls){
      cls = cls || "on";
      this.clear();
      const flat = cells.flat();
      for(let i=0;i<n && i<flat.length;i++) flat[i].classList.add(cls);
    }
  };
};

/* ---------------------------------------------------------------
   7. SVG / DRAG HELPERS — building blocks for geometry chapters
   (parallel lines, triangles, congruence, tilings). Not a
   monolithic widget: build the <svg> yourself inside a .stage div,
   use these to create elements and make points draggable.
   --------------------------------------------------------------- */
const SVGNS = "http://www.w3.org/2000/svg";
BTP.svgEl = function(tag, attrs){
  const el = document.createElementNS(SVGNS, tag);
  for(const k in (attrs||{})) el.setAttribute(k, attrs[k]);
  return el;
};
BTP.dist = function(x1,y1,x2,y2){ return Math.hypot(x2-x1, y2-y1); };
BTP.angleDeg = function(cx,cy,x,y){ return Math.atan2(y-cy, x-cx) * 180/Math.PI; };

// makes an existing SVG element (e.g. a <circle class="pt">) draggable;
// onDrag(x,y) fires with coordinates in the SVG's own viewBox units.
BTP.dragPoint = function(svg, el, onDrag){
  el.classList.add("pt");
  function toSvgPoint(clientX, clientY){
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = svg.getScreenCTM().inverse();
    const p = pt.matrixTransform(m);
    return { x:p.x, y:p.y };
  }
  el.addEventListener("pointerdown", e=>{
    el.setPointerCapture(e.pointerId);
    function move(ev){
      const p = toSvgPoint(ev.clientX, ev.clientY);
      onDrag(p.x, p.y);
    }
    function up(){
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
};

/* ---------------------------------------------------------------
   8. MASCOT — an original character (not a licensed one) that can
   sit next to a lesson and react to right/wrong answers. Each
   chapter can pass its own colours AND an earStyle to give it a
   distinct look — these are original designs only *inspired* by a
   general kawaii / anime aesthetic, not reproductions of any
   licensed character (nothing from Sanrio, Naruto, or anywhere
   else is copied — only the vibe).

   Two ways to style it:

     // 1. a named theme from BTP.MascotThemes (recommended)
     const dot = BTP.Mascot("mascotBox", "aqua");
     // theme name + a per-chapter override:
     BTP.Mascot("box", { theme:"kawaii", accent:"#ff2d78" });

     // 2. a raw palette object (still supported, back-compatible)
     BTP.Mascot("box", { color:"#3ddbd9", accent:"#ffc857" });

   dot.say("Let's zoom in!", 2500)   // speech bubble, auto-hides after ms (omit ms to stick)
   dot.hideBubble()
   dot.react("happy" | "sad" | "idle")   // brief animated reaction + expression change

   opts.earStyle:
     "dot"  (default) — two small round ear/blush dots
     "hood" — a moody little hood with two dark points framing the face
              (opts.accent2 = hood colour, opts.accent = small tip glints)
     "bow"  — two small triangular ears plus a side bow
              (opts.accent = bow/ear-outline colour)
     "band" — a ninja-inspired forehead band + two pointed animal ears
              (opts.accent2 = band colour, opts.accent = ears/plate colour).
              The band plate is deliberately blank — no village crest — so
              it stays an original design, not a copy of any franchise.
     "spark" — an electric-creature look: jagged lightning ears + two
              round cheek sparks (opts.accent = ears/cheeks, opts.accent2
              = dark ear tips).
     "hat"  — a straw-hat sailor look sitting on top of the head
              (opts.accent2 = brim/straw colour, opts.accent = hat band).
   --------------------------------------------------------------- */

/* Named mascot themes — palette + ear-style presets. Every one is an
   ORIGINAL character merely *inspired by* a popular art style; none copy
   or reproduce a licensed character, name, or crest. Add your own with
   BTP.MascotThemes.myTheme = { color, accent, accent2, earStyle, name }.
   `name` is just a suggested default character name a chapter may use. */
BTP.MascotThemes = {
  // --- four franchise-INSPIRED originals (aesthetic only, not the IP) ---
  // Sanrio-inspired: soft pastel cutie with a side bow (original "Suzu")
  kawaii: { color:"#fff3f6", accent:"#ff6b81", accent2:"#cc2233", earStyle:"bow",  name:"Suzu" },
  // Naruto-inspired: warm ninja with a blank forehead band (original "Kata")
  ninja:  { color:"#ffb066", accent:"#e8542f", accent2:"#20304f", earStyle:"band", name:"Kata" },
  // Pokemon-inspired: electric creature, lightning ears + cheek sparks (original "Voltling")
  spark:  { color:"#ffdd55", accent:"#e8542f", accent2:"#5a3a00", earStyle:"spark", name:"Voltling" },
  // One Piece-inspired: sunny straw-hat sailor (original "Captain Pip")
  pirate: { color:"#ffd36b", accent:"#c8102e", accent2:"#b07a2a", earStyle:"hat",  name:"Pip" },

  // --- the originals already used by chapters 3/4/5 + spare palettes ---
  // classic bright cyan explorer (Chapter 3's "Dot")
  aqua:   { color:"#3ddbd9", accent:"#ffc857", accent2:"#0e2a2c", earStyle:"dot",  name:"Dot" },
  // moody violet hood (Chapter 4's "Nyx")
  shadow: { color:"#8b7bff", accent:"#ff6bd6", accent2:"#241531", earStyle:"hood", name:"Nyx" },
  // calm ocean blue, plain ears
  ocean:  { color:"#5aa9ff", accent:"#3ddbd9", accent2:"#10233f", earStyle:"dot",  name:"Nilo" },
  // fresh green sprout, plain ears
  mint:   { color:"#3ddc84", accent:"#ffc857", accent2:"#0e2a1c", earStyle:"dot",  name:"Sprout" },
  // berry pink hood
  berry:  { color:"#ff8fc7", accent:"#ffe36b", accent2:"#3a0f2a", earStyle:"hood", name:"Momo" },
  // Kuromi-INSPIRED original: white face, near-black pointed jester hood,
  // pink lining + a cheeky look. No skull emblem, no name, no exact
  // palette copied — an original mischievous imp, not the character.
  imp:    { color:"#f4f0ff", accent:"#ff7ac2", accent2:"#191024", earStyle:"hood", name:"Riko" },
  // Totoro-INSPIRED original: soft grey forest spirit, tall pointed ears,
  // leafy-cream cheeks + whiskers. No belly chevrons, no umbrella, no
  // name copied — an original woodland critter, not the character.
  forest: { color:"#9aa7a0", accent:"#d6ecc4", accent2:"#333f36", earStyle:"forest", name:"Grove" },
  // plain grey pup (Chapter 8's original "Pochi")
  stone:  { color:"#b8c0cc", accent:"#8b95a3", accent2:"#2a3340", earStyle:"dot",  name:"Pochi" },
  // warm tomato-and-cheese pizza pal (Chapter 8's "Pepper")
  candy:  { color:"#ff9a4d", accent:"#ff5a5f", accent2:"#3a1e10", earStyle:"dot",  name:"Pepper" }
};

BTP.Mascot = function(containerId, opts){
  // Accept a theme name string, or an object that may carry a `theme`
  // key plus per-chapter overrides. Precedence: defaults < theme < opts.
  if(typeof opts === "string") opts = { theme: opts };
  opts = opts || {};
  const theme = (opts.theme && BTP.MascotThemes[opts.theme]) || null;
  opts = Object.assign(
    { color:"#3ddbd9", accent:"#ffc857", accent2:"#2a1b40", earStyle:"dot" },
    theme || {},
    opts
  );
  const root = document.getElementById(containerId);
  const uid = containerId;

  let earsSvg;
  if(opts.earStyle === "hood"){
    earsSvg =
      '<path d="M 12 42 Q 6 8 38 18 Q 30 32 20 44 Z" fill="'+opts.accent2+'"/>' +
      '<path d="M 108 42 Q 114 8 82 18 Q 90 32 100 44 Z" fill="'+opts.accent2+'"/>' +
      '<circle cx="22" cy="24" r="3" fill="'+opts.accent+'"/>' +
      '<circle cx="98" cy="24" r="3" fill="'+opts.accent+'"/>';
  } else if(opts.earStyle === "band"){
    earsSvg =
      '<path d="M 22 34 L 34 6 L 46 32 Z" fill="'+opts.color+'" stroke="'+opts.accent+'" stroke-width="2.5"/>' +
      '<path d="M 98 34 L 86 6 L 74 32 Z" fill="'+opts.color+'" stroke="'+opts.accent+'" stroke-width="2.5"/>' +
      '<path d="M 15 52 Q 60 43 105 52 L 105 61 Q 60 52 15 61 Z" fill="'+opts.accent2+'"/>' +
      '<rect x="50" y="46" width="20" height="12" rx="2.5" fill="'+opts.accent+'"/>' +
      '<path d="M 105 56 L 116 64 M 105 60 L 115 70" stroke="'+opts.accent2+'" stroke-width="2.5" stroke-linecap="round"/>';
  } else if(opts.earStyle === "spark"){
    earsSvg =
      '<path d="M 20 40 L 30 5 L 41 30 L 33 40 Z" fill="'+opts.color+'" stroke="'+opts.accent+'" stroke-width="2.5"/>' +
      '<path d="M 100 40 L 90 5 L 79 30 L 87 40 Z" fill="'+opts.color+'" stroke="'+opts.accent+'" stroke-width="2.5"/>' +
      '<path d="M 30 5 L 41 30 L 34 21 Z" fill="'+opts.accent2+'"/>' +
      '<path d="M 90 5 L 79 30 L 86 21 Z" fill="'+opts.accent2+'"/>' +
      '<circle cx="30" cy="82" r="6" fill="'+opts.accent+'"/>' +
      '<circle cx="90" cy="82" r="6" fill="'+opts.accent+'"/>';
  } else if(opts.earStyle === "hat"){
    earsSvg =
      '<path d="M 10 40 Q 60 24 110 40 Q 60 54 10 40 Z" fill="'+opts.accent2+'"/>' +
      '<path d="M 34 41 Q 40 12 60 11 Q 80 12 86 41 Z" fill="'+opts.color+'" stroke="'+opts.accent2+'" stroke-width="2"/>' +
      '<path d="M 33 33 Q 60 28 87 33" stroke="'+opts.accent+'" stroke-width="4" fill="none"/>';
  } else if(opts.earStyle === "bow"){
    earsSvg =
      '<path d="M 18 32 L 33 8 L 41 34 Z" fill="'+opts.color+'" stroke="'+opts.accent+'" stroke-width="2.5"/>' +
      '<path d="M 102 32 L 87 8 L 79 34 Z" fill="'+opts.color+'" stroke="'+opts.accent+'" stroke-width="2.5"/>' +
      '<path d="M 84 20 L 98 10 L 98 28 Z" fill="'+opts.accent+'"/>' +
      '<path d="M 112 20 L 98 10 L 98 28 Z" fill="'+opts.accent+'"/>' +
      '<circle cx="98" cy="19" r="4.5" fill="'+opts.accent2+'"/>';
  } else if(opts.earStyle === "forest"){
    earsSvg =
      '<path d="M 26 40 L 34 4 L 48 38 Z" fill="'+opts.color+'" stroke="'+opts.accent2+'" stroke-width="2"/>' +
      '<path d="M 94 40 L 86 4 L 72 38 Z" fill="'+opts.color+'" stroke="'+opts.accent2+'" stroke-width="2"/>' +
      '<path d="M 6 74 L 26 77 M 6 84 L 26 84" stroke="'+opts.accent2+'" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M 114 74 L 94 77 M 114 84 L 94 84" stroke="'+opts.accent2+'" stroke-width="2" stroke-linecap="round"/>';
  } else {
    earsSvg =
      '<circle cx="30" cy="36" r="8" fill="'+opts.accent+'"/>' +
      '<circle cx="90" cy="36" r="8" fill="'+opts.accent+'"/>';
  }

  root.innerHTML =
    '<div class="mascot-wrap">' +
      '<svg class="mascot" id="'+uid+'-svg" viewBox="0 0 120 120">' +
        '<defs><radialGradient id="'+uid+'-grad" cx="35%" cy="30%" r="75%">' +
          '<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="'+opts.color+'"/>' +
        '</radialGradient></defs>' +
        earsSvg +
        '<ellipse cx="60" cy="70" rx="44" ry="40" fill="url(#'+uid+'-grad)" stroke="'+opts.color+'" stroke-width="3"/>' +
        '<circle cx="34" cy="80" r="7" fill="'+opts.accent+'" opacity=".55"/>' +
        '<circle cx="86" cy="80" r="7" fill="'+opts.accent+'" opacity=".55"/>' +
        '<ellipse class="m-eye" cx="45" cy="66" rx="5" ry="7" fill="#1b2440"/>' +
        '<ellipse class="m-eye" cx="75" cy="66" rx="5" ry="7" fill="#1b2440"/>' +
        '<path class="m-mouth" d="M 48 84 Q 60 92 72 84" stroke="#1b2440" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '</svg>' +
      '<div class="mascot-bubble hide" id="'+uid+'-bubble"></div>' +
    '</div>';
  const svg = document.getElementById(uid+"-svg");
  const mouth = svg.querySelector(".m-mouth");
  const bubble = document.getElementById(uid+"-bubble");
  const MOUTHS = {
    idle:  "M 48 84 Q 60 92 72 84",
    happy: "M 44 82 Q 60 100 76 82",
    sad:   "M 46 90 Q 60 78 74 90",
    think: "M 50 86 Q 60 86 70 86"
  };
  let bubbleTimer = null;
  return {
    say(text, ms){
      bubble.textContent = text;
      bubble.classList.remove("hide");
      clearTimeout(bubbleTimer);
      if(ms) bubbleTimer = setTimeout(()=>bubble.classList.add("hide"), ms);
    },
    hideBubble(){ bubble.classList.add("hide"); },
    react(state){
      mouth.setAttribute("d", MOUTHS[state] || MOUTHS.idle);
      svg.classList.remove("happy","sad");
      if(state === "happy" || state === "sad"){
        void svg.offsetWidth; // restart the animation even if the same state fires twice
        svg.classList.add(state);
        setTimeout(()=>{ svg.classList.remove(state); mouth.setAttribute("d", MOUTHS.idle); }, 650);
      }
    }
  };
};

/* ---------------------------------------------------------------
   9. FEEDBACK ANIMATIONS — a burst of confetti for a correct
   answer, a shake for a wrong one. Generic, reusable anywhere.

   BTP.confetti(x, y)     // page coordinates, e.g. from el.getBoundingClientRect()
   BTP.shakeEl(el)        // briefly shakes a DOM element
   --------------------------------------------------------------- */
BTP.confetti = function(x, y, count){
  count = count || 18;
  const colors = ["#3ddbd9","#8b7bff","#ffc857","#3ddc84","#ff6b81"];
  for(let i=0;i<count;i++){
    const d = document.createElement("div");
    d.className = "confetti-piece";
    const dx = (Math.random()*2-1)*80;
    const dy = 70 + Math.random()*80;
    const rot = (Math.random()*2-1)*420;
    d.style.left = x+"px"; d.style.top = y+"px";
    d.style.background = colors[i%colors.length];
    d.style.setProperty("--dx", dx+"px");
    d.style.setProperty("--dy", dy+"px");
    d.style.setProperty("--rot", rot+"deg");
    d.style.animationDelay = (Math.random()*80)+"ms";
    document.body.appendChild(d);
    setTimeout(()=>d.remove(), 1100);
  }
};
BTP.shakeEl = function(el){
  el.classList.remove("shake-el");
  void el.offsetWidth;
  el.classList.add("shake-el");
  setTimeout(()=>el.classList.remove("shake-el"), 550);
};

/* ---------------------------------------------------------------
   10. SOUND — small, original chimes synthesized with the Web Audio
   API (no sampled/licensed audio — nothing from Sanrio or anywhere
   else is embedded). A soft "blip" on any button press, a bright
   ascending arpeggio for correct answers, a gentle two-note dip
   (never a harsh buzzer) for wrong ones, and a small fanfare for
   mastering a section. Muted state persists via localStorage, and a
   speaker toggle auto-mounts into any page's header ".stats" row —
   no per-page markup needed.

   BTP.sound.click() / .right() / .wrong() / .celebrate()
   BTP.sound.isMuted() / .setMuted(bool)
   --------------------------------------------------------------- */
(function(){
  let actx = null;
  function ctx(){
    if(!actx){
      const C = window.AudioContext || window.webkitAudioContext;
      if(!C) return null;
      actx = new C();
    }
    if(actx.state === "suspended") actx.resume();
    return actx;
  }
  let muted = localStorage.getItem("btp.muted") === "1";

  function tone(freq, t0, dur, opts){
    const c = ctx(); if(!c) return;
    opts = opts || {};
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.value = freq;
    const vol = opts.vol != null ? opts.vol : 0.12;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  BTP.sound = {
    click(){
      if(muted) return;
      const c = ctx(); if(!c) return;
      tone(1046.5, c.currentTime, 0.05, { type:"sine", vol:0.055 });
    },
    right(){
      if(muted) return;
      const c = ctx(); if(!c) return;
      const t = c.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f,i)=> tone(f, t + i*0.085, 0.22, { type:"triangle", vol:0.13 }));
    },
    wrong(){
      if(muted) return;
      const c = ctx(); if(!c) return;
      const t = c.currentTime;
      tone(392.00, t,        0.16, { type:"sine", vol:0.09 });
      tone(311.13, t + 0.11, 0.24, { type:"sine", vol:0.09 });
    },
    celebrate(){
      if(muted) return;
      const c = ctx(); if(!c) return;
      const t = c.currentTime;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f,i)=> tone(f, t + i*0.095, 0.3, { type:"triangle", vol:0.14 }));
    },
    isMuted(){ return muted; },
    setMuted(m){
      muted = m;
      localStorage.setItem("btp.muted", m ? "1" : "0");
      const btn = document.getElementById("btp-mute-btn");
      if(btn) btn.textContent = m ? "🔇" : "🔊";
    }
  };

  // a soft click on literally any button, on any page — wired once
  // here instead of per-chapter
  document.addEventListener("click", e=>{
    if(e.target.closest("button")) BTP.sound.click();
  }, true);

  // auto-mount a mute toggle into the header's .stats row
  function mountToggle(){
    const stats = document.querySelector(".stats");
    if(!stats || document.getElementById("btp-mute-btn")) return;
    const b = document.createElement("button");
    b.id = "btp-mute-btn";
    b.className = "chip sound-toggle";
    b.textContent = muted ? "🔇" : "🔊";
    b.onclick = (e)=>{ e.stopPropagation(); BTP.sound.setMuted(!BTP.sound.isMuted()); };
    stats.insertBefore(b, stats.firstChild);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountToggle);
  else mountToggle();
})();

/* ---------------------------------------------------------------
   11. COLOUR MODE — a light / dark toggle. The chosen mode persists
   via localStorage and a sun/moon chip auto-mounts into the header's
   ".stats" row next to the sound toggle.
   --------------------------------------------------------------- */
BTP.mode = (function(){
  const KEY = "btp.mode";
  let mode = (function(){
    try{ return localStorage.getItem(KEY) || "dark"; }catch(e){ return "dark"; }
  })();

  function apply(){
    document.documentElement.dataset.mode = mode;
    const b = document.getElementById("btp-mode-btn");
    // Show the mode you'd switch TO.
    if(b) b.textContent = mode === "light" ? "🌙" : "☀️";
  }
  function set(m){
    mode = m;
    try{ localStorage.setItem(KEY, m); }catch(e){}
    apply();
  }
  function toggle(){ set(mode === "light" ? "dark" : "light"); }

  function mount(){
    const stats = document.querySelector(".stats");
    if(!stats || document.getElementById("btp-mode-btn")) return;
    const b = document.createElement("button");
    b.id = "btp-mode-btn";
    b.className = "chip sound-toggle";
    b.title = "Switch light / dark";
    b.textContent = mode === "light" ? "🌙" : "☀️";
    b.onclick = (e)=>{ e.stopPropagation(); toggle(); };
    stats.insertBefore(b, stats.firstChild);
  }

  apply();
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  return { set, toggle, get:()=>mode };
})();
