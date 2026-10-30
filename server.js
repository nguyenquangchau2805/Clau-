import express from "express";
import { exec } from "node:child_process";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

import { questions, tests, results, IMAGE_DIR } from "./src/store.js";
import { normalizeQuestion, parseJson, parseStructuredText, publicQuestion, missingImage } from "./src/questions.js";
import { buildTest, scoreTest, checkAnswer, FORMAT, BREAK_MINUTES } from "./src/testBuilder.js";
import { aiEnabled, extractFromPdf, extractFromText, generateSimilar, tutorStream, verifyQuestion, mapLimit } from "./src/ai.js";

// Tự đọc API key từ file .env (nếu có) để không phải gõ lệnh mỗi lần chạy.
try {
  process.loadEnvFile?.(".env");
} catch {}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 20 } });
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.resolve("public")));
app.use("/images", express.static(IMAGE_DIR, { maxAge: "30d", immutable: true }));
// Thư viện hiển thị công thức / markdown phục vụ trực tiếp từ node_modules (không phụ thuộc CDN).
app.use("/vendor/katex", express.static(path.resolve("node_modules/katex/dist")));
app.use("/vendor/marked", express.static(path.resolve("node_modules/marked")));
app.use("/vendor/dompurify", express.static(path.resolve("node_modules/dompurify/dist")));

const newId = (p) => `${p}_${crypto.randomBytes(6).toString("hex")}`;

// ---------------- Ảnh minh hoạ (hình, đồ thị) ----------------
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const MIME_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const isImageFile = (name) => Boolean(IMAGE_TYPES[path.extname(name).toLowerCase()]);
const fileName = (file) => Buffer.from(file.originalname, "latin1").toString("utf8");

// Lưu ảnh theo mã băm nội dung (ảnh trùng chỉ lưu 1 lần), trả về đường dẫn để hiển thị.
function saveImage(buffer, ext) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const name = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 16) + ext;
  const full = path.join(IMAGE_DIR, name);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buffer);
  return `/images/${name}`;
}

function counts() {
  const c = { total: 0, mismatch: 0, missingImage: 0, rw: { easy: 0, medium: 0, hard: 0 }, math: { easy: 0, medium: 0, hard: 0 } };
  for (const q of questions.all()) {
    c.total++;
    if (q.verify?.status === "mismatch") c.mismatch++;
    if (missingImage(q)) c.missingImage++;
    c[q.section][q.difficulty]++;
  }
  return c;
}

app.get("/api/status", (req, res) => {
  res.json({ aiEnabled: aiEnabled(), counts: counts(), format: FORMAT, breakMinutes: BREAK_MINUTES });
});

// ---------------- Ngân hàng câu hỏi ----------------
app.get("/api/questions", (req, res) => {
  const { section, difficulty, q, source, verify, figure } = req.query;
  let list = questions.all();
  if (figure === "missing") list = list.filter(missingImage);
  else if (figure === "has") list = list.filter((x) => x.image);
  if (verify === "unchecked") list = list.filter((x) => !x.verify || x.verify.status === "error");
  else if (verify === "ok") list = list.filter((x) => ["ok", "resolved", "kept"].includes(x.verify?.status));
  else if (verify) list = list.filter((x) => x.verify?.status === verify);
  if (section) list = list.filter((x) => x.section === section);
  if (difficulty) list = list.filter((x) => x.difficulty === difficulty);
  if (source) list = list.filter((x) => x.source === source);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((x) => `${x.passage} ${x.prompt} ${x.domain}`.toLowerCase().includes(needle));
  }
  const sources = [...new Set(questions.all().map((x) => x.source).filter(Boolean))];
  res.json({ questions: list, sources, counts: counts() });
});

app.get("/api/questions/export", (req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="sat-question-bank.json"');
  res.json({ questions: questions.all() });
});

