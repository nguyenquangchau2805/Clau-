import { api, $, $$, esc, rich, renderMath, fmtDate, createTutor, SECTION_NAME, DIFF_NAME } from "./common.js";

let status = { aiEnabled: false, counts: { rw: {}, math: {} } };

// ---------------- Điều hướng ----------------
function route() {
  const view = (location.hash || "#home").slice(1);
  for (const v of ["home", "bank", "history"]) $(`#view-${v}`).classList.toggle("hidden", v !== view);
  $$(".topnav nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  if (view === "bank") loadBank(true);
  if (view === "history") loadHistory();
}
window.addEventListener("hashchange", route);

async function loadStatus() {
  status = await api("/api/status");
  const c = status.counts;
  const sum = (o) => o.easy + o.medium + o.hard;
  $("#cntRw").textContent = sum(c.rw);
  $("#cntMath").textContent = sum(c.math);
  $("#cntHard").textContent = c.rw.hard + c.math.hard;
  const pill = $("#aiStatus");
  pill.textContent = status.aiEnabled ? "✨ AI đang bật" : "AI tắt (thiếu API key)";
  pill.classList.toggle("off", !status.aiEnabled);
  if (!status.aiEnabled) {
    $("#upAi").checked = false;
    $("#upAi").disabled = true;
    $("#upVerify").disabled = true;
    $("#btnVerify").disabled = true;
    $("#btnVerify").title = "Cần ANTHROPIC_API_KEY";
    $("#optAi").disabled = true;
  }
}

// ---------------- Tạo đề ----------------
function segment(id) {
  const el = $(id);
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $$("button", el).forEach((x) => x.classList.toggle("on", x === b));
    el.dispatchEvent(new Event("change"));
  });
  return () => $("button.on", el).dataset.v;
}
const getSections = segment("#segSections");
const getLength = segment("#segLength");
$("#segLength").addEventListener("change", () => $("#customCount").classList.toggle("hidden", getLength() !== "custom"));

$("#btnStart").onclick = async () => {
  const sec = getSections();
  const sections = sec === "full" ? ["rw", "math"] : [sec];
  const len = getLength();
  const n = len === "short" ? 10 : len === "custom" ? Number($("#customCount").value) : null;
  const perModule = n ? { rw: n, math: n } : {};
  const btn = $("#btnStart");
  btn.disabled = true;
  try {
    const test = await api("/api/tests", {
      method: "POST",
      body: { sections, perModule, timed: $("#optTimed").checked, shuffleChoices: $("#optShuffle").checked, aiHelp: $("#optAi").checked },
    });
    location.href = `/exam.html?id=${test.id}`;
  } catch (err) {
    $("#startMsg").innerHTML = `<div class="notice err">${esc(err.message)} <a href="#bank">Tải đề lên</a></div>`;
    btn.disabled = false;
  }
};

// ---------------- Tải file ----------------
let pickedFiles = [];
const dz = $("#dropzone");
dz.onclick = () => $("#fileInput").click();
$("#fileInput").onchange = (e) => pickFiles([...e.target.files]);
dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("drag");
});
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("drag");
  pickFiles([...e.dataTransfer.files]);
});
function pickFiles(files) {
  pickedFiles = files;
  $("#fileNames").textContent = files.length ? files.map((f) => f.name).join(", ") : "PDF · DOCX · TXT · JSON";
  $("#btnUpload").disabled = !files.length;
}

