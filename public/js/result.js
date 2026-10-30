import { api, $, $$, esc, rich, renderMath, fmtDate, createTutor, SECTION_NAME, DIFF_NAME } from "./common.js";

const resultId = new URLSearchParams(location.search).get("id");
const root = $("#root");
let r;
let current = null; // câu đang mở để AI có ngữ cảnh
let filter = "all";

function fmtSec(s) {
  s = Math.round(s || 0);
  return s >= 60 ? `${Math.floor(s / 60)}p${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function sectionCard(key, s) {
  const domains = Object.entries(s.domains)
    .map(([d, v]) => `<div style="margin:8px 0"><div class="row between" style="font-size:13px"><span>${esc(d)}</span><span>${v.correct}/${v.count}</span></div>
      <div class="bar"><i style="width:${(v.correct / v.count) * 100}%"></i></div></div>`)
    .join("");
  return `<section class="card">
    <div class="row between"><h2 style="margin:0">${SECTION_NAME[key]}</h2><span class="tag ${key}">${s.correct}/${s.count} đúng</span></div>
    <div class="score-sec" style="margin:10px 0"><b>${s.score}</b> <span class="muted">/ 800</span></div>
    <div class="row" style="gap:20px;margin-bottom:8px">${s.modules
      .map((m) => `<div class="stat"><b style="font-size:18px">${m.correct}/${m.count}</b><span>Module ${m.module}${m.module === 2 ? " (khó)" : ""}</span></div>`)
      .join("")}</div>
    ${domains}</section>`;
}

function itemHtml(q, i) {
  const status = !q.given ? "skip" : q.correct ? "ok" : "bad";
  const icon = { ok: "✓", bad: "✕", skip: "–" }[status];
  const opts =
    q.type === "mcq"
      ? q.choices
          .map((c, k) => {
            const L = "ABCD"[k];
            const cls = L === q.answer ? "correct" : L === q.given ? "wrong" : "";
            return `<div class="opt ${cls}"><b>${L})</b><span>${rich(c)}</span>${L === q.answer ? " ✓" : ""}${L === q.given && L !== q.answer ? " (bạn chọn)" : ""}</div>`;
          })
          .join("")
      : `<div class="opt ${q.correct ? "correct" : "wrong"}">Bạn nhập: <b>${esc(q.given || "(bỏ trống)")}</b></div><div class="opt correct">Đáp án chấp nhận: <b>${esc(q.answer.split("|").join(", "))}</b></div>`;
  return `<details class="qitem" data-i="${i}" data-status="${status}" data-section="${q.section}" data-marked="${r.marked.includes(q.id)}">
    <summary><span class="res ${status}">${icon}</span>
      <span style="flex:1;min-width:0"><b>${SECTION_NAME[q.section]} · M${q.module} · Câu ${q.num}</b>
        <span class="clip muted" style="font-size:13px">${esc((q.prompt || q.passage).slice(0, 160))}</span></span>
      <span class="tag ${q.difficulty}">${DIFF_NAME[q.difficulty]}</span>
      ${r.marked.includes(q.id) ? "🔖" : ""}
      <span class="muted" style="font-size:12px;width:48px;text-align:right">${fmtSec(r.timeSpent?.[q.id])}</span></summary>
    <div class="qbody">
      ${q.passage ? `<div class="passage">${rich(q.passage)}</div>` : ""}
      ${q.image ? `<img src="${esc(q.image)}" style="max-width:100%;max-height:420px" alt="figure" />` : q.figure ? `<div class="notice">Hình: ${rich(q.figure)}</div>` : ""}
      <p><b>${rich(q.prompt)}</b></p>
      ${opts}
      ${q.explanation ? `<div class="notice ok" style="margin-top:12px"><b>Giải thích${q.answerSource === "ai" ? " (AI)" : ""}:</b> ${rich(q.explanation)}</div>` : ""}
      <div class="row actions" style="margin-top:12px">
        <button class="btn small primary" data-ai="explain">✨ AI giải thích chi tiết</button>
        <button class="btn small" data-ai="trap">Vì sao mình sai?</button>
        <button class="btn small" data-ai="similar">＋ Tạo 3 câu tương tự vào ngân hàng</button>
        <span class="muted" data-sim></span>
      </div>
    </div></details>`;
}

function render() {
  const secs = Object.entries(r.sections);
  const numbered = [];
  const counter = {};
  for (const q of r.items) {
    const k = `${q.section}${q.module}`;
    counter[k] = (counter[k] || 0) + 1;
    numbered.push({ ...q, num: counter[k] });
  }
  r.items = numbered;
  const wrong = r.items.filter((q) => q.given && !q.correct).length;
  const skipped = r.items.filter((q) => !q.given).length;
  root.innerHTML = `
    <div class="grid two">
      <section class="card hero">
        <div class="sub" style="margin:0 0 8px">Kết quả ngày ${fmtDate(r.createdAt)}</div>
        <div class="row" style="align-items:flex-end;gap:10px"><span class="score-big">${r.total}</span><span style="color:#dfe4ff;margin-bottom:6px">/ ${secs.length * 800} (ước tính)</span></div>
        <p class="sub" style="margin-top:12px">Đúng ${r.items.length - wrong - skipped}/${r.items.length} · Sai ${wrong} · Bỏ trống ${skipped}. Module 2 trong đề này luôn là module khó nên điểm được tính có trọng số theo độ khó.</p>
        <div class="row"><a class="btn" href="/#home">Làm đề mới</a><a class="btn" style="background:transparent;color:#fff;border-color:#fff" href="/#history">Lịch sử</a></div>
      </section>
      ${secs.map(([k, s]) => sectionCard(k, s)).join("")}
    </div>
    <section class="card" style="margin-top:20px">
      <div class="row between" style="margin-bottom:12px"><h2 style="margin:0">Xem lại từng câu</h2>
        <div class="row filters">
          <button class="btn small on" data-f="all">Tất cả</button>
          <button class="btn small" data-f="bad">Sai</button>
          <button class="btn small" data-f="skip">Bỏ trống</button>
          <button class="btn small" data-f="marked">🔖 Đã đánh dấu</button>
        </div></div>
      <div id="items">${r.items.map(itemHtml).join("")}</div>
    </section>`;
  renderMath(root);
}

function applyFilter() {
  $$(".filters button").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
  $$(".qitem").forEach((el) => {
    const show =
      filter === "all" ||
      (filter === "bad" && el.dataset.status === "bad") ||
      (filter === "skip" && el.dataset.status === "skip") ||
      (filter === "marked" && el.dataset.marked === "true");
    el.classList.toggle("hidden", !show);
  });
}

root.addEventListener("click", async (e) => {
  const f = e.target.closest("[data-f]");
  if (f) {
    filter = f.dataset.f;
    return applyFilter();
  }
  const btn = e.target.closest("[data-ai]");
  if (!btn) return;
  const item = btn.closest(".qitem");
  current = r.items[Number(item.dataset.i)];
  tutor.refresh();
  const kind = btn.dataset.ai;
  if (kind === "explain") tutor.ask("Giải thích chi tiết câu này: cách làm nhanh nhất, vì sao đáp án đúng và vì sao từng đáp án còn lại sai.");
  if (kind === "trap") tutor.ask("Mình đã trả lời sai/bỏ trống câu này. Mình mắc bẫy gì và lần sau gặp dạng này nên làm thế nào?");
  if (kind === "similar") {
    const span = $("[data-sim]", item);
    btn.disabled = true;
    span.textContent = "AI đang soạn câu hỏi…";
    try {
      const res = await api("/api/ai/similar", { method: "POST", body: { resultId, questionId: current.id, count: 3 } });
      span.textContent = `Đã thêm ${res.added} câu mới vào ngân hàng — sẽ xuất hiện trong các đề sau.`;
    } catch (err) {
      span.textContent = `⚠️ ${err.message}`;
    }
    btn.disabled = false;
  }
});

root.addEventListener("toggle", (e) => {
  if (e.target.matches?.(".qitem") && e.target.open) {
    current = r.items[Number(e.target.dataset.i)];
    tutor.refresh();
  }
}, true);

function resultSummary() {
  if (!r) return "";
  const lines = [`Tổng điểm ước tính: ${r.total}`];
  for (const [k, s] of Object.entries(r.sections)) {
    lines.push(`${SECTION_NAME[k]}: ${s.score}/800, đúng ${s.correct}/${s.count}; ` + s.modules.map((m) => `Module ${m.module}: ${m.correct}/${m.count}`).join(", "));
    for (const [d, v] of Object.entries(s.domains)) lines.push(`  - ${d}: ${v.correct}/${v.count}`);
  }
  const byDiff = {};
  for (const q of r.items) {
    const b = (byDiff[q.difficulty] ??= { ok: 0, n: 0 });
    b.n++;
    if (q.correct) b.ok++;
  }
  lines.push("Theo độ khó: " + Object.entries(byDiff).map(([d, v]) => `${d} ${v.ok}/${v.n}`).join(", "));
  return lines.join("\n");
}

let tutor;
try {
  r = await api(`/api/results/${resultId}`);
  render();
} catch (err) {
  root.innerHTML = `<div class="empty">${esc(err.message)} <a href="/">Về trang chủ</a></div>`;
}
const status = await api("/api/status").catch(() => ({}));
tutor = createTutor({
  home: true,
  enabled: status.aiEnabled,
  getContext: () =>
    current
      ? { mode: "review", resultId, questionId: current.id, label: `${SECTION_NAME[current.section]} · Module ${current.module} · Câu ${current.num}` }
      : { mode: "general", label: "Kết quả bài thi", summary: resultSummary() },
  quick: (ctx) => (ctx.questionId ? ["Giải thích câu này", "Mẹo cho dạng câu này", "Từ vựng cần nhớ"] : ["Nhận xét điểm yếu của mình", "Kế hoạch ôn tiếp theo"]),
});
