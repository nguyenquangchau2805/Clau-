// Chuẩn hoá câu hỏi và đọc đề từ các định dạng văn bản (JSON / TXT theo mẫu).
import crypto from "node:crypto";

export const SECTIONS = ["rw", "math"];
export const DIFFICULTIES = ["easy", "medium", "hard"];

export const RW_DOMAINS = [
  "Craft and Structure",
  "Information and Ideas",
  "Standard English Conventions",
  "Expression of Ideas",
];
export const MATH_DOMAINS = [
  "Algebra",
  "Advanced Math",
  "Problem-Solving and Data Analysis",
  "Geometry and Trigonometry",
];

const LETTERS = ["A", "B", "C", "D"];

function clean(s) {
  return String(s ?? "").replace(/\r\n?/g, "\n").trim();
}

export function normalizeSection(value) {
  const v = String(value ?? "").toLowerCase();
  if (/math|toán|toan/.test(v)) return "math";
  if (/rw|read|writ|verbal|english|đọc|doc|viết/.test(v)) return "rw";
  return null;
}

export function normalizeDifficulty(value) {
  const v = String(value ?? "").toLowerCase().trim();
  if (/^(e|easy|dễ|de|1)$/.test(v) || v.includes("easy") || v.includes("dễ")) return "easy";
  if (/^(h|hard|khó|kho|3)$/.test(v) || v.includes("hard") || v.includes("khó")) return "hard";
  if (/^(m|medium|trung bình|trung binh|tb|2)$/.test(v) || v.includes("med") || v.includes("trung")) return "medium";
  return null;
}

function guessSection(q) {
  const text = `${q.passage} ${q.prompt} ${q.choices.join(" ")}`;
  const mathSignals = (text.match(/[=+^√π]|\\frac|\$|\bx\b|\by\b|\d+\s*[x×*/]\s*\d+|equation|function|value of|graph|slope|triangle|radius/gi) || []).length;
  return mathSignals >= 3 && q.passage.length < 400 ? "math" : "rw";
}

// Đáp án chuẩn: MCQ -> "A".."D"; SPR -> chuỗi các đáp án chấp nhận được, ngăn bằng "|".
function normalizeAnswer(answer, type, choices) {
  if (Array.isArray(answer)) answer = answer.join("|");
  let a = clean(answer);
  if (type === "mcq") {
    const m = a.match(/^\(?([A-Da-d])\)?(?:[\s.):].*)?$/);
    if (m) return m[1].toUpperCase();
    const idx = choices.findIndex((c) => c.toLowerCase() === a.toLowerCase());
    return idx >= 0 ? LETTERS[idx] : "";
  }
  return a
    .split(/\s*(?:\||;|,(?!\d{3})|\bor\b|hoặc)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean)
    .join("|");
}

function hashId(q) {
  const key = [q.section, q.passage, q.prompt, ...q.choices]
    .join("\u0001")
    .toLowerCase()
    .replace(/\s+/g, " ");
  return "q_" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
}

export function normalizeQuestion(raw, defaults = {}) {
  if (!raw || typeof raw !== "object") return null;
  let choices = raw.choices ?? raw.options ?? raw.answers ?? [];
  if (!Array.isArray(choices) && typeof choices === "object") {
    choices = LETTERS.map((l) => choices[l] ?? choices[l.toLowerCase()]).filter((x) => x != null);
  }
  choices = choices.map((c) => clean(typeof c === "object" ? c.text ?? c.value : c).replace(/^\(?[A-D][).:]\s+/, ""));
  choices = choices.filter((c) => c !== "");

  const q = {
    passage: clean(raw.passage ?? raw.stimulus ?? raw.context ?? ""),
    prompt: clean(raw.prompt ?? raw.question ?? raw.stem ?? raw.text ?? ""),
    choices,
    figure: clean(raw.figure ?? ""),
    image: clean(raw.image ?? ""),
    explanation: clean(raw.explanation ?? raw.rationale ?? ""),
    domain: clean(raw.domain ?? raw.skill ?? raw.category ?? ""),
  };
  if (!q.prompt && !q.passage) return null;

  q.type = raw.type === "spr" || raw.type === "grid" || choices.length < 2 ? "spr" : "mcq";
  if (q.type === "mcq") q.choices = q.choices.slice(0, 4);
  else q.choices = [];
  q.section = normalizeSection(raw.section) || normalizeSection(defaults.section) || guessSection(q);
  q.difficulty = normalizeDifficulty(raw.difficulty) || normalizeDifficulty(defaults.difficulty) || "medium";
  q.answer = normalizeAnswer(raw.answer ?? raw.correct ?? raw.correctAnswer ?? raw.key ?? "", q.type, q.choices);
  q.answerSource = raw.answerSource === "ai" ? "ai" : "file";
  q.source = clean(raw.source ?? defaults.source ?? "");
  q.id = raw.id && String(raw.id).startsWith("q_") ? String(raw.id) : hashId(q);
  q.createdAt = raw.createdAt ?? new Date().toISOString();
  return q;
}

// ---------------- Đọc file JSON ----------------
export function parseJson(text, defaults) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.questions ?? data.items ?? [];
  return list.map((q) => normalizeQuestion(q, defaults)).filter(Boolean);
}

