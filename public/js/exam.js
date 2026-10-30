import { api, $, $$, esc, rich, renderMath, createTutor } from "./common.js";

const testId = new URLSearchParams(location.search).get("id");
const KEY = `sat_exam_${testId}`;
const app = $("#app");
let test;
let S; // trạng thái làm bài, lưu vào localStorage để tải lại trang không mất
let tutor = null;
let qStart = Date.now();
let navOpen = false;
let timeHidden = false;

const LETTERS = ["A", "B", "C", "D"];

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {}
}
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

const mod = () => test.modules[S.mod];
const question = () => mod().questions[S.idx];

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function trackTime() {
  if (S.phase === "question" && question()) {
    const id = question().id;
    S.timeSpent[id] = (S.timeSpent[id] || 0) + (Date.now() - qStart) / 1000;
  }
  qStart = Date.now();
}

// ---------------- Đồng hồ ----------------
setInterval(() => {
  if (!S) return;
  if (S.phase === "question" || S.phase === "review") {
    if (test.timed) {
      S.remaining--;
      if (S.remaining <= 0) {
        S.remaining = 0;
        endModule(true);
        return;
      }
    } else S.elapsed = (S.elapsed || 0) + 1;
    const t = $(".bb-timer .time");
    if (t) {
      t.textContent = test.timed ? fmt(S.remaining) : fmt(S.elapsed);
      t.classList.toggle("warn", test.timed && S.remaining <= 300);
    }
    if (test.timed && S.remaining === 300) toast("Còn 5 phút cho module này.");
    if (S.remaining % 5 === 0) save();
  } else if (S.phase === "break") {
    S.breakRemaining--;
    const t = $(".break-timer");
    if (t) t.textContent = fmt(S.breakRemaining);
    if (S.breakRemaining <= 0) startModule(S.mod + 1);
    save();
  }
}, 1000);

function toast(text) {
  const d = document.createElement("div");
  d.textContent = text;
  d.style.cssText = "position:fixed;top:80px;left:50%;transform:translateX(-50%);background:#1e1e1e;color:#fff;padding:10px 18px;border-radius:8px;z-index:200;font-weight:600";
  document.body.append(d);
  setTimeout(() => d.remove(), 3500);
}

// ---------------- Chuyển màn ----------------
function startModule(i) {
  trackTime();
  S.mod = i;
  S.idx = 0;
  S.remaining = test.modules[i].seconds;
  S.elapsed = 0;
  S.phase = "question";
  save();
  render();
  if (test.modules[i].module === 1) showDirections();
}

function endModule(timeUp = false) {
  trackTime();
  closeFloating();
  const next = test.modules[S.mod + 1];
  if (!next) return submit(timeUp);
  if (next.section !== mod().section) {
    S.phase = "break";
    S.breakRemaining = test.breakSeconds;
  } else {
    S.phase = "transition";
  }
  S.timeUpNotice = timeUp;
  save();
  render();
}

async function submit(timeUp) {
  S.phase = "submitting";
  save();
  app.innerHTML = `<div class="screen dark"><h1>${timeUp ? "Hết giờ! " : ""}Đang nộp bài…</h1><p class="lead">Đang chấm điểm, vui lòng chờ.</p></div>`;
  const answers = {};
  for (const [k, v] of Object.entries(S.answers)) if (v !== "" && v != null) answers[k] = v;
  try {
    const { id } = await api(`/api/tests/${testId}/submit`, {
      method: "POST",
      body: { answers, marked: Object.keys(S.marked).filter((k) => S.marked[k]), timeSpent: S.timeSpent },
    });
    localStorage.removeItem(KEY);
    location.href = `/result.html?id=${id}`;
  } catch (err) {
    app.innerHTML = `<div class="screen"><h1>Không nộp được bài</h1><p class="lead">${esc(err.message)}</p><button class="bb-btn" id="retry">Thử lại</button></div>`;
    $("#retry").onclick = () => submit(false);
  }
}

