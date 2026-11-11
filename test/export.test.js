import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseJson } from "../src/questions.js";
import { buildTest } from "../src/testBuilder.js";
import { buildPhoneHtml, richMath } from "../src/exportTest.js";

const bank = parseJson(fs.readFileSync("public/sample/sample-bank.json", "utf8"));

test("math is pre-rendered, including escaped dollar signs", () => {
  const html = richMath("costs $\\$40$ and $x^2 < 3$");
  assert.equal((html.match(/class="katex"/g) || []).length, 2);
  const text = html.replace(/<[^>]+>/g, "");
  assert.ok(text.includes("costs $40"), text);
  assert.ok(!text.includes("$x") && !text.includes("\\$"), text);
});

test("phone export is a single self-contained file", () => {
  const t = buildTest(bank, { perModule: { rw: 3, math: 3 } });
  const html = buildPhoneHtml({ id: "t_x", createdAt: new Date().toISOString(), timed: true, instant: false, breakSeconds: 600, ...t });
  assert.ok(!/<(script|link)[^>]+(src|href)=/i.test(html), "no external scripts or stylesheets");
  assert.match(html, /font\/woff2;base64/);
  assert.match(html, /function checkAnswer/);
  assert.match(html, /function scoreTest/);
  const data = JSON.parse(html.match(/<script id="test-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.modules.length, 4);
  assert.ok(data.modules.every((m) => m.questions.every((q) => q.answer)));
});
