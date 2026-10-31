import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STORE = path.resolve("src/store.js");

// Mỗi lần chạy là một tiến trình mới, giống như tắt web rồi mở lại.
function run(code, env, cwd = process.cwd()) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const s = await import(${JSON.stringify(STORE)}); ${code}`], {
    env: { ...process.env, ...env },
    cwd,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split("\n").pop();
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sat-store-"));

test("question bank survives a restart", () => {
  const dir = tmp();
  run(`s.questions.upsertMany([{ id: "q_1" }, { id: "q_2" }]);`, { DATA_DIR: dir });
  assert.equal(run(`console.log(s.questions.all().length)`, { DATA_DIR: dir }), "2");
});

test("a corrupted bank file is restored from the backup instead of being wiped", () => {
  const dir = tmp();
  run(`s.questions.upsertMany([{ id: "q_1" }]); s.questions.upsertMany([{ id: "q_2" }]);`, { DATA_DIR: dir });
  fs.writeFileSync(path.join(dir, "bank.json"), "{ broken");
  assert.equal(run(`console.log(s.questions.all().length)`, { DATA_DIR: dir }), "1");
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("bank.json.broken-")));
});

test("data from the old <code>/data folder is moved to the user data folder", () => {
  const home = tmp();
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, "data"));
  fs.writeFileSync(path.join(cwd, "data", "bank.json"), JSON.stringify([{ id: "q_old" }]));
  const env = { DATA_DIR: "", HOME: home, USERPROFILE: home };
  assert.equal(run(`console.log(s.questions.all().length, s.DATA_DIR)`, env, cwd), `1 ${path.join(home, "SAT-Practice-data")}`);
  // Lần chạy sau đọc từ chỗ mới, kể cả khi thư mục code cũ đã bị xoá.
  fs.rmSync(path.join(cwd, "data"), { recursive: true });
  assert.equal(run(`console.log(s.questions.all().length)`, env, cwd), "1");
});