// ---------------- Render chính ----------------
function render() {
  closeHlPop();
  if (S.phase === "intro") return renderIntro();
  if (S.phase === "break") return renderBreak();
  if (S.phase === "transition") return renderTransition();
  if (S.phase === "submitting") return submit(false);
  renderExam();
}

function renderIntro() {
  const secs = [...new Set(test.modules.map((m) => m.section))];
  app.innerHTML = `<div class="screen">
    <h1>Practice Test</h1>
    <p class="lead">Đề gồm ${test.modules.length} module (${secs.map((s) => (s === "rw" ? "Reading and Writing" : "Math")).join(" + ")}). Module 2 của mỗi phần là <b>module khó</b>.
    ${test.timed ? "Thời gian được tính như thi thật; hết giờ sẽ tự chuyển module." : "Chế độ không giới hạn thời gian."}
    ${test.aiHelp ? "<br>Chế độ luyện tập: có thể hỏi AI gợi ý trong lúc làm." : "<br>Chế độ thi thật: AI bị khoá đến khi nộp bài."}</p>
    ${test.warnings?.length ? `<div class="warnings">${test.warnings.map((w) => `<div>⚠️ ${esc(w)}</div>`).join("")}</div>` : ""}
    <div class="panel">
      <table class="list"><thead><tr><th>Module</th><th>Số câu</th><th>Thời gian</th></tr></thead><tbody>
      ${test.modules.map((m) => `<tr><td>${esc(m.title)}${m.hard ? ' <span class="tag hard">khó</span>' : ""}</td><td>${m.questions.length}</td><td>${test.timed ? Math.round(m.seconds / 60) + " phút" : "—"}</td></tr>`).join("")}
      </tbody></table>
      <div class="field" style="margin-top:16px"><label>Tên hiển thị</label><input class="input" id="nameInput" value="${esc(localStorage.getItem("sat_name") || "")}" placeholder="Tên của bạn" /></div>
      <div class="row" style="justify-content:space-between;margin-top:10px"><a href="/" class="btn">← Về trang chủ</a><button class="bb-btn" id="go">Bắt đầu</button></div>
    </div></div>`;
  $("#go").onclick = () => {
    S.name = $("#nameInput").value.trim() || "Student";
    localStorage.setItem("sat_name", S.name);
    startModule(0);
  };
}

function renderBreak() {
  app.innerHTML = `<div class="screen dark">
    ${S.timeUpNotice ? `<p class="lead">Hết giờ module trước — bài đã được lưu.</p>` : ""}
    <p class="lead" style="margin-bottom:0">Remaining Break Time:</p>
    <div class="break-timer">${fmt(S.breakRemaining)}</div>
    <button class="bb-btn outline" id="resume">Resume Testing</button>
    <div style="max-width:560px;margin-top:30px">
      <h2>Practice Test Break</h2>
      <p class="lead" style="text-align:left">Bạn đã xong phần Reading and Writing. Nghỉ ${Math.round(test.breakSeconds / 60)} phút, phần Math sẽ tự bắt đầu khi hết giờ nghỉ. Đừng đóng trang này.</p>
    </div></div>`;
  $("#resume").onclick = () => startModule(S.mod + 1);
}

function renderTransition() {
  const next = test.modules[S.mod + 1];
  app.innerHTML = `<div class="screen dark">
    ${S.timeUpNotice ? `<h1>Hết giờ</h1>` : `<h1>Hoàn thành Module ${mod().module}</h1>`}
    <p class="lead">Câu trả lời đã được lưu. Tiếp theo: <b>${esc(next.title)}</b> — đây là module <b>khó</b>, gồm ${next.questions.length} câu. Bạn không thể quay lại module trước.</p>
    <button class="bb-btn outline" id="next">Tiếp tục</button></div>`;
  $("#next").onclick = () => startModule(S.mod + 1);
}