app.post("/api/questions", (req, res) => {
  const q = normalizeQuestion(req.body, { source: "Nhập tay" });
  if (!q) return res.status(400).json({ error: "Câu hỏi không hợp lệ." });
  questions.upsertMany([q]);
  res.json(q);
});

app.put("/api/questions/:id", (req, res) => {
  const existing = questions.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Không tìm thấy câu hỏi." });
  const merged = normalizeQuestion({ ...existing, ...req.body, id: existing.id });
  // Sửa đáp án tay thì kết quả kiểm tra cũ không còn giá trị.
  merged.verify = existing.verify && existing.answer === merged.answer ? existing.verify : null;
  res.json(questions.update(existing.id, merged));
});

// Chọn giữa đáp án của file và đáp án AI sau khi kiểm tra.
app.post("/api/questions/:id/resolve", (req, res) => {
  const q = questions.get(req.params.id);
  if (!q?.verify) return res.status(404).json({ error: "Câu này chưa được AI kiểm tra." });
  if (req.body.use === "ai") {
    const fixed = normalizeQuestion({ ...q, answer: q.verify.aiAnswer, explanation: q.verify.aiExplanation, answerSource: "ai" });
    return res.json(questions.update(q.id, { answer: fixed.answer, explanation: fixed.explanation, answerSource: "ai", verify: { ...q.verify, status: "resolved" } }));
  }
  res.json(questions.update(q.id, { verify: { ...q.verify, status: "kept" } }));
});

// ---------------- AI kiểm tra đáp án ----------------
function compareAnswers(q, aiAnswer) {
  if (!q.answer) return "mismatch";
  if (q.type === "mcq") return q.answer === aiAnswer.trim().toUpperCase().replace(/[^A-D]/g, "").slice(0, 1) ? "ok" : "mismatch";
  return aiAnswer.split("|").some((a) => checkAnswer(q, a)) ? "ok" : "mismatch";
}

async function verifyMany(ids, job) {
  const list = ids.map((id) => questions.get(id)).filter(Boolean);
  let done = 0;
  job.verify = { total: list.length, checked: 0, mismatch: 0, errors: 0 };
  await mapLimit(list, 4, async (q) => {
    let verify;
    try {
      const r = await verifyQuestion(q);
      const aiAnswer = q.type === "mcq" ? r.answer.trim().toUpperCase().replace(/[^A-D]/g, "").slice(0, 1) : r.answer.trim();
      verify = { status: compareAnswers(q, r.answer), fileAnswer: q.answer, aiAnswer, confidence: r.confidence, aiExplanation: r.explanation, at: new Date().toISOString() };
      if (verify.status === "mismatch") job.verify.mismatch++;
    } catch (err) {
      verify = { status: "error", error: err.message, at: new Date().toISOString() };
      job.verify.errors++;
    }
    questions.update(q.id, { verify });
    job.verify.checked = ++done;
    job.message = `AI đã kiểm tra ${done}/${list.length} câu — ${job.verify.mismatch} câu nghi sai đáp án.`;
  });
}

app.post("/api/verify", (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ error: "AI chưa được bật. Thêm ANTHROPIC_API_KEY rồi chạy lại server." });
  const { ids = [], force = false } = req.body || {};
  const todo = ids.filter((id) => {
    const q = questions.get(id);
    return q && (force || !q.verify || q.verify.status === "error");
  });
  if (!todo.length) return res.status(400).json({ error: "Không có câu nào cần kiểm tra (các câu đã được kiểm tra trước đó)." });
  const job = { id: newId("job"), status: "running", message: "AI đang giải lại các câu…", added: 0, found: 0, errors: [] };
  jobs.set(job.id, job);
  verifyMany(todo, job)
    .catch((err) => job.errors.push(err.message))
    .finally(() => {
      job.status = "done";
      job.message = `Đã kiểm tra ${job.verify.checked} câu: ${job.verify.mismatch} câu nghi sai đáp án${job.verify.errors ? `, ${job.verify.errors} câu lỗi` : ""}.`;
    });
  res.json({ jobId: job.id, count: todo.length });
});

