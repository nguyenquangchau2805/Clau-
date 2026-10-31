// Lưu trữ đơn giản bằng file JSON.
// Dữ liệu nằm ở thư mục riêng của người dùng (~/SAT-Practice-data), KHÔNG nằm trong thư mục code,
// để tải bản code mới hay chạy từ thư mục khác cũng không làm mất ngân hàng đề.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(os.homedir(), "SAT-Practice-data");
export const IMAGE_DIR = path.join(DATA_DIR, "images");

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}
const backupFile = (name) => path.join(DATA_DIR, `${name}.backup.json`);

// Bản cũ lưu ở <thư mục code>/data: chuyển sang chỗ mới ở lần chạy đầu tiên.
function migrateLegacyData() {
  if (process.env.DATA_DIR || fs.existsSync(file("bank"))) return;
  for (const dir of new Set([path.join(APP_DIR, "data"), path.resolve("data")])) {
    if (!fs.existsSync(path.join(dir, "bank.json"))) continue;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.cpSync(dir, DATA_DIR, { recursive: true, force: false, errorOnExist: false });
    console.log(`Đã chuyển dữ liệu cũ từ ${dir} sang ${DATA_DIR}`);
    return;
  }
}
migrateLegacyData();

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function load(name, fallback) {
  if (!fs.existsSync(file(name))) return fallback;
  try {
    return readJson(file(name));
  } catch (err) {
    // File hỏng: không được coi như trống (lần lưu sau sẽ ghi đè mất hết). Giữ lại bản hỏng và dùng bản sao lưu.
    const broken = `${file(name)}.broken-${Date.now()}`;
    fs.copyFileSync(file(name), broken);
    console.error(`⚠️  ${name}.json bị lỗi (${err.message}). Đã giữ bản lỗi tại ${broken}.`);
    try {
      const data = readJson(backupFile(name));
      fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
      console.error(`   → Đã khôi phục từ bản sao lưu ${name}.backup.json.`);
      return data;
    } catch {
      return fallback;
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function save(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const target = file(name);
  const text = JSON.stringify(value, null, 2);
  if (fs.existsSync(target)) {
    try {
      fs.copyFileSync(target, backupFile(name));
    } catch {}
  }
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, text);
  // Trên Windows, OneDrive / phần mềm diệt virus có thể khoá file một lúc: thử lại vài lần.
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      if (i < 8 && ["EPERM", "EBUSY", "EACCES"].includes(err.code)) {
        sleepSync(60 * (i + 1));
        continue;
      }
      // Không đổi tên được thì ghi thẳng vào file.
      fs.writeFileSync(target, text);
      fs.rmSync(tmp, { force: true });
      return;
    }
  }
}

class Collection {
  constructor(name) {
    this.name = name;
    this.items = load(name, []);
  }
  all() {
    return this.items;
  }
  get(id) {
    return this.items.find((x) => x.id === id);
  }
  upsertMany(list) {
    const index = new Map(this.items.map((x, i) => [x.id, i]));
    let added = 0;
    for (const item of list) {
      if (index.has(item.id)) {
        this.items[index.get(item.id)] = { ...this.items[index.get(item.id)], ...item };
      } else {
        index.set(item.id, this.items.length);
        this.items.push(item);
        added++;
      }
    }
    this.flush();
    return added;
  }
  update(id, patch) {
    const item = this.get(id);
    if (!item) return null;
    Object.assign(item, patch, { id });
    this.flush();
    return item;
  }
  remove(predicate) {
    const before = this.items.length;
    this.items = this.items.filter((x) => !predicate(x));
    this.flush();
    return before - this.items.length;
  }
  flush() {
    save(this.name, this.items);
  }
}

export const questions = new Collection("bank");
export const tests = new Collection("tests");
export const results = new Collection("results");