function header() {
  const m = mod();
  const isMath = m.section === "math";
  return `<header class="bb-head">
    <div><div class="bb-title">${esc(m.title)}</div>
      <button class="bb-directions" data-act="directions">Directions <span>⌄</span></button></div>
    <div class="bb-timer">
      <div class="time ${timeHidden ? "hidden" : ""} ${test.timed && S.remaining <= 300 ? "warn" : ""}">${test.timed ? fmt(S.remaining) : fmt(S.elapsed || 0)}</div>
      <div class="${timeHidden ? "" : "hidden"}" style="font-size:20px">⏱</div>
      <button data-act="hidetime">${timeHidden ? "Show" : "Hide"}</button>
    </div>
    <div class="bb-tools">
      ${isMath ? `<button class="bb-tool" data-act="calc"><span class="ico">🖩</span><span class="lbl">Calculator</span></button>
      <button class="bb-tool" data-act="ref"><span class="ico">𝑥²</span><span class="lbl">Reference</span></button>` : ""}
      <button class="bb-tool" data-act="hlhelp"><span class="ico">🖍</span><span class="lbl">Highlights & Notes</span></button>
      <button class="bb-tool" data-act="more"><span class="ico">⋮</span><span class="lbl">More</span></button>
    </div></header>`;
}

function footer() {
  const m = mod();
  const onReview = S.phase === "review";
  return `<footer class="bb-foot">
    <div class="bb-name">${esc(S.name || "Student")}</div>
    <div>${onReview ? "" : `<button class="nav-toggle ${navOpen ? "open" : ""}" data-act="nav">Question ${S.idx + 1} of ${m.questions.length} <span class="caret">⌃</span></button>`}</div>
    <div class="bb-nav-btns">
      ${onReview || S.idx > 0 ? `<button class="bb-btn" data-act="back">Back</button>` : ""}
      <button class="bb-btn" data-act="next">${onReview ? (test.modules[S.mod + 1] ? "Next" : "Submit") : "Next"}</button>
    </div></footer>`;
}

function gridCells(currentIdx) {
  return mod()
    .questions.map((q, i) => {
      const cls = ["qcell"];
      if (S.answers[q.id]) cls.push("answered");
      if (S.marked[q.id]) cls.push("marked");
      if (i === currentIdx) cls.push("current");
      return `<button class="${cls.join(" ")}" data-goto="${i}">${i + 1}</button>`;
    })
    .join("");
}

function navPopup() {
  if (!navOpen || S.phase !== "question") return "";
  return `<div class="navpop">
    <h3>${esc(mod().title)} Questions</h3>
    <div class="legend"><span>📍 Current</span><span><i class="box"></i> Unanswered</span><span>🔖 For Review</span></div>
    <div class="qgrid">${gridCells(S.idx)}</div>
    <button class="bb-btn outline go-review" data-act="review">Go to Review Page</button></div>`;
}

const SPR_DIRECTIONS = `<div class="spr-dir"><h3 style="margin-top:0">Student-produced response directions</h3>
<ul>
<li>If you find <b>more than one correct answer</b>, enter only one answer.</li>
<li>You can enter up to 5 characters for a <b>positive</b> answer and up to 6 characters (including the negative sign) for a <b>negative</b> answer.</li>
<li>If your answer is a <b>fraction</b> that doesn't fit in the provided space, enter the decimal equivalent.</li>
<li>If your answer is a <b>decimal</b> that doesn't fit in the provided space, enter it by truncating or rounding at the fourth digit.</li>
<li>If your answer is a <b>mixed number</b> (such as 3½), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).</li>
<li>Don't enter <b>symbols</b> such as a percent sign, comma, or dollar sign.</li>
</ul>
<table><tr><th>Answer</th><th>Acceptable ways to enter</th><th>Unacceptable</th></tr>
<tr><td>3.5</td><td>3.5 · 3.50 · 7/2</td><td>31/2 · 3 1/2</td></tr>
<tr><td>2/3</td><td>2/3 · .6666 · .6667 · 0.666 · 0.667</td><td>0.66 · .66 · 0.67 · .67</td></tr>
<tr><td>−1/3</td><td>−1/3 · −.3333 · −0.333</td><td>−.33 · −0.33</td></tr></table></div>`;