// Gắn ảnh cho câu hỏi: dán ảnh chụp màn hình (Ctrl+V) hoặc chọn file trong trang Ngân hàng đề.
app.post("/api/questions/:id/image", upload.single("image"), (req, res) => {
  const q = questions.get(req.params.id);
  if (!q) return res.status(404).json({ error: "Không tìm thấy câu hỏi." });
  const ext = MIME_EXT[req.file?.mimetype];
  if (!ext) return res.status(400).json({ error: "Chỉ nhận ảnh PNG, JPG, GIF hoặc WEBP." });
  if (req.file.size > 8 * 1024 * 1024) return res.status(400).json({ error: "Ảnh quá lớn (tối đa 8MB)." });
  res.json(questions.update(q.id, { image: saveImage(req.file.buffer, ext) }));
});

app.delete("/api/questions/:id/image", (req, res) => {
  const q = questions.get(req.params.id);
  if (!q) return res.status(404).json({ error: "Không tìm thấy câu hỏi." });
  res.json(questions.update(q.id, { image: "" }));
});

app.delete("/api/questions/:id", (req, res) => {
  res.json({ removed: questions.remove((x) => x.id === req.params.id) });
});

app.delete("/api/questions", (req, res) => {
  const { source } = req.query;
  res.json({ removed: questions.remove((x) => !source || x.source === source) });
});

// ---------------- Tải đề lên ----------------
const jobs = new Map();

async function processFile(file, opts, job) {
  const name = Buffer.from(file.originalname, "latin1").toString("utf8");
  const ext = path.extname(name).toLowerCase();
  const defaults = { source: name, section: opts.section || undefined, difficulty: opts.difficulty || undefined };
  const progress = (d, t) => (job.message = `${name}: AI đang đọc phần ${d}/${t}…`);
  const fromAi = (list) => list.map((q) => normalizeQuestion(q, defaults)).filter(Boolean);

  if (ext === ".json") return parseJson(file.buffer.toString("utf8"), defaults);

  if (ext === ".pdf") {
    const parsed = await pdfParse(file.buffer).catch(() => ({ text: "", numpages: 0 }));
    if (opts.useAI && aiEnabled()) {
      if (file.buffer.length > 30 * 1024 * 1024) throw new Error(`${name}: PDF nặng hơn 30MB, AI không đọc được. Hãy nén PDF hoặc tách thành nhiều file.`);
      return fromAi(await extractFromPdf(file.buffer, parsed.numpages, progress));
    }
    const qs = parseStructuredText(parsed.text, defaults);
    if (!qs.length) {
      throw new Error(
        `${name}: không nhận ra câu hỏi vì file không viết theo định dạng mẫu. Cách miễn phí: bấm "📋 Sao chép prompt chuyển đề" ở khung bên phải và nhờ claude.ai chuyển đề; hoặc thêm API key rồi tick "Dùng AI đọc đề".`
      );
    }
    return qs;
  }

  let text;
  if (ext === ".docx") text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  else if ([".txt", ".md", ".csv", ".text"].includes(ext)) text = file.buffer.toString("utf8");
  else throw new Error(`${name}: định dạng ${ext || "?"} chưa hỗ trợ (dùng PDF, DOCX, TXT, MD, JSON).`);

  const structured = parseStructuredText(text, defaults);
  // Nếu file đúng mẫu thì không cần AI; nếu không, nhờ AI đọc.
  if (structured.length && (!opts.useAI || structured.every((q) => q.answer))) return structured;
  if (opts.useAI && aiEnabled()) return fromAi(await extractFromText(text, progress));
  if (structured.length) return structured;
  throw new Error(`${name}: không nhận ra câu hỏi. Hãy dùng file mẫu hoặc bật AI.`);
}

