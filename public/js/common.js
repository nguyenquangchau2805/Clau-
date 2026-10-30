// Tiện ích dùng chung + khung chat AI.
export async function api(url, opts = {}) {
  const init = { ...opts };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Văn bản câu hỏi: giữ xuống dòng, hỗ trợ **đậm**, _gạch chân_ kiểu SAT (__từ__), bảng markdown đơn giản; công thức để KaTeX xử lý.
export function rich(text) {
  const lines = esc(text).split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      let html = "<table class='qtable'><thead><tr>" + row(lines[i]).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        html += "<tr>" + row(lines[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>";
        i++;
      }
      out.push(html + "</tbody></table>");
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+?)__/g, "<u>$1</u>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>")
    .replace(/<br>(<table)/g, "$1")
    .replace(/(<\/table>)<br>/g, "$1");
}

export function renderMath(el) {
  if (window.renderMathInElement) {
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  }
}

export function markdown(text) {
  // Bảo vệ công thức khỏi bị markdown phá trước khi render.
  const maths = [];
  const protectedText = String(text).replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (m) => `@@M${maths.push(m) - 1}@@`);
  let html = window.marked ? window.marked.parse(protectedText) : `<p>${esc(protectedText)}</p>`;
  if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
  return html.replace(/@@M(\d+)@@/g, (_, i) => esc(maths[i]));
}

export function fmtDate(iso) {
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export const SECTION_NAME = { rw: "Reading & Writing", math: "Math" };
export const DIFF_NAME = { easy: "Dễ", medium: "Trung bình", hard: "Khó" };

// ---------------- Chat AI ----------------
// getContext(): trả về { mode, questionId, testId, resultId, given, label } của câu đang xem.
export function createTutor({ getContext = () => ({}), home = false, enabled = true, quick = [] } = {}) {
  const fab = document.createElement("button");
  fab.className = "ai-fab" + (home ? " home" : "");
  fab.innerHTML = "✨ Trợ lý AI";
  const panel = document.createElement("div");
  panel.className = "ai-panel hidden" + (home ? " home" : "");
  panel.innerHTML = `
    <div class="ai-head"><span>✨</span><b>Trợ lý SAT</b>
      <button class="btn small ghost" data-act="clear" title="Xoá hội thoại">Làm mới</button>
      <button class="btn small ghost" data-act="close" title="Đóng">✕</button></div>
    <div class="ai-ctx"></div>
    <div class="ai-msgs"></div>
    <div class="ai-quick"></div>
    <form class="ai-form"><textarea placeholder="Hỏi gì cũng được… (Enter để gửi)"></textarea><button class="btn primary">Gửi</button></form>`;
  document.body.append(fab, panel);

  const msgsEl = $(".ai-msgs", panel);
  const ctxEl = $(".ai-ctx", panel);
  const input = $("textarea", panel);
  let history = [];
  let busy = false;

  function paintContext() {
    const ctx = getContext();
    ctxEl.textContent = ctx.label ? `Đang xem: ${ctx.label}` : "Hỏi chung về SAT";
    $(".ai-quick", panel).innerHTML = (typeof quick === "function" ? quick(ctx) : quick)
      .map((q) => `<button type="button">${esc(q)}</button>`)
      .join("");
  }

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = `ai-msg ${role}`;
    if (role === "user") div.textContent = text;
    else {
      div.innerHTML = markdown(text);
      renderMath(div);
    }
    msgsEl.append(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  function greet() {
    msgsEl.innerHTML = "";
    addMsg(
      "assistant",
      enabled
        ? "Chào bạn! Mình là trợ lý SAT. Bạn có thể hỏi về câu đang làm, chiến thuật, ngữ pháp, công thức Toán, hay nhờ lên kế hoạch ôn tập."
        : "AI chưa sẵn sàng: server chưa có `ANTHROPIC_API_KEY`, hoặc AI bị khoá ở chế độ thi thật."
    );
  }

  async function send(text) {
    if (!text.trim() || busy || !enabled) return;
    busy = true;
    history.push({ role: "user", content: text });
    addMsg("user", text);
    const bubble = addMsg("assistant", "");
    bubble.classList.add("typing");
    let acc = "";
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, context: getContext() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Lỗi ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        bubble.innerHTML = markdown(acc);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
      history.push({ role: "assistant", content: acc });
    } catch (err) {
      acc = `⚠️ ${err.message}`;
      history.pop();
    }
    bubble.classList.remove("typing");
    bubble.innerHTML = markdown(acc);
    renderMath(bubble);
    busy = false;
  }

  const open = () => {
    panel.classList.remove("hidden");
    fab.classList.add("hidden");
    paintContext();
    input.focus();
  };
  fab.onclick = open;
  panel.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") {
      panel.classList.add("hidden");
      fab.classList.remove("hidden");
    }
    if (act === "clear") {
      history = [];
      greet();
    }
    if (e.target.closest(".ai-quick button")) send(e.target.textContent);
  });
  $("form", panel).onsubmit = (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = "";
    send(t);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("form", panel).requestSubmit();
    }
  });
  greet();

  return {
    open,
    ask(text) {
      open();
      send(text);
    },
    refresh: paintContext,
    setEnabled(v) {
      enabled = v;
      fab.classList.toggle("hidden", !v);
      if (!v) panel.classList.add("hidden");
    },
  };
}