// Hình của câu hỏi: ưu tiên ảnh thật; chưa có ảnh thì hiện phần mô tả hình bằng chữ.
function figureHtml(q) {
  if (q.image) return `<div class="figure-box figure-img"><img src="${esc(q.image)}" alt="Figure" /></div>`;
  if (q.figure) return `<div class="figure-box"><b>Figure:</b> ${rich(q.figure)}</div>`;
  return "";
}

function questionPanel(q) {
  const crossed = S.crossed[q.id] || [];
  const elim = S.elimOn;
  const selected = S.answers[q.id];
  let body;
  if (q.type === "spr") {
    body = `<div class="field"><input class="spr-input" id="sprInput" maxlength="6" autocomplete="off" value="${esc(selected || "")}" /></div>
      <div class="spr-preview">Answer Preview: <b id="sprPreview"></b></div>`;
  } else {
    body = `<div class="choices">${q.choices
      .map((c, i) => {
        const L = LETTERS[i];
        const isX = crossed.includes(L);
        return `<div class="choice-row">
          <button class="choice ${selected === L ? "selected" : ""} ${isX ? "crossed" : ""}" data-choice="${L}">
            <span class="letter">${L}</span><span class="choice-text">${rich(c)}</span></button>
          ${elim ? (isX ? `<button class="undo" data-undo="${L}">Undo</button>` : `<button class="cross" data-cross="${L}" title="Cross out ${L}">${L}</button>`) : ""}
        </div>`;
      })
      .join("")}</div>`;
  }
  const hl = S.hl[q.id] || {};
  return `<div class="qbar"><div class="qnum">${S.idx + 1}</div>
      <button class="mark-btn ${S.marked[q.id] ? "on" : ""}" data-act="mark"><span class="flag">🔖</span> Mark for Review</button>
      ${q.type === "mcq" ? `<button class="elim-btn ${elim ? "on" : ""}" data-act="elim" title="Answer eliminator">ABC</button>` : ""}
    </div>
    ${mod().section === "math" ? figureHtml(q) : ""}
    <div class="qprompt hl-area" data-hl="prompt">${hl.prompt ?? rich(q.prompt)}</div>
    ${body}`;
}

function renderExam() {
  const m = mod();
  let main;
  if (S.phase === "review") {
    main = `<div class="screen" style="padding-top:30px">
      <h1>Check Your Work</h1>
      <p class="lead">Khi thi thật, bạn không thể sang module tiếp theo trước khi hết giờ. Ở đây bạn có thể bấm <b>${test.modules[S.mod + 1] ? "Next" : "Submit"}</b> khi đã sẵn sàng.</p>
      <div class="panel">
        <div class="row between" style="margin-bottom:6px"><h3 style="margin:0">${esc(m.title)} Questions</h3>
        <div class="legend" style="border:none;padding:0;margin:0"><span><i class="box"></i> Unanswered</span><span>🔖 For Review</span></div></div>
        <div class="qgrid" style="padding-top:14px">${gridCells(-1)}</div>
        <p class="muted" style="text-align:center;margin-top:16px">Đã trả lời ${m.questions.filter((q) => S.answers[q.id]).length}/${m.questions.length} câu.</p>
      </div></div>`;
  } else {
    const q = question();
    const hl = S.hl[q.id] || {};
    const isRw = m.section === "rw";
    if (isRw && (q.passage || q.figure || q.image)) {
      main = `<div class="pane left"><div class="passage hl-area" data-hl="passage">
          ${figureHtml(q)}${hl.passage ?? rich(q.passage)}</div></div>
        <div class="divider"></div><div class="pane right">${questionPanel(q)}</div>`;
    } else if (q.type === "spr") {
      main = `<div class="pane left">${SPR_DIRECTIONS}</div><div class="divider"></div><div class="pane right">${questionPanel(q)}</div>`;
    } else if (q.passage) {
      main = `<div class="pane left"><div class="passage hl-area" data-hl="passage">${hl.passage ?? rich(q.passage)}</div></div>
        <div class="divider"></div><div class="pane right">${questionPanel(q)}</div>`;
    } else {
      main = `<div class="pane single">${questionPanel(q)}</div>`;
    }
  }
  app.innerHTML = `${header()}<div class="bb-body">${main}</div>${navPopup()}${footer()}`;
  if (S.splitPct) {
    const left = $(".pane.left");
    if (left) left.style.flexBasis = S.splitPct + "%";
  }
  $$(".hl-area, .choices, .figure-box, .pane").forEach(renderMath);
  const spr = $("#sprInput");
  if (spr) {
    const upd = () => {
      $("#sprPreview").innerHTML = spr.value ? sprPreview(spr.value) : "";
      renderMath($("#sprPreview"));
    };
    spr.addEventListener("input", () => {
      spr.value = spr.value.replace(/[^0-9./\-]/g, "");
      S.answers[question().id] = spr.value.trim();
      save();
      upd();
    });
    upd();
  }
  setupDivider();
  tutor?.refresh();
}

