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

async function uploadFiles(files, { useAI = $("#upAi").checked } = {}) {
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f, f.name));
  fd.append("useAI", String(useAI));
  fd.append("section", $("#upSection").value);
  fd.append("difficulty", $("#upDifficulty").value);
  const msg = $("#uploadMsg");
  msg.innerHTML = `<div class="notice">Đang tải lên…</div>`;
  $("#btnUpload").disabled = true;
  try {
    const { jobId } = await api("/api/upload", { method: "POST", body: fd });
    for (;;) {
      const job = await api(`/api/jobs/${jobId}`);
      msg.innerHTML = `<div class="notice ${job.status === "done" ? (job.added || job.found ? "ok" : "err") : ""}">${esc(job.message)}</div>` +
        job.errors.map((e) => `<div class="notice err">${esc(e)}</div>`).join("");
      if (job.status === "done") break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    msg.innerHTML = `<div class="notice err">${esc(err.message)}</div>`;
  }
  $("#btnUpload").disabled = !pickedFiles.length;
  await loadStatus();
  loadBank(true);
}
$("#btnUpload").onclick = () => uploadFiles(pickedFiles);
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
  for (const [k, id] of [["section", "#fSection"], ["difficulty", "#fDifficulty"], ["source", "#fSource"], ["q", "#fQuery"]]) {
    if ($(id).value) params.set(k, $(id).value);
  }
  const data = await api(`/api/questions?${params}`);
  bank = data.questions;
  const cur = $("#fSource").value;
  $("#fSource").innerHTML = `<option value="">Mọi nguồn</option>` + data.sources.map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
  $("#bankTotal").textContent = `(${bank.length}/${data.counts.total})`;
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
      <td><div class="clip">${esc(q.prompt || q.passage)}</div><div class="muted" style="font-size:12px">${esc(q.domain)}${q.source ? " · " + esc(q.source) : ""}</div></td>
      <td>${esc(q.answer || "—")}${q.answerSource === "ai" ? ' <span class="tag" title="AI tự giải">AI</span>' : ""}</td>
      <td style="white-space:nowrap"><button class="btn small" data-act="view">Xem / sửa</button> <button class="btn small danger" data-act="del">Xoá</button></td>
    </tr>`
  );
  if (!bank.length) $("#bankRows").innerHTML = `<tr><td colspan="5" class="empty">Chưa có câu hỏi nào. Tải đề lên hoặc bấm "Nạp bộ câu mẫu".</td></tr>`;
  else $("#bankRows").insertAdjacentHTML("beforeend", rows.join(""));
  shown += PAGE;
  $("#bankMore").classList.toggle("hidden", shown >= bank.length);
}
$("#bankMore button").onclick = renderMore;
for (const id of ["#fSection", "#fDifficulty", "#fSource"]) $(id).onchange = () => loadBank(true);
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

function editModal(q) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-back"><div class="modal">
    <div class="row between"><h2>Câu hỏi</h2><button class="btn small ghost" data-close>✕</button></div>
    <div class="card" style="box-shadow:none;margin-bottom:14px" id="preview">
      ${q.passage ? `<div>${rich(q.passage)}</div><hr style="border:none;border-top:1px solid #eee">` : ""}
      ${q.figure ? `<div class="notice">Hình: ${esc(q.figure)}</div>` : ""}
      <div><b>${rich(q.prompt)}</b></div>
      ${q.choices.map((c, i) => `<div>${"ABCD"[i]}) ${rich(c)}</div>`).join("")}
      ${q.explanation ? `<div class="notice ok" style="margin-top:10px"><b>Giải thích:</b> ${rich(q.explanation)}</div>` : ""}
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>Phần</label><select class="input" name="section"><option value="rw">Reading & Writing</option><option value="math">Math</option></select></div>
      <div class="field" style="flex:1"><label>Độ khó</label><select class="input" name="difficulty"><option value="easy">Dễ</option><option value="medium">Trung bình</option><option value="hard">Khó</option></select></div>
      <div class="field" style="flex:1"><label>Đáp án ${q.type === "spr" ? "(nhiều đáp án cách nhau |)" : "(A–D)"}</label><input class="input" name="answer" /></div>
    </div>
    <div class="field"><label>Domain</label><input class="input" name="domain" /></div>
    <div class="field"><label>Đoạn văn (passage)</label><textarea class="input" name="passage"></textarea></div>
    <div class="field"><label>Câu hỏi</label><textarea class="input" name="prompt"></textarea></div>
    ${q.type === "mcq" ? q.choices.map((c, i) => `<div class="field"><label>Đáp án ${"ABCD"[i]}</label><input class="input" name="choice${i}" /></div>`).join("") : ""}
    <div class="field"><label>Giải thích</label><textarea class="input" name="explanation"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>Huỷ</button><button class="btn primary" data-save>Lưu</button></div>
  </div></div>`;
  const form = $(".modal", root);
  for (const k of ["section", "difficulty", "answer", "domain", "passage", "prompt", "explanation"]) form.querySelector(`[name=${k}]`).value = q[k] ?? "";
  q.choices.forEach((c, i) => (form.querySelector(`[name=choice${i}]`).value = c));
  renderMath($("#preview", root));
  root.onclick = async (e) => {
    if (e.target.matches("[data-close], .modal-back")) root.innerHTML = "";
    if (e.target.matches("[data-save]")) {
      const body = {};
      for (const k of ["section", "difficulty", "answer", "domain", "passage", "prompt", "explanation"]) body[k] = form.querySelector(`[name=${k}]`).value;
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
