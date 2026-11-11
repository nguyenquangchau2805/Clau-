// Trình làm bài chạy trong file .html xuất cho điện thoại (không cần server).
// Các hàm checkAnswer, scoreTest và WEIGHT được chèn sẵn từ web chính.
(function () {
  "use strict";
  var T = JSON.parse(document.getElementById("test-data").textContent);
  var KEY = "sat_phone_" + T.id;
  var LETTERS = ["A", "B", "C", "D"];
  var app = document.getElementById("app");
  var S;
  var gridOpen = false;
  var timeHidden = false;
  var qStart = Date.now();
  var filter = "all";

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {}
  }
  function fresh() {
    return { phase: "intro", mod: 0, idx: 0, remaining: 0, elapsed: 0, answers: {}, marked: {}, crossed: {}, checked: {}, timeSpent: {}, elim: false };
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function toast(text) {
    var d = document.createElement("div");
    d.className = "toast";
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () {
      d.remove();
    }, 3000);
  }
  function mod() {
    return T.modules[S.mod];
  }
  function q() {
    return mod().questions[S.idx];
  }
  function sectionName(s) {
    return s === "rw" ? "Reading and Writing" : "Math";
  }
  function trackTime() {
    if (S.phase === "question" && q()) {
      var id = q().id;
      S.timeSpent[id] = (S.timeSpent[id] || 0) + (Date.now() - qStart) / 1000;
    }
    qStart = Date.now();
  }

  // ---------------- Đồng hồ ----------------
  setInterval(function () {
    if (!S) return;
    if (S.phase === "question" || S.phase === "review") {
      if (T.timed) {
        S.remaining--;
        if (S.remaining <= 0) {
          S.remaining = 0;
          toast("Hết giờ module này!");
          return endModule();
        }
        if (S.remaining === 300) toast("Còn 5 phút cho module này.");
      } else S.elapsed++;
      var t = document.getElementById("timer");
      if (t) {
        t.textContent = T.timed ? fmt(S.remaining) : fmt(S.elapsed);
        t.className = "timer" + (T.timed && S.remaining <= 300 ? " warn" : "") + (timeHidden ? " hidden" : "");
      }
      if (S.remaining % 5 === 0) save();
    } else if (S.phase === "break") {
      S.breakRemaining--;
      var b = document.getElementById("breakTime");
      if (b) b.textContent = fmt(S.breakRemaining);
      if (S.breakRemaining <= 0) startModule(S.mod + 1);
    }
  }, 1000);

  // ---------------- Chuyển màn ----------------
  function startModule(i) {
    trackTime();
    S.mod = i;
    S.idx = 0;
    S.remaining = T.modules[i].seconds;
    S.elapsed = 0;
    S.phase = "question";
    save();
    render();
  }
  function endModule() {
    trackTime();
    gridOpen = false;
    var next = T.modules[S.mod + 1];
    if (!next) {
      S.phase = "result";
    } else if (next.section !== mod().section) {
      S.phase = "break";
      S.breakRemaining = T.breakSeconds || 600;
    } else {
      S.phase = "transition";
    }
    save();
    render();
    window.scrollTo(0, 0);
  }
  function go(i) {
    trackTime();
    S.idx = i;
    S.phase = "question";
    gridOpen = false;
    save();
    render();
    window.scrollTo(0, 0);
  }

  // ---------------- Render ----------------
  function render() {
    if (S.phase === "intro") return renderIntro();
    if (S.phase === "break") return renderBreak();
    if (S.phase === "transition") return renderTransition();
    if (S.phase === "result") return renderResult();
    renderExam();
  }

  function renderIntro() {
    var total = 0;
    var rows = T.modules
      .map(function (m) {
        total += m.questions.length;
        return "<tr><td>" + esc(m.title) + (m.hard ? " <b style='color:#c0392b'>(khó)</b>" : "") + "</td><td>" + m.questions.length + " câu</td><td>" + (T.timed ? Math.round(m.seconds / 60) + " phút" : "—") + "</td></tr>";
      })
      .join("");
    app.innerHTML =
      "<div class='screen'><h1>Đề SAT luyện tập</h1>" +
      "<p>" + total + " câu · " + T.modules.length + " module. Module 2 của mỗi phần là module <b>khó</b>." +
      (T.timed ? " Có bấm giờ như thi thật." : " Không giới hạn thời gian.") +
      (T.instant ? "<br>Chế độ <b>hiện đáp án ngay</b>: chọn xong bấm <b>Kiểm tra</b>." : "") +
      "</p><div class='card'><table>" + rows + "</table></div>" +
      "<button class='btn' data-a='start'>Bắt đầu</button>" +
      "<p style='font-size:13px;color:#5b6270;margin-top:18px'>Bài làm được lưu trên máy: thoát ra mở lại file vẫn làm tiếp được.</p></div>";
  }

  function renderBreak() {
    app.innerHTML =
      "<div class='screen dark'><p>Thời gian nghỉ còn lại:</p><div class='bigtime' id='breakTime'>" + fmt(S.breakRemaining) + "</div><br>" +
      "<button class='btn outline' data-a='resume'>Làm tiếp ngay</button>" +
      "<p style='margin-top:24px'>Bạn đã xong phần Reading and Writing. Phần Math sẽ tự bắt đầu khi hết giờ nghỉ.</p></div>";
  }

  function renderTransition() {
    var next = T.modules[S.mod + 1];
    app.innerHTML =
      "<div class='screen dark'><h1>Xong Module " + mod().module + "</h1><p>Tiếp theo: <b>" + esc(next.title) + "</b>, module <b>khó</b> gồm " + next.questions.length +
      " câu. Bạn sẽ không quay lại được module trước.</p><button class='btn outline' data-a='next-module'>Tiếp tục</button></div>";
  }

  function checked(item) {
    return T.instant ? S.checked[item.id] : null;
  }

  function header() {
    return (
      "<div class='head'><div class='title'>" + esc(mod().title) + "</div>" +
      "<span id='timer' class='timer" + (T.timed && S.remaining <= 300 ? " warn" : "") + (timeHidden ? " hidden" : "") + "'>" + (T.timed ? fmt(S.remaining) : fmt(S.elapsed)) + "</span>" +
      "<button class='small' data-a='hide'>" + (timeHidden ? "Hiện giờ" : "Ẩn") + "</button></div>"
    );
  }

  function footer() {
    var review = S.phase === "review";
    var last = !T.modules[S.mod + 1];
    return (
      "<div class='foot'>" +
      (review || S.idx > 0 ? "<button class='btn' data-a='back'>Back</button>" : "<span style='width:70px'></span>") +
      (review ? "<span></span>" : "<button class='navbtn' data-a='grid'>Câu " + (S.idx + 1) + "/" + mod().questions.length + " ▴</button>") +
      "<button class='btn' data-a='next'>" + (review ? (last ? "Nộp bài" : "Next") : "Next") + "</button></div>"
    );
  }

  function cells(current) {
    return mod()
      .questions.map(function (item, i) {
        var c = ["cell"];
        var chk = checked(item);
        if (S.answers[item.id]) c.push("ans");
        if (chk) c.push(chk.correct ? "right" : "wrong");
        if (S.marked[item.id]) c.push("mk");
        if (i === current) c.push("cur");
        return "<button class='" + c.join(" ") + "' data-goto='" + i + "'>" + (i + 1) + "</button>";
      })
      .join("");
  }

  function figure(item) {
    if (item.image) return "<div class='figimg'><img src='" + esc(item.image) + "' alt='Hình' /></div>";
    if (item.figure) return "<div class='figure'><b>Hình:</b> " + item.figure + "</div>";
    return "";
  }

  function questionHtml(item) {
    var chk = checked(item);
    var sel = S.answers[item.id] || "";
    var crossed = S.crossed[item.id] || [];
    var elim = S.elim && !chk;
    var body;
    if (item.type === "spr") {
      body =
        "<input class='spr" + (chk ? (chk.correct ? " right" : " wrong") : "") + "' id='spr' inputmode='decimal' maxlength='6' autocomplete='off' value='" + esc(sel) + "'" + (chk ? " readonly" : "") + " />" +
        "<div class='sprhelp'>Câu tự điền: nhập số, phân số (vd 3/4) hoặc số thập phân.</div>";
    } else {
      body =
        "<div class='choices'>" +
        item.choices
          .map(function (c, i) {
            var L = LETTERS[i];
            var x = crossed.indexOf(L) >= 0;
            var cls = "choice" + (sel === L ? " sel" : "") + (x ? " x" : "");
            if (chk && L === item.answer) cls += " right";
            if (chk && L === sel && !chk.correct) cls += " wrong";
            return (
              "<div class='crow'><button class='" + cls + "' data-c='" + L + "'" + (chk ? " disabled" : "") + "><span class='letter'>" + L + "</span><span class='ctext'>" + c + "</span></button>" +
              (elim ? (x ? "<button class='undo' data-undo='" + L + "'>Undo</button>" : "<button class='cross' data-x='" + L + "'>" + L + "</button>") : "") +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    }
    var fb = "";
    if (T.instant) {
      if (!chk) fb = "<div style='margin-top:16px'><button class='btn' data-a='check'" + (sel ? "" : " disabled") + ">Kiểm tra</button></div>";
      else {
        var right = item.type === "spr" ? item.answer.split("|").join(" hoặc ") : item.answer;
        fb =
          "<div class='feedback " + (chk.correct ? "ok" : "bad") + "'><b class='h'>" + (chk.correct ? "✓ Chính xác!" : "✗ Chưa đúng. Đáp án đúng: " + esc(right)) + "</b>" +
          (item.explanation ? "<div class='expl'>" + item.explanation + "</div>" : "") + "</div>";
      }
    }
    return (
      (item.passage || (item.section === "rw" && (item.figure || item.image)) ? "<div class='passage'>" + (item.section === "rw" ? figure(item) : "") + item.passage + "</div>" : "") +
      "<div class='qbar'><div class='qnum'>" + (S.idx + 1) + "</div>" +
      "<button class='mark" + (S.marked[item.id] ? " on" : "") + "' data-a='mark'><span class='flag'>🔖</span> Đánh dấu</button>" +
      (item.type === "mcq" && !chk ? "<button class='elim" + (elim ? " on" : "") + "' data-a='elim'>ABC</button>" : "") + "</div>" +
      (item.section === "math" ? figure(item) : "") +
      "<div class='prompt'>" + item.prompt + "</div>" + body + fb
    );
  }

  function renderExam() {
    var main;
    if (S.phase === "review") {
      var m = mod();
      var done = m.questions.filter(function (x) {
        return S.answers[x.id];
      }).length;
      main =
        "<div class='screen' style='padding-top:10px'><h1>Kiểm tra lại</h1><p>Đã trả lời " + done + "/" + m.questions.length +
        " câu. Bấm vào số câu để quay lại sửa.</p><div class='grid'>" + cells(-1) + "</div></div>";
    } else main = questionHtml(q());
    var sheet = "";
    if (gridOpen && S.phase === "question") {
      sheet =
        "<div class='overlay' data-a='grid'><div class='sheet'><h3>" + esc(mod().title) + "</h3>" +
        "<div class='legend'><span><i></i>Chưa làm</span><span>🔖 Đánh dấu</span>" +
        (T.instant ? "<span><i style='background:#1d7f45;border-color:#1d7f45'></i>Đúng</span><span><i style='background:#c0392b;border-color:#c0392b'></i>Sai</span>" : "") +
        "</div><div class='grid'>" + cells(S.idx) + "</div>" +
        "<div style='text-align:center;margin-top:16px'><button class='btn outline' data-a='review'>Trang kiểm tra lại</button></div></div></div>";
    }
    app.innerHTML = header() + "<div class='main'>" + main + "</div>" + footer() + sheet;
    var spr = document.getElementById("spr");
    if (spr) {
      spr.addEventListener("input", function () {
        spr.value = spr.value.replace(/[^0-9./\-]/g, "");
        S.answers[q().id] = spr.value.trim();
        save();
        var b = document.querySelector("[data-a='check']");
        if (b) b.disabled = !spr.value.trim();
      });
    }
  }

  // ---------------- Kết quả ----------------
  function renderResult() {
    var answers = {};
    Object.keys(S.answers).forEach(function (k) {
      if (S.answers[k]) answers[k] = S.answers[k];
    });
    var r = scoreTest(T, answers);
    var secs = Object.keys(r.sections)
      .map(function (k) {
        var s = r.sections[k];
        return (
          "<div class='sec'>" + sectionName(k) + "<b>" + s.score + "</b>" + s.correct + "/" + s.count + " câu đúng<br>" +
          s.modules
            .map(function (m) {
              return "M" + m.module + ": " + m.correct + "/" + m.count;
            })
            .join(" · ") +
          "</div>"
        );
      })
      .join("");
    var counter = {};
    var items = r.items
      .map(function (it, i) {
        var key = it.section + it.module;
        counter[key] = (counter[key] || 0) + 1;
        var st = !it.given ? "skip" : it.correct ? "ok" : "bad";
        if (filter === "bad" && st !== "bad") return "";
        if (filter === "skip" && st !== "skip") return "";
        if (filter === "marked" && !S.marked[it.id]) return "";
        var opts =
          it.type === "mcq"
            ? it.choices
                .map(function (c, j) {
                  var L = LETTERS[j];
                  var cls = L === it.answer ? "right" : L === it.given ? "wrong" : "";
                  return "<div class='opt " + cls + "'><b>" + L + ")</b><div class='ctext'>" + c + "</div></div>";
                })
                .join("")
            : "<div class='opt " + (it.correct ? "right" : "wrong") + "'>Bạn nhập: <b>" + esc(it.given || "(bỏ trống)") + "</b></div><div class='opt right'>Đáp án: <b>" + esc(it.answer.split("|").join(", ")) + "</b></div>";
        return (
          "<details class='item'><summary><span class='res " + st + "'>" + { ok: "✓", bad: "✕", skip: "–" }[st] + "</span><span style='flex:1'>" +
          (it.section === "rw" ? "RW" : "Math") + " · M" + it.module + " · Câu " + counter[key] + (S.marked[it.id] ? " 🔖" : "") + "</span><span style='color:#5b6270;font-size:12px'>" +
          { easy: "Dễ", medium: "TB", hard: "Khó" }[it.difficulty] + "</span></summary><div class='body'>" +
          (it.passage ? "<div class='passage' style='margin-top:10px'>" + it.passage + "</div>" : "") + figure(it) +
          "<div class='prompt' style='margin-top:10px'>" + it.prompt + "</div>" + opts + (it.explanation ? "<div class='expl'><b>Giải thích:</b> " + it.explanation + "</div>" : "") +
          "</div></details>"
        );
      })
      .join("");
    var wrong = r.items.filter(function (x) {
      return x.given && !x.correct;
    }).length;
    var skipped = r.items.filter(function (x) {
      return !x.given;
    }).length;
    app.innerHTML =
      "<div class='screen'><p style='margin:0'>Điểm ước tính</p><div class='score'>" + r.total + "</div>" +
      "<p>Đúng " + (r.items.length - wrong - skipped) + "/" + r.items.length + " · Sai " + wrong + " · Bỏ trống " + skipped + "</p>" +
      "<div class='secs'>" + secs + "</div>" +
      "<div class='card' style='text-align:center'><b>Đưa kết quả về máy tính</b><p style='font-size:14px;margin:6px 0 10px'>Tải file kết quả, rồi trên web ở máy tính vào <b>Lịch sử → Nhập kết quả từ điện thoại</b>.</p>" +
      "<button class='btn ghost' data-a='download'>⬇ Tải file kết quả</button></div>" +
      "<div class='filters'><button data-f='all' class='" + (filter === "all" ? "on" : "") + "'>Tất cả</button><button data-f='bad' class='" + (filter === "bad" ? "on" : "") +
      "'>Sai</button><button data-f='skip' class='" + (filter === "skip" ? "on" : "") + "'>Bỏ trống</button><button data-f='marked' class='" + (filter === "marked" ? "on" : "") + "'>🔖 Đánh dấu</button></div>" +
      (items || "<p>Không có câu nào.</p>") +
      "<p style='margin-top:20px'><button class='btn outline' data-a='restart'>Làm lại đề này từ đầu</button></p></div>";
  }

  function downloadResult() {
    var payload = { type: "sat-phone-result", testId: T.id, finishedAt: new Date().toISOString(), answers: S.answers, marked: Object.keys(S.marked).filter(function (k) { return S.marked[k]; }), timeSpent: S.timeSpent };
    var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ket-qua-SAT-" + T.id + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  }

  // ---------------- Thao tác ----------------
  function choose(L) {
    var item = q();
    if (checked(item) || S.answers[item.id] === L) return;
    S.answers[item.id] = L;
    if (S.crossed[item.id])
      S.crossed[item.id] = S.crossed[item.id].filter(function (x) {
        return x !== L;
      });
    save();
    renderExam();
  }

  function check() {
    var item = q();
    var given = S.answers[item.id];
    if (!given || checked(item)) return;
    S.checked[item.id] = { correct: checkAnswer(item, given) };
    save();
    renderExam();
  }

  app.addEventListener("click", function (e) {
    var f = e.target.closest("[data-f]");
    if (f) {
      filter = f.getAttribute("data-f");
      return renderResult();
    }
    var t = e.target.closest("[data-a],[data-c],[data-x],[data-undo],[data-goto]");
    if (!t) return;
    if (t.classList.contains("overlay") && e.target !== t) return; // bấm trong bảng, không phải nền mờ
    var item = S.phase === "question" ? q() : null;
    if (t.hasAttribute("data-c")) return choose(t.getAttribute("data-c"));
    if (t.hasAttribute("data-x")) {
      var L = t.getAttribute("data-x");
      S.crossed[item.id] = (S.crossed[item.id] || []).concat(L);
      if (S.answers[item.id] === L) delete S.answers[item.id];
      save();
      return renderExam();
    }
    if (t.hasAttribute("data-undo")) {
      var U = t.getAttribute("data-undo");
      S.crossed[item.id] = (S.crossed[item.id] || []).filter(function (x) {
        return x !== U;
      });
      save();
      return renderExam();
    }
    if (t.hasAttribute("data-goto")) return go(Number(t.getAttribute("data-goto")));
    switch (t.getAttribute("data-a")) {
      case "start":
        return startModule(0);
      case "resume":
      case "next-module":
        return startModule(S.mod + 1);
      case "hide":
        timeHidden = !timeHidden;
        return renderExam();
      case "grid":
        gridOpen = !gridOpen;
        return renderExam();
      case "review":
        trackTime();
        S.phase = "review";
        gridOpen = false;
        save();
        return renderExam();
      case "mark":
        S.marked[item.id] = !S.marked[item.id];
        save();
        return renderExam();
      case "elim":
        S.elim = !S.elim;
        save();
        return renderExam();
      case "check":
        return check();
      case "back":
        if (S.phase === "review") return go(mod().questions.length - 1);
        return go(Math.max(0, S.idx - 1));
      case "next":
        if (S.phase === "review") {
          var blank = mod().questions.filter(function (x) {
            return !S.answers[x.id];
          }).length;
          var last = !T.modules[S.mod + 1];
          if (confirm((blank ? "Còn " + blank + " câu chưa trả lời. " : "") + (last ? "Nộp bài và xem kết quả?" : "Sang module tiếp theo? Bạn sẽ không quay lại được module này."))) endModule();
          return;
        }
        if (S.idx < mod().questions.length - 1) return go(S.idx + 1);
        trackTime();
        S.phase = "review";
        save();
        renderExam();
        return window.scrollTo(0, 0);
      case "download":
        return downloadResult();
      case "restart":
        if (confirm("Xoá bài làm và làm lại đề này từ đầu?")) {
          S = fresh();
          save();
          render();
        }
        return;
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!S || S.phase !== "question" || e.target.matches("input") && e.key !== "Enter") return;
    if (e.key === "Enter" && T.instant) return check();
    if (e.target.matches("input")) return;
    var k = e.key.toUpperCase();
    if (LETTERS.indexOf(k) >= 0 && q().type === "mcq") choose(k);
    else if (e.key === "ArrowRight") document.querySelector("[data-a='next']").click();
    else if (e.key === "ArrowLeft" && S.idx > 0) go(S.idx - 1);
  });

  window.addEventListener("pagehide", function () {
    if (S) {
      trackTime();
      save();
    }
  });

  S = load() || fresh();
  render();
})();