app.post("/api/upload", upload.array("files"), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Chưa chọn file." });
  const opts = {
    useAI: req.body.useAI !== "false",
    verify: req.body.verify === "true",
    section: req.body.section || "",
    difficulty: req.body.difficulty || "",
  };
  const job = { id: newId("job"), status: "running", message: "Đang xử lý…", added: 0, found: 0, errors: [] };
  jobs.set(job.id, job);
  (async () => {
    const ids = [];
    // Ảnh tải lên cùng file đề: câu nào ghi "Image: ten-anh.png" sẽ được gắn ảnh đó.
    const images = new Map();
    for (const file of req.files.filter((f) => isImageFile(fileName(f)))) {
      const name = fileName(file);
      images.set(name.toLowerCase(), saveImage(file.buffer, path.extname(name).toLowerCase().replace(".jpeg", ".jpg")));
    }
    const docs = req.files.filter((f) => !isImageFile(fileName(f)));
    if (!docs.length) job.errors.push("Chỉ có ảnh mà không có file đề. Hãy chọn cả file đề (.txt/.json) có dòng Image: cùng lúc với ảnh.");
    for (const file of docs) {
      try {
        const qs = await processFile(file, opts, job);
        for (const q of qs) {
          if (!q.image || /^(https?:|data:|\/images\/)/.test(q.image)) continue;
          const url = images.get(path.basename(q.image).toLowerCase());
          if (!url) job.errors.push(`Không thấy ảnh "${q.image}" — hãy chọn file ảnh này cùng lúc với file đề.`);
          q.image = url || "";
        }
        job.found += qs.length;
        job.added += questions.upsertMany(qs);
        ids.push(...qs.map((q) => q.id));
      } catch (err) {
        job.errors.push(err.message || String(err));
      }
    }
    let msg = `Đã đọc ${job.found} câu, thêm mới ${job.added} câu vào ngân hàng.`;
    // Kiểm tra đáp án lấy từ file (câu do AI tự giải thì đã là đáp án AI).
    const toVerify = ids.filter((id) => questions.get(id)?.answerSource === "file" && !questions.get(id)?.verify);
    if (opts.verify && aiEnabled() && toVerify.length) {
      try {
        await verifyMany(toVerify, job);
        msg += ` AI kiểm tra ${job.verify.checked} câu: ${job.verify.mismatch} câu nghi sai đáp án.`;
      } catch (err) {
        job.errors.push(err.message);
      }
    }
    job.status = "done";
    job.message = msg;
  })();
  res.json({ jobId: job.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Không tìm thấy tiến trình." });
  res.json(job);
});

// ---------------- Bài thi ----------------
app.post("/api/tests", (req, res) => {
  const { sections = ["rw", "math"], perModule = {}, shuffleChoices = true, timed = true, aiHelp = false, name = "" } = req.body || {};
  const usage = {};
  for (const t of tests.all()) for (const m of t.modules) for (const q of m.questions) usage[q.id] = (usage[q.id] ?? 0) + 1;
  const { modules, warnings } = buildTest(questions.all(), {
    sections: sections.filter((s) => FORMAT[s]),
    perModule,
    shuffleAnswerChoices: shuffleChoices,
    usage,
  });
  if (!modules.length) return res.status(400).json({ error: warnings.join(" ") || "Ngân hàng đề trống." });
  const test = { id: newId("t"), createdAt: new Date().toISOString(), timed, aiHelp, name, modules, warnings };
  tests.upsertMany([test]);
  res.json(publicTest(test));
});

function publicTest(t) {
  return { ...t, breakSeconds: BREAK_MINUTES * 60, modules: t.modules.map((m) => ({ ...m, questions: m.questions.map(publicQuestion) })) };
}

app.get("/api/tests/:id", (req, res) => {
  const t = tests.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Không tìm thấy bài thi." });
  res.json(publicTest(t));
});

app.post("/api/tests/:id/submit", (req, res) => {
  const t = tests.get(req.params.id);
  if (!t) return res.status(404).json({ error: "Không tìm thấy bài thi." });
  const { answers = {}, marked = [], timeSpent = {} } = req.body || {};
  const scored = scoreTest(t, answers);
  const result = {
    id: newId("r"),
    testId: t.id,
    createdAt: new Date().toISOString(),
    name: t.name,
    marked,
    timeSpent,
    ...scored,
  };
  results.upsertMany([result]);
  res.json({ id: result.id });
});

app.get("/api/results", (req, res) => {
  res.json(
    results
      .all()
      .map(({ items, ...r }) => r)
      .reverse()
  );
});

app.get("/api/results/:id", (req, res) => {
  const r = results.get(req.params.id);
  if (!r) return res.status(404).json({ error: "Không tìm thấy kết quả." });
  res.json(r);
});

app.delete("/api/results/:id", (req, res) => {
  res.json({ removed: results.remove((x) => x.id === req.params.id) });
});

// ---------------- AI ----------------
// Trong lúc thi, trình duyệt chỉ gửi questionId; server tự lấy nội dung (và chỉ kèm đáp án khi đang xem lại bài).
function questionContext(ctx = {}) {
  if (!ctx.questionId) return { mode: ctx.mode, summary: ctx.summary ? String(ctx.summary).slice(0, 4000) : "" };
  let q = questions.get(ctx.questionId);
  if (ctx.resultId) {
    const r = results.get(ctx.resultId);
    q = r?.items.find((x) => x.id === ctx.questionId) ?? q;
  } else if (ctx.testId) {
    const t = tests.get(ctx.testId);
    if (t && !t.aiHelp) return { blocked: true };
    q = t?.modules.flatMap((m) => m.questions).find((x) => x.id === ctx.questionId) ?? q;
  }
  return { mode: ctx.resultId ? "review" : ctx.mode, question: q, given: ctx.given };
}

app.post("/api/ai/chat", async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ error: "AI chưa được bật. Thêm ANTHROPIC_API_KEY vào môi trường rồi chạy lại server." });
  const ctx = questionContext(req.body.context);
  if (ctx.blocked) return res.status(403).json({ error: "AI bị khoá trong chế độ thi thật." });
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  try {
    for await (const chunk of tutorStream(req.body.messages || [], ctx)) res.write(chunk);
  } catch (err) {
    res.write(`\n\n⚠️ Lỗi AI: ${err.message}`);
  }
  res.end();
});