// ---------------- Đọc file văn bản theo mẫu ----------------
// Mỗi câu bắt đầu bằng một dòng "###" (tuỳ chọn kèm: RW | hard | domain), hoặc "Question 12" / "Câu 12".
const CHOICE_RE = /^\s*\(?([A-D])\s*[).:]\s*(.*)$/;
const ANSWER_RE = /^\s*(?:correct answer|answer|đáp án|dap an|key)\s*[:\-–]\s*(.+)$/i;
const EXPL_RE = /^\s*(?:explanation|rationale|giải thích|giai thich|lời giải)\s*[:\-–]\s*(.*)$/i;
const PASSAGE_RE = /^\s*(?:passage|đoạn văn|text)\s*[:\-–]\s*(.*)$/i;
const QUESTION_RE = /^\s*(?:question|câu hỏi|prompt)\s*[:\-–]\s*(.*)$/i;
const DIFF_RE = /^\s*(?:difficulty|độ khó|do kho|level)\s*[:\-–]\s*(.+)$/i;
const SECTION_RE = /^\s*(?:section|phần|phan)\s*[:\-–]\s*(.+)$/i;
const DOMAIN_RE = /^\s*(?:domain|skill|dạng)\s*[:\-–]\s*(.+)$/i;

function parseBlock(header, body, defaults) {
  const raw = { choices: [] };
  for (const token of header.split(/[|,\[\]]/).map((t) => t.trim()).filter(Boolean)) {
    if (!raw.section && normalizeSection(token) && token.length <= 20) raw.section = token;
    else if (!raw.difficulty && normalizeDifficulty(token)) raw.difficulty = token;
    else if (!/^(question|câu)?\s*\d+$/i.test(token)) raw.domain = token;
  }
  let mode = "prompt";
  const passage = [];
  const prompt = [];
  const expl = [];
  let sawQuestionLabel = false;
  for (const line of body.split("\n")) {
    let m;
    if ((m = line.match(ANSWER_RE))) { raw.answer = m[1].trim(); mode = "after"; continue; }
    if ((m = line.match(EXPL_RE))) { expl.push(m[1]); mode = "expl"; continue; }
    if ((m = line.match(DIFF_RE))) { raw.difficulty = m[1]; continue; }
    if ((m = line.match(SECTION_RE))) { raw.section = m[1]; continue; }
    if ((m = line.match(DOMAIN_RE))) { raw.domain = m[1]; continue; }
    if ((m = line.match(PASSAGE_RE))) { passage.push(m[1]); mode = "passage"; continue; }
    if ((m = line.match(QUESTION_RE))) { prompt.push(m[1]); mode = "prompt"; sawQuestionLabel = true; continue; }
    if (mode !== "expl" && mode !== "after" && (m = line.match(CHOICE_RE))) {
      raw.choices.push(m[2]);
      mode = "choice";
      continue;
    }
    if (mode === "choice" && line.trim() && raw.choices.length) {
      raw.choices[raw.choices.length - 1] += " " + line.trim();
    } else if (mode === "passage") passage.push(line);
    else if (mode === "prompt") prompt.push(line);
    else if (mode === "expl") expl.push(line);
  }
  raw.passage = passage.join("\n");
  raw.prompt = prompt.join("\n");
  // Không có nhãn "Question:" nhưng có "Passage:" -> đoạn cuối của passage là câu hỏi.
  if (!sawQuestionLabel && raw.passage && !raw.prompt.trim()) {
    const parts = raw.passage.trim().split(/\n\s*\n/);
    if (parts.length > 1) {
      raw.prompt = parts.pop();
      raw.passage = parts.join("\n\n");
    }
  }
  raw.explanation = expl.join("\n");
  // Văn bản từ file TXT/PDF thường bị ngắt dòng cứng: nối lại, giữ đoạn trống, gạch đầu dòng, bảng và "Text 1/2".
  const unwrap = (t) => t.replace(/([^\n])(?<!Text \d)\n(?!\n|\s*[•\-*|]|\s*Text \d)/g, "$1 ");
  raw.passage = unwrap(raw.passage);
  raw.prompt = unwrap(raw.prompt);
  if (raw.choices.length < 2) raw.type = "spr";
  return normalizeQuestion(raw, defaults);
}

export function parseStructuredText(text, defaults = {}) {
  text = clean(text);
  const lines = text.split("\n");
  const blocks = [];
  let current = null;
  const startRe = /^\s*(?:###+\s*(.*)|(?:question|câu)\s*(\d+)\s*[:.)\-]?\s*(.*))$/i;
  for (const line of lines) {
    const m = line.match(startRe);
    if (m && (m[1] !== undefined || m[2] !== undefined)) {
      if (current) blocks.push(current);
      current = { header: m[1] ?? "", body: m[3] ? [m[3]] : [] };
    } else if (current) {
      if (/^\s*-{3,}\s*$/.test(line)) continue;
      current.body.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks.map((b) => parseBlock(b.header, b.body.join("\n"), defaults)).filter(Boolean);
}

export function publicQuestion(q) {
  // Bản gửi xuống trình duyệt khi đang thi: không kèm đáp án / lời giải.
  const { answer, explanation, answerSource, ...rest } = q;
  return rest;
}