function sprPreview(v) {
  const m = v.match(/^(-?)(\d*\.?\d+)\/(\d*\.?\d+)$/);
  return m ? `$${m[1]}\\dfrac{${m[2]}}{${m[3]}}$` : esc(v);
}

function setupDivider() {
  const div = $(".divider");
  if (!div) return;
  div.onmousedown = (e) => {
    e.preventDefault();
    const body = $(".bb-body").getBoundingClientRect();
    const move = (ev) => {
      const pct = Math.min(75, Math.max(25, ((ev.clientX - body.left) / body.width) * 100));
      $(".pane.left").style.flexBasis = pct + "%";
      S.splitPct = pct;
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      save();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
}

// ---------------- Thao tác ----------------
function go(idx) {
  trackTime();
  S.idx = idx;
  S.phase = "question";
  navOpen = false;
  save();
  renderExam();
  $(".pane.right, .pane.single")?.scrollTo(0, 0);
}

function selectChoice(L) {
  const q = question();
  if (S.answers[q.id] === L) return;
  S.answers[q.id] = L;
  // chọn một đáp án đã gạch thì bỏ gạch
  if (S.crossed[q.id]) S.crossed[q.id] = S.crossed[q.id].filter((x) => x !== L);
  save();
  renderExam();
}

app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-choice],[data-cross],[data-undo],[data-goto]");
  if (!t) {
    if (navOpen && !e.target.closest(".navpop")) {
      navOpen = false;
      renderExam();
    }
    if (!e.target.closest(".bb-menu")) $(".bb-menu")?.remove();
    return;
  }
  const q = S.phase === "question" ? question() : null;
  if (t.dataset.choice) return selectChoice(t.dataset.choice);
  if (t.dataset.cross) {
    const L = t.dataset.cross;
    S.crossed[q.id] = [...new Set([...(S.crossed[q.id] || []), L])];
    if (S.answers[q.id] === L) delete S.answers[q.id];
    save();
    return renderExam();
  }
  if (t.dataset.undo) {
    S.crossed[q.id] = (S.crossed[q.id] || []).filter((x) => x !== t.dataset.undo);
    save();
    return renderExam();
  }
  if (t.dataset.goto != null) return go(Number(t.dataset.goto));
  switch (t.dataset.act) {
    case "next":
      if (S.phase === "review") return confirmEnd();
      if (S.idx < mod().questions.length - 1) return go(S.idx + 1);
      trackTime();
      S.phase = "review";
      navOpen = false;
      save();
      return renderExam();
    case "back":
      if (S.phase === "review") return go(mod().questions.length - 1);
      return go(Math.max(0, S.idx - 1));
    case "nav":
      navOpen = !navOpen;
      return renderExam();
    case "review":
      trackTime();
      S.phase = "review";
      navOpen = false;
      save();
      return renderExam();
    case "mark":
      S.marked[q.id] = !S.marked[q.id];
      save();
      return renderExam();
    case "elim":
      S.elimOn = !S.elimOn;
      save();
      return renderExam();
    case "hidetime":
      timeHidden = !timeHidden;
      return renderExam();
    case "directions":
      return showDirections();
    case "calc":
      return toggleCalculator();
    case "ref":
      return toggleReference();
    case "hlhelp":
      return toast("Bôi đen chữ trong đoạn văn/câu hỏi để highlight hoặc ghi chú. Bấm vào chỗ đã highlight để xoá.");
    case "more":
      return showMore(t);
  }
});

