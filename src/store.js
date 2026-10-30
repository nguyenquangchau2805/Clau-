// Lưu trữ đơn giản bằng file JSON trong thư mục data/.
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

function save(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file(name) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
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