async function pollJob(jobId, msg) {
  let fails = 0;
  for (;;) {
    let job;
    try {
      job = await api(`/api/jobs/${jobId}`);
      fails = 0;
    } catch (err) {
      // Server bận (đang đọc PDF lớn) có thể trả lời chậm: thử lại vài lần trước khi báo lỗi.
      if (++fails >= 5) throw err;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const v = job.verify;
    msg.innerHTML =
      `<div class="notice ${job.status === "done" ? (job.errors.length && !job.found && !v ? "err" : "ok") : ""}">${esc(job.message)}</div>` +
      (v && v.total ? `<div class="bar" style="margin:6px 0"><i style="width:${(v.checked / v.total) * 100}%"></i></div>` : "") +
      job.errors.map((e) => `<div class="notice err">${esc(e)}</div>`).join("");
    if (job.status === "done") return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function uploadFiles(files, { useAI = $("#upAi").checked } = {}) {
  const big = files.find((f) => f.size > 100 * 1024 * 1024);
  if (big) {
    $("#uploadMsg").innerHTML = `<div class="notice err">File "${esc(big.name)}" nặng hơn 100MB, quá lớn. Hãy nén PDF hoặc tách thành nhiều file nhỏ.</div>`;
    return;
  }
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f, f.name));
  fd.append("useAI", String(useAI));
  fd.append("verify", String(useAI !== false && $("#upVerify").checked));
  fd.append("section", $("#upSection").value);
  fd.append("difficulty", $("#upDifficulty").value);
  const msg = $("#uploadMsg");
  msg.innerHTML = `<div class="notice">Đang tải lên…</div>`;
  $("#btnUpload").disabled = true;
  try {
    const { jobId } = await api("/api/upload", { method: "POST", body: fd });
    await pollJob(jobId, msg);
  } catch (err) {
    msg.innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
  }
  $("#btnUpload").disabled = !pickedFiles.length;
  await loadStatus();
  loadBank(true);
}
$("#btnUpload").onclick = () => uploadFiles(pickedFiles);
// Prompt để học sinh tự chuyển đề sang định dạng mẫu bằng claude.ai miễn phí (không tốn API).
const CONVERT_PROMPT = `Chuyển các câu SAT mình dán ở cuối sang ĐÚNG định dạng dưới đây. Giữ nguyên từng chữ của đề, không tóm tắt, không thêm bớt. Chỉ trả về phần đã chuyển, đặt trong một khối code để mình copy.

### RW | <easy/medium/hard> | <domain>
Passage: <đoạn văn bên trái; nếu có Text 1 / Text 2 thì giữ nguyên các dòng "Text 1", "Text 2">
Question: <câu hỏi>
A) ...
B) ...
C) ...
D) ...
Answer: <chữ cái A-D>
Explanation: <giải thích ngắn bằng tiếng Việt>

Quy tắc:
- Mỗi câu bắt đầu bằng một dòng "###". Phần ghi RW (Reading and Writing) hoặc Math.
- Domain RW: Craft and Structure, Information and Ideas, Standard English Conventions, Expression of Ideas.
- Domain Math: Algebra, Advanced Math, Problem-Solving and Data Analysis, Geometry and Trigonometry.
- Math: công thức viết LaTeX trong $...$ (ví dụ $\\frac{3}{4}x + 2 = 5$). Câu Math không có đáp án A-D thì bỏ các dòng A-D, chỉ ghi "Answer:"; nếu có nhiều cách ghi đúng thì ngăn bằng dấu | (ví dụ Answer: 2/3 | .6667).
- Câu có hình/đồ thị/biểu đồ: thêm dòng "Figure: <mô tả ngắn hình đó>" ngay dưới dòng ###, mô tả đủ chi tiết (trục, điểm, giá trị). Mình sẽ tự dán ảnh thật vào sau.
- Chỗ trống trong đoạn văn ghi là ______ ; bảng ghi dạng | cột 1 | cột 2 |.
- Nếu đề có đáp án / answer key thì dùng đáp án đó. Nếu không có thì tự giải thật cẩn thận.
- Độ khó: dùng nhãn trong đề nếu có, nếu không thì tự đánh giá easy/medium/hard như College Board.
- Bỏ qua phần hướng dẫn, trang bìa, những thứ không phải câu hỏi.

Đề cần chuyển:
`;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Trình duyệt không cho dùng clipboard API (vd. mở qua địa chỉ IP trong mạng LAN)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

$("#btnCopyPrompt").onclick = async () => {
  await copyText(CONVERT_PROMPT);
  $("#copyMsg").textContent = "✓ Đã sao chép! Dán vào claude.ai rồi dán đề vào cuối.";
  setTimeout(() => ($("#copyMsg").textContent = ""), 4000);
};

$("#btnLoadSample").onclick = async () => {
  const blob = await (await fetch("/sample/sample-bank.json")).blob();
  uploadFiles([new File([blob], "Bộ câu mẫu.json", { type: "application/json" })], { useAI: false });
};

// ---------------- Danh sách câu hỏi ----------------
let bank = [];
let shown = 0;
const PAGE = 50;

async function loadBank(reset) {
  const params = new URLSearchParams();
  for (const [k, id] of [["section", "#fSection"], ["difficulty", "#fDifficulty"], ["source", "#fSource"], ["verify", "#fVerify"], ["figure", "#fFigure"], ["q", "#fQuery"]]) {
    if ($(id).value) params.set(k, $(id).value);
  }
  const data = await api(`/api/questions?${params}`);
  bank = data.questions;
  const cur = $("#fSource").value;
  $("#fSource").innerHTML = `<option value="">Mọi nguồn</option>` + data.sources.map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
  $("#bankTotal").textContent = `(${bank.length}/${data.counts.total})`;
  const vm = $("#verifyMsg");
  if (data.counts.mismatch && $("#fVerify").value !== "mismatch" && !vm.dataset.busy) {
    vm.innerHTML = `<div class="notice err">⚠ Có <b>${data.counts.mismatch}</b> câu AI giải ra khác đáp án trong file. <a href="#" data-showmismatch>Xem các câu này</a></div>`;
  } else if (!vm.dataset.busy) vm.innerHTML = "";
  $("#figureMsg").innerHTML =
    data.counts.missingImage && $("#fFigure").value !== "missing"
      ? `<div class="notice">🖼 Có <b>${data.counts.missingImage}</b> câu có hình/đồ thị nhưng chưa gắn ảnh. <a href="#" data-showmissing>Xem và dán ảnh</a></div>`
      : "";
  if (reset) {
    shown = 0;
    $("#bankRows").innerHTML = "";
  }
  renderMore();
}

function renderMore() {
  const rows = bank.slice(shown, shown + PAGE).map(
    (q) => `<tr data-id="${q.id}">
      <td><span class="tag ${q.section}">${SECTION_NAME[q.section]}</span></td>
      <td><span class="tag ${q.difficulty}">${DIFF_NAME[q.difficulty]}</span></td>
      <td><div class="clip">${esc(q.prompt || q.passage)}</div><div class="muted" style="font-size:12px">${esc(q.domain)}${q.source ? " · " + esc(q.source) : ""}
        ${q.image ? ' <span class="tag">🖼 Có hình</span>' : q.figure ? ' <span class="tag hard">⚠ Thiếu hình</span>' : ""}</div></td>
      <td>${esc(q.answer || "—")}${q.answerSource === "ai" ? ' <span class="tag" title="Đáp án do AI giải">AI</span>' : ""}${verifyBadge(q)}</td>
      <td style="white-space:nowrap"><button class="btn small" data-act="view">Xem / sửa</button> <button class="btn small danger" data-act="del">Xoá</button></td>
    </tr>`
  );
  if (!bank.length) $("#bankRows").innerHTML = `<tr><td colspan="5" class="empty">Chưa có câu hỏi nào. Tải đề lên hoặc bấm "Nạp bộ câu mẫu".</td></tr>`;
  else $("#bankRows").insertAdjacentHTML("beforeend", rows.join(""));
  shown += PAGE;
  $("#bankMore").classList.toggle("hidden", shown >= bank.length);
}
$("#bankMore button").onclick = renderMore;

function verifyBadge(q) {
  const v = q.verify;
  if (!v) return "";
  if (v.status === "mismatch") return `<div><span class="tag hard" title="AI giải ra đáp án khác">⚠ AI: ${esc(v.aiAnswer)}</span></div>`;
  if (v.status === "ok") return `<div><span class="tag easy" title="AI giải ra cùng đáp án">✓ AI xác nhận</span></div>`;
  if (v.status === "resolved") return `<div><span class="tag easy">✓ Đã sửa theo AI</span></div>`;
  if (v.status === "kept") return `<div><span class="tag">Giữ đáp án file</span></div>`;
  return `<div><span class="tag" title="${esc(v.error)}">Lỗi kiểm tra</span></div>`;
}

$("#figureMsg").addEventListener("click", (e) => {
  if (!e.target.matches("[data-showmissing]")) return;
  e.preventDefault();
  $("#fFigure").value = "missing";
  loadBank(true);
});

$("#verifyMsg").addEventListener("click", (e) => {
  if (!e.target.matches("[data-showmismatch]")) return;
  e.preventDefault();
  $("#fVerify").value = "mismatch";
  loadBank(true);
});

$("#btnVerify").onclick = async () => {
  const ids = bank.filter((q) => !q.verify || q.verify.status === "error").map((q) => q.id);
  if (!ids.length) return alert("Các câu đang hiển thị đều đã được AI kiểm tra rồi.");
  if (!confirm(`AI sẽ tự giải lại ${ids.length} câu đang hiển thị (theo bộ lọc) mà không xem đáp án trong file, rồi đánh dấu những câu ra khác. Việc này dùng API (tính phí theo số câu). Tiếp tục?`)) return;
  const vm = $("#verifyMsg");
  vm.dataset.busy = "1";
  $("#btnVerify").disabled = true;
  let summary;
  try {
    const { jobId } = await api("/api/verify", { method: "POST", body: { ids } });
    summary = (await pollJob(jobId, vm)).message;
  } catch (err) {
    summary = `⚠ ${err.message}`;
  }
  delete vm.dataset.busy;
  $("#btnVerify").disabled = false;
  await loadStatus();
  await loadBank(true);
  vm.insertAdjacentHTML("afterbegin", `<div class="notice ok">${esc(summary)}</div>`);
};
for (const id of ["#fSection", "#fDifficulty", "#fSource", "#fVerify", "#fFigure"]) $(id).onchange = () => loadBank(true);
let qTimer;
$("#fQuery").oninput = () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => loadBank(true), 300);
};

