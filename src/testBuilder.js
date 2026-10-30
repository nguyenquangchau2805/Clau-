// "Xào đề": tạo bài thi từ ngân hàng câu hỏi. Module 2 luôn là module khó.
import { RW_DOMAINS, MATH_DOMAINS } from "./questions.js";

export const FORMAT = {
  rw: { name: "Reading and Writing", perModule: 27, minutes: 32 },
  math: { name: "Math", perModule: 22, minutes: 35 },
};
export const BREAK_MINUTES = 10;

// Tỉ lệ độ khó mục tiêu.
const MODULE1_MIX = { easy: 0.33, medium: 0.34, hard: 0.33 };
const MODULE2_MIX = { easy: 0, medium: 0.3, hard: 0.7 };

function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Ưu tiên câu ít được dùng gần đây, sau đó ngẫu nhiên.
function byFreshness(list, usage, rand) {
  return shuffle(list, rand).sort((x, y) => (usage[x.id] ?? 0) - (usage[y.id] ?? 0));
}

function take(pool, n, used) {
  const out = [];
  for (const q of pool) {
    if (out.length >= n) break;
    if (!used.has(q.id)) {
      out.push(q);
      used.add(q.id);
    }
  }
  return out;
}

function pick(byDiff, count, mix, used, fallbackOrder) {
  const picked = [];
  const targets = Object.entries(mix).map(([d, r]) => [d, Math.round(count * r)]);
  let diff = count - targets.reduce((s, [, n]) => s + n, 0);
  // bù sai số làm tròn vào mức có tỉ lệ cao nhất
  targets.sort((a, b) => mix[b[0]] - mix[a[0]]);
  targets[0][1] += diff;
  for (const [d, n] of targets) picked.push(...take(byDiff[d], n, used));
  // thiếu câu ở mức nào thì lấy bù theo thứ tự ưu tiên
  for (const d of fallbackOrder) {
    if (picked.length >= count) break;
    picked.push(...take(byDiff[d], count - picked.length, used));
  }
  return picked;
}

const DIFF_RANK = { easy: 0, medium: 1, hard: 2 };

function orderModule(section, list, rand) {
  if (section === "rw") {
    // Giống đề thật: nhóm theo domain (Craft -> Information -> Conventions -> Expression)
    const rank = (q) => {
      const i = RW_DOMAINS.findIndex((d) => d.toLowerCase() === q.domain.toLowerCase());
      return i < 0 ? 1.5 : i;
    };
    return shuffle(list, rand).sort((a, b) => rank(a) - rank(b));
  }
  // Math: tăng dần độ khó, SPR rải trong đề
  return shuffle(list, rand).sort((a, b) => DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty]);
}

function shuffleChoices(q, rand) {
  if (q.type !== "mcq" || q.choices.length < 2) return q;
  // Không đảo nếu phương án nhắc tới phương án khác ("Both A and B", "None of the above"...)
  if (q.choices.some((c) => /\b(both|neither|all of the above|none of the above)\b/i.test(c))) return q;
  const letters = ["A", "B", "C", "D"];
  const order = shuffle(q.choices.map((_, i) => i), rand);
  const correctIdx = letters.indexOf(q.answer);
  return {
    ...q,
    choices: order.map((i) => q.choices[i]),
    answer: correctIdx >= 0 ? letters[order.indexOf(correctIdx)] : q.answer,
  };
}

