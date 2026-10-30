// Tích hợp Claude: đọc đề từ file (PDF / văn bản), gia sư AI, sinh câu hỏi tương tự.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// Fallback phía server khi model từ chối một yêu cầu (an toàn, không cần tự chọn model dự phòng).
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

let client = null;
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!aiEnabled()) throw new Error("Chưa cấu hình ANTHROPIC_API_KEY — tính năng AI đang tắt.");
  client ??= new Anthropic();
  return client;
}

const QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "difficulty", "domain", "type", "passage", "prompt", "choices", "answer", "answerSource", "explanation", "figure"],
        properties: {
          section: { type: "string", enum: ["rw", "math"] },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          domain: { type: "string" },
          type: { type: "string", enum: ["mcq", "spr"] },
          passage: { type: "string" },
          prompt: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answer: { type: "string" },
          answerSource: { type: "string", enum: ["file", "ai"] },
          explanation: { type: "string" },
          figure: { type: "string" },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You convert SAT practice material into structured questions for a digital SAT practice app.

Rules for every question you output:
- section: "rw" for Reading and Writing, "math" for Math.
- type: "mcq" when there are answer choices (exactly 4, text only, without the "A)" letter prefix); "spr" for student-produced (grid-in) responses with "choices": [].
- passage: the text/stimulus shown on the left pane (RW passages, tables rendered as plain-text or markdown tables, poem lines, notes). Empty string if none. Math word problems put everything in "prompt".
- prompt: the question stem exactly as written.
- Write all math in LaTeX between $...$ (e.g. $\\frac{3}{4}x + 2 = 5$). Keep the original wording; never paraphrase.
- figure: if the question relies on a graph, diagram or image you cannot reproduce as text, describe it precisely enough to solve the question (axes, labeled points, values). Otherwise "".
- answer: for mcq the letter "A"-"D"; for spr the accepted answers separated by "|" (e.g. "3/4|0.75|.75"). If the file contains an answer key or answer explanations anywhere, use it and set answerSource "file". If not, solve the question carefully yourself and set answerSource "ai".
- explanation: a concise explanation in Vietnamese of why the answer is correct (use the file's explanation if provided, translated/condensed).
- difficulty: use the label from the file if present. Otherwise estimate like the College Board would: easy / medium / hard. Questions from a "harder Module 2" are usually medium or hard.
- domain: one of "Craft and Structure", "Information and Ideas", "Standard English Conventions", "Expression of Ideas" (RW) or "Algebra", "Advanced Math", "Problem-Solving and Data Analysis", "Geometry and Trigonometry" (Math).
- Skip directions pages, cover pages, answer sheets and anything that is not a question. Never invent questions that are not in the material.`;

async function structuredCall({ system, content, schema, effort, maxTokens = 64000 }) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    ...FALLBACK,
    output_config: { effort, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("AI từ chối xử lý yêu cầu này.");
  if (msg.stop_reason === "max_tokens") throw new Error("Nội dung quá dài, AI bị cắt ngang — hãy chia file nhỏ hơn.");
  return JSON.parse(msg.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
}

async function runExtraction(content) {
  const data = await structuredCall({ system: EXTRACT_SYSTEM, content, schema: QUESTION_SCHEMA, effort: "medium" });
  return data.questions ?? [];
}

// ---------------- Kiểm tra đáp án ----------------
const VERIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "explanation"],
  properties: {
    answer: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    explanation: { type: "string" },
  },
};

const VERIFY_SYSTEM = `You are an expert digital SAT solver checking an answer key. Solve the question yourself from scratch, carefully and rigorously (for Math, verify by substitution or a second method; for Reading and Writing, pick the choice that is fully supported by the text and conventions, eliminating the other three).
Return:
- answer: for multiple choice, the single letter A-D; for student-produced response, every acceptable entry separated by "|" (e.g. "2/3|.6666|.6667|0.666|0.667").
- confidence: "high" only if you are certain; "low" if the question is ambiguous, seems broken, or depends on a figure you cannot see.
- explanation: concise solution in Vietnamese (use LaTeX in $...$ for math), including why the most tempting wrong choice is wrong.`;

// AI giải lại câu hỏi mà KHÔNG được xem đáp án trong file, để không bị đáp án sai dẫn dắt.
export async function verifyQuestion(q) {
  const parts = [`Section: ${q.section === "math" ? "Math" : "Reading and Writing"}`];
  if (q.passage) parts.push(`Passage:\n${q.passage}`);
  if (q.figure) parts.push(`Figure description: ${q.figure}`);
  parts.push(`Question: ${q.prompt}`);
  if (q.type === "mcq") parts.push(q.choices.map((c, i) => `${"ABCD"[i]}) ${c}`).join("\n"));
  else parts.push("(Student-produced response: no answer choices.)");
  const content = [];
  if (q.image && /^https?:\/\//.test(q.image)) content.push({ type: "image", source: { type: "url", url: q.image } });
  content.push({ type: "text", text: parts.join("\n\n") });
  return structuredCall({ system: VERIFY_SYSTEM, content, schema: VERIFY_SCHEMA, effort: "high", maxTokens: 32000 });
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// PDF: gửi nguyên file (Claude đọc được công thức, bảng, hình) và chia theo khoảng trang
// để mỗi lần trả lời không quá dài. Khối PDF được cache nên các lần sau rẻ hơn.
export async function extractFromPdf(buffer, numPages, onProgress) {
  const data = buffer.toString("base64");
  const PAGES = 8;
  const ranges = [];
  for (let p = 1; p <= Math.max(1, numPages); p += PAGES) ranges.push([p, Math.min(numPages || p, p + PAGES - 1)]);
  let done = 0;
  const parts = await mapLimit(ranges, 3, async ([from, to]) => {
    const qs = await runExtraction([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: numPages
          ? `Extract every question that STARTS on pages ${from}-${to} of this PDF (a question that continues onto the next page still belongs here). You may look at any page (e.g. an answer key at the end) to find answers.`
          : "Extract every question in this PDF.",
      },
    ]);
    onProgress?.(++done, ranges.length);
    return qs;
  });
  return parts.flat();
}

// Văn bản dài: chia đoạn có chồng lấn, trùng lặp sẽ được loại bằng id băm.
export async function extractFromText(text, onProgress) {
  const SIZE = 30000;
  const OVERLAP = 2500;
  const chunks = [];
  for (let i = 0; i < text.length; i += SIZE - OVERLAP) {
    chunks.push(text.slice(i, i + SIZE));
    if (i + SIZE >= text.length) break;
  }
  const answerKey = text.length > SIZE ? text.slice(-6000) : "";
  let done = 0;
  const parts = await mapLimit(chunks, 3, async (chunk, i) => {
    const qs = await runExtraction([
      {
        type: "text",
        text:
          `Material (part ${i + 1}/${chunks.length}). Skip a question cut off at the very beginning or end of this part.\n\n<material>\n${chunk}\n</material>` +
          (answerKey && i < chunks.length - 1 ? `\n\nEnd of the full file (may contain the answer key):\n<file_end>\n${answerKey}\n</file_end>` : ""),
      },
    ]);
    onProgress?.(++done, chunks.length);
    return qs;
  });
  return parts.flat();
}

export async function generateSimilar(question, count = 3) {
  const base = JSON.stringify({
    section: question.section,
    difficulty: question.difficulty,
    domain: question.domain,
    type: question.type,
    passage: question.passage,
    prompt: question.prompt,
    choices: question.choices,
    answer: question.answer,
  });
  return runExtraction([
    {
      type: "text",
      text: `Write ${count} NEW original digital-SAT questions that test the same skill as this one, at the same or harder difficulty, in the same format (same section, domain and type). Use new passages/numbers; do not copy it. Set answerSource to "ai" and include a Vietnamese explanation.\n\n${base}`,
    },
  ]);
}

// ---------------- Gia sư AI ----------------
const TUTOR_SYSTEM = `Bạn là gia sư SAT (Digital SAT, Bluebook) thân thiện, nói tiếng Việt (giữ thuật ngữ tiếng Anh khi cần). Học sinh đang dùng web luyện đề.
- Trả lời ngắn gọn, rõ ràng, dùng markdown; công thức toán viết bằng LaTeX trong $...$.
- Dạy chiến thuật làm bài thật: loại trừ đáp án, đọc câu hỏi trước, dùng Desmos cho Math, quản lý thời gian (RW ~71 giây/câu, Math ~95 giây/câu).
- Khi phân tích một câu: chỉ ra dạng câu (domain/skill), bẫy thường gặp, và cách tư duy nhanh nhất.`;

const MODE_NOTE = {
  practice:
    "Học sinh ĐANG LÀM BÀI ở chế độ luyện tập. Chỉ gợi ý từng bước (hint), đặt câu hỏi dẫn dắt; KHÔNG nói thẳng đáp án đúng trừ khi học sinh yêu cầu rõ ràng và sau khi đã gợi ý ít nhất một lần.",
  review: "Học sinh đang XEM LẠI bài đã nộp. Có thể giải thích đầy đủ đáp án đúng, vì sao đáp án đã chọn sai, và mẹo cho lần sau.",
  general: "Học sinh hỏi chung về SAT hoặc kế hoạch ôn tập.",
};

function contextBlock(ctx) {
  if (ctx?.summary && !ctx.question) return `<student_results>\n${ctx.summary}\n</student_results>`;
  if (!ctx?.question) return "";
  const q = ctx.question;
  const lines = [`<current_question section="${q.section}" difficulty="${q.difficulty}" domain="${q.domain || ""}">`];
  if (q.passage) lines.push(`Passage:\n${q.passage}`);
  if (q.figure) lines.push(`Figure: ${q.figure}`);
  lines.push(`Question: ${q.prompt}`);
  if (q.choices?.length) lines.push(q.choices.map((c, i) => `${"ABCD"[i]}) ${c}`).join("\n"));
  if (ctx.mode === "review") {
    if (q.answer) lines.push(`Correct answer: ${q.answer}`);
    if (q.explanation) lines.push(`Explanation on file: ${q.explanation}`);
    lines.push(`Student answered: ${ctx.given || "(bỏ trống)"}`);
  } else if (ctx.given) {
    lines.push(`Student's current selection: ${ctx.given}`);
  }
  lines.push("</current_question>");
  return lines.join("\n");
}

export async function* tutorStream(history, ctx = {}) {
  const mode = MODE_NOTE[ctx.mode] ? ctx.mode : "general";
  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-20)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return;
  const last = messages[messages.length - 1];
  last.content = `${MODE_NOTE[mode]}\n${contextBlock(ctx)}\n\n${last.content}`;

  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "low" },
    system: TUTOR_SYSTEM,
    messages,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") yield "\n\n_(AI không thể trả lời yêu cầu này.)_";
}