$("#bankRows").addEventListener("click", async (e) => {
  const act = e.target.dataset.act;
  const id = e.target.closest("tr")?.dataset.id;
  if (!act || !id) return;
  const q = bank.find((x) => x.id === id);
  if (act === "del") {
    if (!confirm("Xoá câu hỏi này?")) return;
    await api(`/api/questions/${id}`, { method: "DELETE" });
    e.target.closest("tr").remove();
    loadStatus();
  }
  if (act === "view") editModal(q);
});

$("#btnClear").onclick = async () => {
  const src = $("#fSource").value;
  if (!confirm(src ? `Xoá mọi câu từ nguồn "${src}"?` : "Xoá TOÀN BỘ ngân hàng câu hỏi?")) return;
  await api(`/api/questions${src ? `?source=${encodeURIComponent(src)}` : ""}`, { method: "DELETE" });
  await loadStatus();
  loadBank(true);
};

const CONF = { high: "cao", medium: "trung bình", low: "thấp" };
function verifyPanel(q) {
  const v = q.verify;
  if (!v || v.status === "error") return "";
  const head =
    v.status === "mismatch"
      ? `<b>⚠ AI giải ra khác đáp án trong file</b><br>File: <b>${esc(v.fileAnswer || "(trống)")}</b> — AI: <b>${esc(v.aiAnswer)}</b> (độ tin cậy ${CONF[v.confidence] || v.confidence})`
      : v.status === "ok"
        ? `<b>✓ AI giải ra cùng đáp án ${esc(v.aiAnswer)}</b> (độ tin cậy ${CONF[v.confidence] || v.confidence})`
        : v.status === "resolved"
          ? `<b>Đã đổi sang đáp án AI (${esc(v.aiAnswer)})</b>, đáp án file cũ: ${esc(v.fileAnswer)}`
          : `<b>Đã giữ đáp án file (${esc(v.fileAnswer)})</b>, AI đề xuất: ${esc(v.aiAnswer)}`;
  return `<div class="notice ${v.status === "mismatch" ? "err" : "ok"}" id="verifyPanel">${head}
    <div class="pv-inline" style="margin-top:8px;color:var(--text)"><b>Lời giải của AI:</b> ${rich(v.aiExplanation)}</div>
    ${v.status === "mismatch" ? `<div class="row" style="margin-top:10px"><button class="btn small primary" data-resolve="ai">Dùng đáp án AI (${esc(v.aiAnswer)})</button><button class="btn small" data-resolve="file">Giữ đáp án file (${esc(v.fileAnswer || "trống")})</button></div>` : ""}
  </div>`;
}

