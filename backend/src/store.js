// Tiny JSON-file database. Zero native dependencies so it installs everywhere (Windows included).
// All reads are in-memory; writes are debounced and atomic (tmp file + rename).
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const FILE = path.join(config.dataDir, "db.json");
let db = null;
let timer = null;
let writing = false;
let dirty = false;

export const dbFile = FILE;
export const hasDb = () => fs.existsSync(FILE);

export function load() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = JSON.parse(fs.readFileSync(FILE, "utf8"));
  return db;
}
export const get = () => db ?? load();
export function replace(next) { db = next; save(true); }

async function flush() {
  if (writing) { dirty = true; return; }
  writing = true;
  try {
    do {
      dirty = false;
      const tmp = `${FILE}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(db));
      try { await fs.promises.rename(tmp, FILE); }
      catch { await fs.promises.copyFile(tmp, FILE); await fs.promises.rm(tmp, { force: true }); }
    } while (dirty);
  } finally { writing = false; }
}

export function save(immediate = false) {
  if (!db) return;
  clearTimeout(timer);
  if (immediate) return flush();
  timer = setTimeout(flush, 250);
}
export async function flushNow() { clearTimeout(timer); if (db) await flush(); }
process.on("SIGINT", async () => { await flushNow(); process.exit(0); });
process.on("SIGTERM", async () => { await flushNow(); process.exit(0); });
