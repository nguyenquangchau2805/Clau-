// "Xuất đề cho điện thoại": đóng gói một bài thi thành MỘT file .html tự chạy (không cần server, không cần mạng).
// Công thức được dựng sẵn bằng KaTeX ở server, ảnh được nhúng thẳng vào file.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import katex from "katex";
import { rich, esc } from "../public/js/common.js";
import { IMAGE_DIR } from "./store.js";
import { checkAnswer, scoreTest, WEIGHT } from "./testBuilder.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const KATEX_DIR = path.dirname(require.resolve("katex/dist/katex.min.css"));

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

const unescapeHtml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function tex(src, displayMode) {
  return katex.renderToString(unescapeHtml(src.replace(/<br>/g, " ")), { displayMode, throwOnError: false, output: "html" });
}

// Văn bản câu hỏi -> HTML đã dựng sẵn công thức.
export function richMath(text) {
  if (!text) return "";
  return rich(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => tex(t, true))
    .replace(/\$((?:\\\$|[^$\n])+?)\$/g, (_, t) => tex(t, false));
}

let katexCss = null;
// CSS của KaTeX với font nhúng (chỉ bản woff2) để công thức hiển thị đúng khi không có mạng.
function inlineKatexCss() {
  if (katexCss) return katexCss;
  const css = fs.readFileSync(path.join(KATEX_DIR, "katex.min.css"), "utf8");
  katexCss = css.replace(/src:url\(fonts\/([^)]+?)\.woff2\) format\("woff2"\)[^;}]*/g, (_, name) => {
    const data = fs.readFileSync(path.join(KATEX_DIR, "fonts", `${name}.woff2`)).toString("base64");
    return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
  });
  return katexCss;
}

function embedImage(src) {
  if (!src) return "";
  if (src.startsWith("/images/")) {
    const file = path.join(IMAGE_DIR, path.basename(src));
    const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
    if (!mime || !fs.existsSync(file)) return "";
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  }
  return src; // link ảnh trên mạng: giữ nguyên (cần mạng để hiện)
}

export function buildPhoneHtml(test) {
  const data = {
    id: test.id,
    createdAt: test.createdAt,
    timed: test.timed,
    instant: test.instant,
    breakSeconds: test.breakSeconds,
    modules: test.modules.map((m) => ({
      section: m.section,
      module: m.module,
      title: m.title,
      hard: m.hard,
      seconds: m.seconds,
      questions: m.questions.map((q) => ({
        id: q.id,
        type: q.type,
        section: q.section,
        difficulty: q.difficulty,
        domain: q.domain,
        answer: q.answer,
        passage: richMath(q.passage),
        prompt: richMath(q.prompt),
        choices: q.choices.map(richMath),
        figure: q.image ? "" : richMath(q.figure),
        image: embedImage(q.image),
        explanation: richMath(q.explanation),
      })),
    })),
  };
  const player = fs.readFileSync(path.join(here, "phone", "player.js"), "utf8");
  const css = fs.readFileSync(path.join(here, "phone", "player.css"), "utf8");
  const date = new Date(test.createdAt).toLocaleDateString("vi-VN");
  // Dùng chung đúng một logic chấm điểm với web chính.
  const scoring = `const WEIGHT = ${JSON.stringify(WEIGHT)};\n${checkAnswer.toString()}\n${scoreTest.toString()}`;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#324dc7" />
<title>${esc(`Đề SAT ${date}`)}</title>
<style>${inlineKatexCss()}</style>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<noscript><p style="padding:20px">File này cần chạy JavaScript. Hãy mở bằng Chrome (Android) hoặc Safari (iPhone), không mở bằng phần xem trước của Drive/Zalo.</p></noscript>
<script id="test-data" type="application/json">${json}</script>
<script>${scoring}</script>
<script>${player}</script>
</body>
</html>`;
}