// ---------------- Gắn ảnh cho câu hỏi ----------------
let imageQ = null; // câu đang mở trong hộp thoại
let imageChanged = false;

function paintImage(note = "") {
  const area = $("#imgArea");
  if (!area || !imageQ) return;
  const q = imageQ;
  area.innerHTML = `<div class="imgzone" id="imgZone">
      ${q.image ? `<img src="${esc(q.image)}" alt="Hình minh hoạ" />` : `<div style="font-size:26px">🖼</div>`}
      <div>${q.image ? "Dán ảnh khác bằng <b>Ctrl + V</b> để thay" : "Chụp hình trong PDF (<b>Win + Shift + S</b>), rồi bấm <b>Ctrl + V</b> ở đây để dán"}</div>
      <div class="row" style="justify-content:center;margin-top:8px">
        <button class="btn small" data-pickimg>Chọn file ảnh…</button>
        ${q.image ? `<button class="btn small danger" data-delimg>Xoá ảnh</button>` : ""}
      </div>
      ${q.figure && !q.image ? `<div style="margin-top:8px;font-size:13px">Hình cần có: ${esc(q.figure)}</div>` : ""}
      ${note ? `<div style="margin-top:8px">${note}</div>` : ""}
      <input type="file" id="imgFile" accept="image/png,image/jpeg,image/gif,image/webp" hidden />
    </div>`;
  $("#imgFile").onchange = (e) => e.target.files[0] && uploadImage(e.target.files[0]);
  const zone = $("#imgZone");
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.classList.add("drag");
  };
  zone.ondragleave = () => zone.classList.remove("drag");
  zone.ondrop = (e) => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (f) uploadImage(f);
  };
}