function confirmEnd() {
  const m = mod();
  const blank = m.questions.filter((q) => !S.answers[q.id]).length;
  const last = !test.modules[S.mod + 1];
  const msg = `${blank ? `Bạn còn ${blank} câu chưa trả lời. ` : ""}${last ? "Nộp bài và xem kết quả?" : "Chuyển sang module tiếp theo? Bạn sẽ không quay lại được module này."}`;
  if (confirm(msg)) endModule(false);
}

function showMore(btn) {
  $(".bb-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "bb-menu";
  menu.innerHTML = `<button data-m="keys">⌨️ Phím tắt</button><button data-m="exit">💾 Lưu & thoát (làm tiếp sau)</button><button data-m="submit">📤 Nộp bài ngay</button>`;
  $(".bb-head").append(menu);
  menu.onclick = (e) => {
    const m = e.target.dataset.m;
    menu.remove();
    if (m === "keys") modal("Phím tắt", `<ul><li><b>A / B / C / D</b>: chọn đáp án</li><li><b>Shift + A–D</b>: gạch bỏ đáp án</li><li><b>→ / ←</b>: câu sau / câu trước</li><li><b>M</b>: Mark for Review</li></ul>`);
    if (m === "exit") {
      trackTime();
      save();
      location.href = "/";
    }
    if (m === "submit" && confirm("Nộp bài ngay? Các module còn lại sẽ tính là bỏ trống.")) {
      trackTime();
      submit(false);
    }
  };
}

document.addEventListener("keydown", (e) => {
  if (S?.phase !== "question" || e.target.matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  const q = question();
  const k = e.key.toUpperCase();
  if (q.type === "mcq" && LETTERS.includes(k) && LETTERS.indexOf(k) < q.choices.length) {
    if (e.shiftKey) {
      S.crossed[q.id] = [...new Set([...(S.crossed[q.id] || []), k])];
      if (S.answers[q.id] === k) delete S.answers[q.id];
      S.elimOn = true;
      save();
      renderExam();
    } else selectChoice(k);
  } else if (e.key === "ArrowRight") $('[data-act="next"]')?.click();
  else if (e.key === "ArrowLeft" && S.idx > 0) go(S.idx - 1);
  else if (k === "M") {
    S.marked[q.id] = !S.marked[q.id];
    save();
    renderExam();
  }
});

// ---------------- Highlight & ghi chú ----------------
let hlPop = null;
function closeHlPop() {
  hlPop?.remove();
  hlPop = null;
}
function saveHighlights(area) {
  const q = question();
  S.hl[q.id] = { ...(S.hl[q.id] || {}), [area.dataset.hl]: area.dataset.hl === "passage" ? areaHtmlWithoutFigure(area) : area.innerHTML };
  save();
}
function areaHtmlWithoutFigure(area) {
  const clone = area.cloneNode(true);
  clone.querySelector(".figure-box")?.remove();
  return clone.innerHTML;
}

function popAt(rect, html) {
  closeHlPop();
  hlPop = document.createElement("div");
  hlPop.className = "hl-pop";
  hlPop.innerHTML = html;
  document.body.append(hlPop);
  const top = rect.top - 44 < 70 ? rect.bottom + 8 : rect.top - 44;
  hlPop.style.top = top + "px";
  hlPop.style.left = Math.max(8, Math.min(window.innerWidth - 220, rect.left + rect.width / 2 - 100)) + "px";
  return hlPop;
}

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".hl-pop")) closeHlPop();
});