export function buildTest(bank, opts = {}) {
  const {
    sections = ["rw", "math"],
    perModule = {},
    shuffleAnswerChoices = true,
    usage = {},
    rand = Math.random,
  } = opts;

  const modules = [];
  const warnings = [];
  for (const section of sections) {
    const fmt = FORMAT[section];
    const count = Math.max(1, Number(perModule[section]) || fmt.perModule);
    const pool = bank.filter((q) => q.section === section && (q.type === "spr" || q.answer));
    if (!pool.length) {
      warnings.push(`Ngân hàng chưa có câu ${fmt.name} nào.`);
      continue;
    }
    const byDiff = { easy: [], medium: [], hard: [] };
    for (const q of byFreshness(pool, usage, rand)) byDiff[q.difficulty].push(q);
    const used = new Set();

    // Module 2 chọn trước để giữ đủ câu khó cho nó.
    const hardNeeded = Math.round(count * MODULE2_MIX.hard);
    const m2 = pick(byDiff, count, MODULE2_MIX, used, ["hard", "medium", "easy"]);
    const m1 = pick(byDiff, count, MODULE1_MIX, used, ["medium", "easy", "hard"]);

    if (m2.filter((q) => q.difficulty === "hard").length < hardNeeded) {
      warnings.push(
        `${fmt.name}: chỉ có ${byDiff.hard.length} câu khó — Module 2 được bù bằng câu trung bình. Hãy tải thêm đề có câu khó.`
      );
    }
    if (m1.length < count || m2.length < count) {
      warnings.push(
        `${fmt.name}: ngân hàng có ${pool.length} câu, chưa đủ ${count * 2} câu cho 2 module — bài sẽ ngắn hơn đề thật.`
      );
    }
    const durationFactor = count / fmt.perModule;
    for (const [i, list] of [m1, m2].entries()) {
      if (!list.length) continue;
      modules.push({
        section,
        module: i + 1,
        title: `Section ${section === "rw" ? 1 : 2}, Module ${i + 1}: ${fmt.name}`,
        hard: i === 1,
        seconds: Math.round(fmt.minutes * 60 * Math.min(1, Math.max(durationFactor, list.length / fmt.perModule))),
        questions: orderModule(section, list, rand).map((q) => (shuffleAnswerChoices ? shuffleChoices(q, rand) : q)),
      });
    }
  }
  return { modules, warnings };
}

// --------------- Chấm điểm (ước tính) ---------------
const WEIGHT = { easy: 1, medium: 1.4, hard: 1.9 };

export function checkAnswer(q, given) {
  if (given == null || given === "") return false;
  if (q.type === "mcq") return String(given).toUpperCase() === q.answer;
  const toNum = (s) => {
    s = String(s).trim().replace(/\s+/g, "");
    if (/^-?\d*\.?\d+\/-?\d*\.?\d+$/.test(s)) {
      const [a, b] = s.split("/").map(Number);
      return b === 0 ? NaN : a / b;
    }
    return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
  };
  const g = toNum(given);
  return q.answer.split("|").some((ans) => {
    const a = toNum(ans);
    if (!Number.isNaN(a) && !Number.isNaN(g)) return Math.abs(a - g) < 1e-3 * Math.max(1, Math.abs(a)) ;
    return ans.trim().toLowerCase() === String(given).trim().toLowerCase();
  });
}

export function scoreTest(test, answers) {
  const sections = {};
  const items = [];
  for (const mod of test.modules) {
    const s = (sections[mod.section] ??= { earned: 0, total: 0, correct: 0, count: 0, modules: [], domains: {} });
    const m = { module: mod.module, correct: 0, count: mod.questions.length };
    for (const q of mod.questions) {
      const given = answers[q.id] ?? "";
      const ok = checkAnswer(q, given);
      const w = WEIGHT[q.difficulty] * (mod.hard ? 1.15 : 1);
      s.total += w;
      s.count++;
      const dKey = q.domain || "Khác";
      const d = (s.domains[dKey] ??= { correct: 0, count: 0 });
      d.count++;
      if (ok) {
        s.earned += w;
        s.correct++;
        m.correct++;
        d.correct++;
      }
      items.push({ ...q, section: mod.section, module: mod.module, given, correct: ok });
    }
    s.modules.push(m);
  }
  let total = 0;
  for (const s of Object.values(sections)) {
    const ratio = s.total ? s.earned / s.total : 0;
    s.score = Math.round((200 + 600 * Math.pow(ratio, 1.1)) / 10) * 10;
    total += s.score;
  }
  return { sections, total, items };
}