async function uploadImage(file) {
  paintImage("Đang tải ảnh lên…");
  const fd = new FormData();
  fd.append("image", file, file.name || "hinh.png");
  try {
    imageQ = await api(`/api/questions/${imageQ.id}/image`, { method: "POST", body: fd });
    imageChanged = true;
    paintImage(`<span style="color:var(--ok)">✓ Đã lưu ảnh</span>`);
  } catch (err) {
    paintImage(`<span style="color:var(--bad)">${esc(err.message)}</span>`);
  }
}

// Ctrl+V khi hộp thoại câu hỏi đang mở: nếu clipboard có ảnh thì gắn vào câu đó.
document.addEventListener("paste", (e) => {
  if (!$("#imgArea") || !imageQ) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (!file) return; // dán chữ vào ô nhập thì để bình thường
  e.preventDefault();
  uploadImage(file);
});

function editModal(q) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-back"><div class="modal">
    <div class="row between"><h2>Câu hỏi</h2><button class="btn small ghost" data-close>✕</button></div>
    <div class="card" style="box-shadow:none;margin-bottom:14px" id="preview">
      ${q.passage ? `<div>${rich(q.passage)}</div><hr style="border:none;border-top:1px solid #eee">` : ""}
      <div><b>${rich(q.prompt)}</b></div>
      ${q.choices.map((c, i) => `<div class="pv-inline">${"ABCD"[i]}) ${rich(c)}</div>`).join("")}
      ${q.explanation ? `<div class="notice ok" style="margin-top:10px"><b>Giải thích:</b> ${rich(q.explanation)}</div>` : ""}
    </div>
    <div class="field"><span class="label">Hình minh hoạ (đồ thị, hình vẽ, bảng dạng ảnh)</span><div id="imgArea"></div></div>
    ${verifyPanel(q)}
    <div class="row">
      <div class="field" style="flex:1"><label>Phần</label><select class="input" name="section"><option value="rw">Reading & Writing</option><option value="math">Math</option></select></div>
      <div class="field" style="flex:1"><label>Độ khó</label><select class="input" name="difficulty"><option value="easy">Dễ</option><option value="medium">Trung bình</option><option value="hard">Khó</option></select></div>
      <div class="field" style="flex:1"><label>Đáp án ${q.type === "spr" ? "(nhiều đáp án cách nhau |)" : "(A–D)"}</label><input class="input" name="answer" /></div>
    </div>
    <div class="field"><label>Domain</label><input class="input" name="domain" /></div>
    <div class="field"><label>Đoạn văn (passage)</label><textarea class="input" name="passage"></textarea></div>
    <div class="field"><label>Câu hỏi</label><textarea class="input" name="prompt"></textarea></div>
    ${q.type === "mcq" ? q.choices.map((c, i) => `<div class="field"><label>Đáp án ${"ABCD"[i]}</label><input class="input" name="choice${i}" /></div>`).join("") : ""}
    <div class="field"><label>Mô tả hình bằng chữ (Figure) — câu có mô tả mà chưa có ảnh sẽ hiện nhãn "Thiếu hình"</label><textarea class="input" name="figure" style="min-height:60px"></textarea></div>
    <div class="field"><label>Giải thích</label><textarea class="input" name="explanation"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Huỷ</button><button class="btn primary" data-save>Lưu</button></div>
  </div></div>`;
  const form = $(".modal", root);
  for (const k of ["section", "difficulty", "answer", "domain", "passage", "prompt", "figure", "explanation"]) form.querySelector(`[name=${k}]`).value = q[k] ?? "";
  imageQ = q;
  paintImage();
  q.choices.forEach((c, i) => (form.querySelector(`[name=choice${i}]`).value = c));
  renderMath($("#preview", root));
  if ($("#verifyPanel", root)) renderMath($("#verifyPanel", root));
  root.onclick = async (e) => {
    if (e.target.matches("[data-close], .modal-back")) {
      root.innerHTML = "";
      if (imageChanged) {
        loadBank(true);
        loadStatus();
      }
      imageChanged = false;
    }
    if (e.target.matches("[data-pickimg]")) $("#imgFile", root).click();
    if (e.target.matches("[data-delimg]")) {
      imageQ = await api(`/api/questions/${q.id}/image`, { method: "DELETE" });
      imageChanged = true;
      paintImage();
    }
    if (e.target.matches("[data-resolve]")) {
      await api(`/api/questions/${q.id}/resolve`, { method: "POST", body: { use: e.target.dataset.resolve } });
      root.innerHTML = "";
      loadStatus();
      loadBank(true);
      return;
    }
    if (e.target.matches("[data-save]")) {
      const body = {};
      for (const k of ["section", "difficulty", "answer", "domain", "passage", "prompt", "figure", "explanation"]) body[k] = form.querySelector(`[name=${k}]`).value;
      if (q.type === "mcq") body.choices = q.choices.map((_, i) => form.querySelector(`[name=choice${i}]`).value);
      body.answerSource = "file";
      await api(`/api/questions/${q.id}`, { method: "PUT", body });
      root.innerHTML = "";
      loadStatus();
      loadBank(true);
    }
  };
}

// ---------------- Lịch sử ----------------
async function loadHistory() {
  const list = await api("/api/results");
  const el = $("#historyList");
  if (!list.length) {
    el.innerHTML = `<div class="empty">Chưa có bài làm nào. <a href="#home">Làm đề ngay</a></div>`;
    return;
  }
  el.innerHTML = `<table class="list"><thead><tr><th>Ngày</th><th>Tổng</th><th>Reading & Writing</th><th>Math</th><th></th></tr></thead><tbody>
    ${list
      .map(
        (r) => `<tr><td>${fmtDate(r.createdAt)}</td><td><b style="font-size:18px">${r.total}</b></td>
        <td>${r.sections.rw ? `${r.sections.rw.score} <span class="muted">(${r.sections.rw.correct}/${r.sections.rw.count})</span>` : "—"}</td>
        <td>${r.sections.math ? `${r.sections.math.score} <span class="muted">(${r.sections.math.correct}/${r.sections.math.count})</span>` : "—"}</td>
        <td><a class="btn small" href="/result.html?id=${r.id}">Xem lại</a></td></tr>`
      )
      .join("")}</tbody></table>`;
}

// ---------------- Khởi động ----------------
await loadStatus();
route();
createTutor({
  home: true,
  enabled: status.aiEnabled,
  quick: ["Lên kế hoạch ôn SAT 8 tuần", "Mẹo làm Reading & Writing nhanh", "Các công thức Math hay gặp", "Cách dùng Desmos hiệu quả"],
});