document.addEventListener("mouseup", (e) => {
  if (e.target.closest(".hl-pop")) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const area = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer.closest(".hl-area") : range.commonAncestorContainer.parentElement?.closest(".hl-area");
    if (!area) return;
    const pop = popAt(range.getBoundingClientRect(), `
      <button class="sw" style="background:#fdeb72" data-c=""></button>
      <button class="sw" style="background:#b8dcff" data-c="blue"></button>
      <button class="sw" style="background:#ffc2dd" data-c="pink"></button>
      <button data-note>📝 Ghi chú</button>`);
    pop.onmousedown = (ev) => ev.preventDefault();
    pop.onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      let note = "";
      if (b.hasAttribute("data-note")) {
        note = prompt("Ghi chú cho đoạn đã chọn:") || "";
        if (!note) return closeHlPop();
      }
      highlightRange(range, area, b.dataset.c || "", note);
      sel.removeAllRanges();
      saveHighlights(area);
      closeHlPop();
    };
  }, 0);
});

app.addEventListener("click", (e) => {
  const mark = e.target.closest("mark.hl");
  if (!mark || !window.getSelection().isCollapsed) return;
  const area = mark.closest(".hl-area");
  const pop = popAt(mark.getBoundingClientRect(), `${mark.dataset.note ? `<span style="padding:4px 8px;max-width:260px">${esc(mark.dataset.note)}</span>` : ""}<button data-x>✕ Xoá highlight</button>`);
  pop.onclick = (ev) => {
    if (!ev.target.closest("[data-x]")) return;
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
    saveHighlights(area);
    closeHlPop();
  };
});

function highlightRange(range, area, color, note) {
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
  const segs = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!range.intersectsNode(n) || n.parentElement.closest(".katex, .figure-box")) continue;
    const start = n === range.startContainer ? range.startOffset : 0;
    const end = n === range.endContainer ? range.endOffset : n.length;
    if (end > start && n.textContent.slice(start, end).trim()) segs.push([n, start, end]);
  }
  for (const [n, start, end] of segs) {
    const target = n.splitText(start);
    target.splitText(end - start);
    const mark = document.createElement("mark");
    mark.className = `hl ${color}`.trim();
    if (note) {
      mark.dataset.note = note;
      mark.title = note;
    }
    target.parentNode.insertBefore(mark, target);
    mark.append(target);
  }
}

