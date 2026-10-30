import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseJson, parseStructuredText } from "../src/questions.js";
import { buildTest, scoreTest, checkAnswer } from "../src/testBuilder.js";

const bank = parseJson(fs.readFileSync("public/sample/sample-bank.json", "utf8"));

test("sample bank parses fully", () => {
  assert.equal(bank.length, 55);
  assert.ok(bank.every((q) => q.type === "spr" || /^[A-D]$/.test(q.answer)));
});

test("text template parses mcq and spr", () => {
  const qs = parseStructuredText(fs.readFileSync("public/sample/sample-format.txt", "utf8"));
  assert.equal(qs.length, 4);
  assert.equal(qs[0].section, "rw");
  assert.equal(qs[0].difficulty, "medium");
  assert.equal(qs[0].answer, "B");
  assert.match(qs[0].passage, /Copenhagen/);
  assert.match(qs[0].prompt, /most logical/);
  assert.equal(qs[3].type, "spr");
  assert.equal(qs[3].answer, "9");
  assert.equal(qs[3].section, "math");
});

test("module 2 is always the hard module and has no overlap with module 1", () => {
  const big = [];
  for (let i = 0; i < 4; i++) big.push(...bank.map((q) => ({ ...q, id: q.id + i })));
  const { modules } = buildTest(big, { perModule: { rw: 27, math: 22 } });
  assert.equal(modules.length, 4);
  for (const section of ["rw", "math"]) {
    const [m1, m2] = modules.filter((m) => m.section === section);
    assert.ok(m2.hard && !m1.hard);
    assert.equal(m2.questions.filter((q) => q.difficulty === "easy").length, 0);
    const hard2 = m2.questions.filter((q) => q.difficulty === "hard").length;
    const hard1 = m1.questions.filter((q) => q.difficulty === "hard").length;
    assert.ok(hard2 > hard1, `${section}: m2 hard ${hard2} <= m1 hard ${hard1}`);
    const ids = new Set(m1.questions.map((q) => q.id));
    assert.ok(m2.questions.every((q) => !ids.has(q.id)));
  }
});

test("choice shuffling keeps the correct answer text", () => {
  const { modules } = buildTest(bank, { sections: ["rw"], perModule: { rw: 10 } });
  for (const q of modules.flatMap((m) => m.questions)) {
    const orig = bank.find((b) => b.id === q.id);
    assert.equal(q.choices["ABCD".indexOf(q.answer)], orig.choices["ABCD".indexOf(orig.answer)]);
  }
});

test("spr answers accept equivalent forms and scoring is bounded", () => {
  const q = { type: "spr", answer: "5/13|.3846" };
  assert.ok(checkAnswer(q, "5/13"));
  assert.ok(checkAnswer(q, "0.3846"));
  assert.ok(!checkAnswer(q, "0.38"));
  const t = buildTest(bank, { perModule: { rw: 5, math: 5 } });
  const all = Object.fromEntries(t.modules.flatMap((m) => m.questions).map((q) => [q.id, q.type === "mcq" ? q.answer : q.answer.split("|")[0]]));
  assert.equal(scoreTest(t, all).total, 1600);
  assert.equal(scoreTest(t, {}).total, 400);
});

test("text pasted from a chat code block ignores the fences", () => {
  const qs = parseStructuredText("```\n### Math | hard | Algebra\nQuestion: If $x+1=3$, what is $x$?\nAnswer: 2\nExplanation: x = 2\n```\n");
  assert.equal(qs.length, 1);
  assert.equal(qs[0].explanation, "x = 2");
});

test("template supports Figure: and Image: lines", () => {
  const qs = parseStructuredText("### Math | hard | Advanced Math\nFigure: Parabola, vertex (2, 5)\nImage: cau12.png\nQuestion: What is the maximum value of f?\nAnswer: 5");
  assert.equal(qs[0].figure, "Parabola, vertex (2, 5)");
  assert.equal(qs[0].image, "cau12.png");
  assert.match(qs[0].prompt, /maximum/);
  assert.ok(!qs[0].prompt.includes("Image"));
});