app.post("/api/ai/similar", async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ error: "AI chưa được bật." });
  const { questionId, resultId, count = 3 } = req.body || {};
  const q = results.get(resultId)?.items.find((x) => x.id === questionId) ?? questions.get(questionId);
  if (!q) return res.status(404).json({ error: "Không tìm thấy câu hỏi gốc." });
  try {
    const list = (await generateSimilar(q, Math.min(10, Number(count) || 3)))
      .map((x) => normalizeQuestion(x, { source: "AI tạo thêm" }))
      .filter(Boolean);
    const added = questions.upsertMany(list);
    res.json({ added, questions: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lỗi upload (file quá lớn...) trả về thông báo dễ hiểu thay vì trang lỗi.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File quá lớn (tối đa 100MB). Hãy nén hoặc tách file." : `Lỗi tải file: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Lỗi server." });
});

// Một file hỏng không được làm sập cả web.
process.on("uncaughtException", (err) => console.error("Lỗi không mong muốn:", err));
process.on("unhandledRejection", (err) => console.error("Lỗi không mong muốn:", err));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`SAT Practice đang chạy tại http://localhost:${PORT}`);
  if (!aiEnabled()) console.log("⚠️  Chưa có ANTHROPIC_API_KEY: các tính năng AI sẽ tắt.");
  console.log("Đóng cửa sổ này (hoặc bấm Ctrl + C) để tắt web.");
  if (process.env.OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