// ---------------- Cửa sổ nổi ----------------
function floating(id, title, bodyHtml, size = {}) {
  let win = document.getElementById(id);
  if (win) {
    win.remove();
    return null;
  }
  win = document.createElement("div");
  win.className = "float-win";
  win.id = id;
  Object.assign(win.style, size);
  win.innerHTML = `<div class="fw-head"><span>${title}</span><button data-close>✕</button></div><div class="fw-body">${bodyHtml}</div>`;
  document.body.append(win);
  $("[data-close]", win).onclick = () => win.remove();
  const head = $(".fw-head", win);
  head.onmousedown = (e) => {
    if (e.target.closest("button")) return;
    const sx = e.clientX - win.offsetLeft;
    const sy = e.clientY - win.offsetTop;
    const shield = document.createElement("div"); // giữ sự kiện chuột khi kéo qua iframe
    shield.style.cssText = "position:fixed;inset:0;z-index:999;cursor:move";
    document.body.append(shield);
    const move = (ev) => {
      win.style.left = Math.max(0, ev.clientX - sx) + "px";
      win.style.top = Math.max(0, ev.clientY - sy) + "px";
    };
    const up = () => {
      shield.remove();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return win;
}
function closeFloating() {
  $$(".float-win").forEach((w) => w.remove());
}

function toggleCalculator() {
  floating(
    "calcWin",
    "Calculator (Desmos)",
    `<iframe src="https://www.desmos.com/testing/cb-digital-sat/graphing" title="Desmos graphing calculator" allow="clipboard-write"></iframe>`,
    { width: "520px", height: "600px" }
  );
}

function toggleReference() {
  const win = floating(
    "refWin",
    "Reference",
    `<div class="ref-sheet">
      <div class="grid">
        <div class="item"><b>Circle</b>$A = \\pi r^2$<br>$C = 2\\pi r$</div>
        <div class="item"><b>Rectangle</b>$A = \\ell w$</div>
        <div class="item"><b>Triangle</b>$A = \\tfrac{1}{2}bh$</div>
        <div class="item"><b>Pythagorean theorem</b>$c^2 = a^2 + b^2$</div>
        <div class="item"><b>Special right triangles</b>$x,\\ x\\sqrt{3},\\ 2x$ (30°-60°-90°)<br>$s,\\ s,\\ s\\sqrt{2}$ (45°-45°-90°)</div>
        <div class="item"><b>Rectangular prism</b>$V = \\ell w h$</div>
        <div class="item"><b>Cylinder</b>$V = \\pi r^2 h$</div>
        <div class="item"><b>Sphere</b>$V = \\tfrac{4}{3}\\pi r^3$</div>
        <div class="item"><b>Cone</b>$V = \\tfrac{1}{3}\\pi r^2 h$</div>
        <div class="item"><b>Pyramid</b>$V = \\tfrac{1}{3}\\ell w h$</div>
      </div>
      <ul>
        <li>The number of degrees of arc in a circle is 360.</li>
        <li>The number of radians of arc in a circle is $2\\pi$.</li>
        <li>The sum of the measures in degrees of the angles of a triangle is 180.</li>
      </ul></div>`,
    { width: "440px", height: "540px", left: "auto", right: "30px" }
  );
  if (win) renderMath(win);
}

function modal(title, html) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-back"><div class="modal"><h2>${title}</h2>${html}<div style="text-align:right;margin-top:16px"><button class="bb-btn" data-close>Close</button></div></div></div>`;
  root.onclick = (e) => {
    if (e.target.matches("[data-close], .modal-back")) root.innerHTML = "";
  };
  renderMath(root);
}

function showDirections() {
  if (mod().section === "rw") {
    modal(
      "Directions",
      `<p>The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s).</p>
       <p>All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.</p>
       <p class="muted">Module 2 trong đề này luôn là module khó. ${test.timed ? `Thời gian: ${Math.round(mod().seconds / 60)} phút.` : ""}</p>`
    );
  } else {
    modal(
      "Directions",
      `<p>The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions. A reference sheet, calculator, and these directions can be accessed throughout the test.</p>
       <p><b>Unless otherwise indicated:</b></p>
       <ul><li>All variables and expressions represent real numbers.</li><li>Figures provided are drawn to scale.</li><li>All figures lie in a plane.</li><li>The domain of a given function $f$ is the set of all real numbers $x$ for which $f(x)$ is a real number.</li></ul>
       <p>For <b>multiple-choice questions</b>, solve each problem and choose the correct answer from the choices provided. Each multiple-choice question has a single correct answer.</p>
       <p>For <b>student-produced response questions</b>, solve each problem and enter your answer as described in the directions on the left of the question.</p>`
    );
  }
}

// ---------------- Khởi động ----------------
try {
  test = await api(`/api/tests/${testId}`);
} catch (err) {
  app.innerHTML = `<div class="screen"><h1>Không tải được bài thi</h1><p class="lead">${esc(err.message)}</p><a class="bb-btn" href="/">Về trang chủ</a></div>`;
  throw err;
}
S = loadState() || { phase: "intro", mod: 0, idx: 0, remaining: 0, answers: {}, marked: {}, crossed: {}, hl: {}, timeSpent: {}, elimOn: false };
render();

if (test.aiHelp) {
  const status = await api("/api/status").catch(() => ({}));
  tutor = createTutor({
    enabled: status.aiEnabled,
    getContext: () =>
      S.phase === "question"
        ? { mode: "practice", testId, questionId: question().id, given: S.answers[question().id] || "", label: `Câu ${S.idx + 1} — ${mod().title}` }
        : { mode: "general" },
    quick: (ctx) => (ctx.questionId ? ["Gợi ý cho mình một chút", "Câu này thuộc dạng gì?", "Giải thích từ vựng khó", "Dịch đoạn văn sang tiếng Việt"] : ["Mẹo quản lý thời gian"]),
  });
}

window.addEventListener("beforeunload", () => {
  if (S && S.phase !== "submitting") {
    trackTime();
    save();
  }
});
