import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

// Minimal .env loader (no dependency)
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || "./data"),
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:8080,http://127.0.0.1:8080").split(",").map((s) => s.trim()),
  serveFrontend: process.env.SERVE_FRONTEND === "true",
  webDist: path.resolve(ROOT, "../web/dist"),
  version: "2.4",
};

// Risk bands (score -> level). Matches the labels used in the UI.
export const RISK_BANDS = { critical: 91, high: 70, medium: 40 };
export const riskFromScore = (s) =>
  s >= RISK_BANDS.critical ? "Critical" : s >= RISK_BANDS.high ? "High" : s >= RISK_BANDS.medium ? "Medium" : "Low";
