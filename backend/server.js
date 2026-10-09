import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { config } from "./src/config.js";
import * as store from "./src/store.js";
import { seedAndSave } from "./src/seed.js";
import routes from "./src/routes/index.js";
import { rebaseIfStale } from "./src/rebase.js";

if (!store.hasDb()) { console.log("No database found - seeding demo data..."); seedAndSave(); await store.flushNow(); }
store.load();
{ const shifted = rebaseIfStale(store.get()); if (shifted) { console.log(`Data was ${(shifted / 3_600_000).toFixed(1)}h old - timestamps refreshed to the present.`); store.save(true); } }

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: (o, cb) => cb(null, !o || config.corsOrigins.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)) }));
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ type: ["text/csv", "text/plain"], limit: "10mb" }));
app.use((req, _res, next) => { if (req.path.startsWith("/api")) console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.originalUrl}`); next(); });

app.use("/api", routes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

if (config.serveFrontend && fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
}

app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : err.message });
});

app.listen(config.port, () => console.log(`Sentinel API listening on http://localhost:${config.port}  (${store.get().transactions.length} transactions)`));
