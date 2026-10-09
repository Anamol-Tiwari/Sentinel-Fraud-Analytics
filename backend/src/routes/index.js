import { Router } from "express";
import * as store from "../store.js";
import { config } from "../config.js";
import { ah, httpError, parse, sendCsv, z } from "../http.js";
import { audit, matchesAnyRule, matchesRule } from "../seed.js";
import { TXN_COLUMNS, applyDecision, auditOut, createTransaction, decisionOf, filterTransactions, findTransaction, isFlagged, isOpenAlert, queryTransactions, serialize, toCsv } from "../services/transactions.js";
import { alertList, alertsSummary, breakdown, overview, trend } from "../services/stats.js";
import { enabledSources, simulateBatch, simulatorStatus, startSimulator, stopSimulator } from "../services/simulator.js";
import { HELP } from "../help.js";

const r = Router();
const db = () => store.get();
const actor = () => db().user.name;
const initialsOf = (n) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

// ---------- health / me / help ----------
r.get("/health", (_req, res) => {
  const d = db(); const bad = d.sources.filter((s) => s.enabled && s.health !== "healthy").length;
  res.json({ status: "ok", system: bad ? "degraded" : "nominal", version: config.version, uptimeSec: Math.round(process.uptime()), transactions: d.transactions.length, time: new Date().toISOString() });
});
r.get("/me", (_req, res) => res.json(db().user));
r.put("/me", ah((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), role: z.string().trim().min(2).max(40).optional(), email: z.string().trim().email().optional(), notifications: z.boolean().optional() }), req.body);
  const u = Object.assign(db().user, b); u.initials = initialsOf(u.name);
  audit(db(), { actor: u.name, action: "profile.update", target: u.name, detail: "Profile updated" }); store.save();
  res.json(u);
}));
r.get("/help", (_req, res) => res.json(HELP));

// ---------- overview ----------
r.get("/overview", (_req, res) => res.json(overview(db())));
r.get("/overview/trend", (req, res) => res.json(trend(db(), ["12 days", "30 days", "24 hours"].includes(req.query.range) ? req.query.range : "12 days")));
r.get("/overview/breakdown", (_req, res) => res.json(breakdown(db())));

// ---------- transactions ----------
const listQuery = (q) => ({ q: String(q.q ?? ""), risk: q.risk, status: q.status, sort: q.sort, page: q.page, pageSize: q.pageSize });
r.get("/transactions", (req, res) => res.json(queryTransactions(db(), listQuery(req.query))));
r.get("/transactions/export", (req, res) => {
  const d = db();
  const rows = filterTransactions(d, listQuery(req.query)).sort((a, b) => b.ts - a.ts).map((t) => serialize(d, t));
  audit(d, { actor: actor(), action: "export.transactions", target: "Transactions", detail: `${rows.length} rows exported` }); store.save();
  sendCsv(res, `transactions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, TXN_COLUMNS));
});
r.get("/transactions/:id", ah((req, res) => {
  const t = findTransaction(db(), req.params.id); if (!t) throw httpError(404, "Transaction not found");
  res.json(serialize(db(), t, true));
}));
r.post("/transactions/:id/decision", ah((req, res) => {
  const { decision } = parse(z.object({ decision: z.enum(["Confirmed fraud", "False positive", "Review"]) }), req.body);
  const t = findTransaction(db(), req.params.id); if (!t) throw httpError(404, "Transaction not found");
  applyDecision(db(), t, decision, actor()); store.save();
  res.json(serialize(db(), t, true));
}));
r.post("/transactions/:id/notes", ah((req, res) => {
  const { text } = parse(z.object({ text: z.string().trim().min(1).max(500) }), req.body);
  const t = findTransaction(db(), req.params.id); if (!t) throw httpError(404, "Transaction not found");
  (t.notes ??= []).unshift({ id: `N-${Date.now()}`, author: actor(), text, timestamp: new Date().toISOString() });
  audit(db(), { actor: actor(), action: "note.add", target: t.id, detail: text.slice(0, 80) }); store.save();
  res.status(201).json(serialize(db(), t, true));
}));

// ---------- reports ----------
r.get("/reports/daily", (_req, res) => {
  const d = db(); const from = Date.now() - 86_400_000;
  const rows = d.transactions.filter((t) => t.ts >= from && isFlagged(d, t)).sort((a, b) => b.ts - a.ts).map((t) => serialize(d, t));
  audit(d, { actor: actor(), action: "export.report", target: "Daily report", detail: `${rows.length} signals in the last 24h` }); store.save();
  sendCsv(res, `signals-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, TXN_COLUMNS));
});

// ---------- alerts & rules ----------
r.get("/alerts", (req, res) => res.json({ summary: alertsSummary(db()), ...alertList(db(), { filter: String(req.query.filter ?? "all"), page: Number(req.query.page) || 1, pageSize: Math.min(50, Number(req.query.pageSize) || 8) }) }));
r.post("/alerts/read", ah((req, res) => {
  const b = parse(z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }), req.body);
  let n = 0;
  for (const t of db().transactions) if (isOpenAlert(db(), t) && !t.alertRead && (b.all || b.ids?.includes(t.id))) { t.alertRead = true; n++; }
  if (b.all && n) audit(db(), { actor: actor(), action: "alert.mark_read", target: "Alert queue", detail: `${n} alerts marked as read` });
  store.save(); res.json({ updated: n, unread: alertsSummary(db()).unread });
}));
const ruleOut = (rule) => {
  const d = db(); const from = Date.now() - 86_400_000;
  const hits24h = d.transactions.filter((t) => t.ts >= from && matchesRule({ ...rule, enabled: true }, t)).length;
  return { ...rule, hits24h };
};
const ruleSchema = z.object({
  name: z.string().trim().min(2).max(60), description: z.string().trim().max(160).optional().default(""),
  type: z.enum(["amount_gte", "score_gte", "velocity_gte", "feature"]),
  value: z.union([z.number(), z.string()]), severity: z.enum(["Critical", "High", "Medium", "Low"]), enabled: z.boolean().optional().default(true),
}).superRefine((v, ctx) => {
  if (v.type === "feature" && !["travel", "geo", "shared", "device", "ip", "night", "merchant", "velocity", "amount", "category"].includes(String(v.value))) ctx.addIssue({ code: "custom", message: "unknown signal", path: ["value"] });
  if (v.type !== "feature" && (typeof v.value !== "number" || v.value <= 0)) ctx.addIssue({ code: "custom", message: "must be a positive number", path: ["value"] });
  if (v.type === "score_gte" && Number(v.value) > 100) ctx.addIssue({ code: "custom", message: "score must be 1-100", path: ["value"] });
});
r.get("/rules", (_req, res) => res.json({ items: db().rules.map(ruleOut), lastSyncedAt: db().meta.lastRulesSyncAt }));
r.post("/rules", ah((req, res) => {
  const b = parse(ruleSchema, req.body); const rule = { id: `R-${db().nextRuleSeq++}`, ...b };
  db().rules.push(rule); audit(db(), { actor: actor(), action: "rule.create", target: `${rule.id} ${rule.name}`, detail: `${rule.type} ${rule.value}` }); store.save();
  res.status(201).json(ruleOut(rule));
}));
r.patch("/rules/:id", ah((req, res) => {
  const rule = db().rules.find((x) => x.id === req.params.id); if (!rule) throw httpError(404, "Rule not found");
  const merged = parse(ruleSchema, { ...rule, ...req.body, id: undefined });
  Object.assign(rule, merged);
  audit(db(), { actor: actor(), action: "rule.update", target: `${rule.id} ${rule.name}`, detail: `${rule.enabled ? "Enabled" : "Disabled"} · ${rule.type} ${rule.value}` }); store.save();
  res.json(ruleOut(rule));
}));
r.delete("/rules/:id", ah((req, res) => {
  const i = db().rules.findIndex((x) => x.id === req.params.id); if (i < 0) throw httpError(404, "Rule not found");
  const [rule] = db().rules.splice(i, 1);
  audit(db(), { actor: actor(), action: "rule.delete", target: `${rule.id} ${rule.name}`, detail: "Rule deleted" }); store.save();
  res.status(204).end();
}));
r.post("/alerts/sync-rules", (_req, res) => {
  const d = db(); const active = d.rules.filter((x) => x.enabled);
  const matched = d.transactions.filter((t) => matchesAnyRule(d.rules, t)).length;
  d.meta.lastRulesSyncAt = new Date().toISOString();
  audit(d, { actor: actor(), action: "rule.sync", target: "Alert rules", detail: `${active.length} rules re-evaluated against ${d.transactions.length} transactions` }); store.save();
  res.json({ activeRules: active.length, evaluated: d.transactions.length, matched, syncedAt: d.meta.lastRulesSyncAt });
});

// ---------- models & settings ----------
const modelsPayload = () => {
  const d = db(); const champion = d.models.find((m) => m.id === d.meta.championId);
  return { models: d.models, champion, threshold: d.meta.threshold, flaggedCount: d.transactions.filter((t) => isFlagged(d, t)).length, evaluatedOn: d.transactions.length, lastEvaluatedAt: d.meta.lastEvaluatedAt, retrain: d.meta.retrain };
};
r.get("/models", (_req, res) => res.json(modelsPayload()));
r.get("/settings", (_req, res) => res.json({ threshold: db().meta.threshold, queueSort: db().meta.queueSort }));
r.put("/settings", ah((req, res) => {
  const b = parse(z.object({ threshold: z.number().int().min(50).max(95).optional(), queueSort: z.enum(["priority", "risk", "amount", "newest"]).optional() }), req.body);
  const m = db().meta;
  if (b.threshold != null && b.threshold !== m.threshold) { audit(db(), { actor: actor(), action: "threshold.update", target: "Review threshold", detail: `Changed from ${m.threshold} to ${b.threshold}` }); m.threshold = b.threshold; }
  if (b.queueSort && b.queueSort !== m.queueSort) { audit(db(), { actor: actor(), action: "settings.queue", target: "Queue ordering", detail: `${m.queueSort} → ${b.queueSort}` }); m.queueSort = b.queueSort; }
  store.save(); res.json({ threshold: m.threshold, queueSort: m.queueSort, flaggedCount: db().transactions.filter((t) => isFlagged(db(), t)).length });
}));
r.post("/models/:id/promote", ah((req, res) => {
  const d = db(); const m = d.models.find((x) => x.id === req.params.id); if (!m) throw httpError(404, "Model not found");
  if (m.status === "Champion") throw httpError(409, `${m.name} is already the champion`);
  d.models.forEach((x) => { if (x.status === "Champion") { x.status = x.prevStatus ?? "Stable"; delete x.prevStatus; } });
  m.prevStatus = m.status; m.status = "Champion"; d.meta.championId = m.id;
  audit(d, { actor: actor(), action: "model.promote", target: m.name, detail: "Promoted to champion" }); store.save(); res.json(modelsPayload());
}));
let retrainTimer = null;
r.post("/models/retrain", ah((_req, res) => {
  const d = db();
  if (d.meta.retrain?.status === "running") throw httpError(409, "A training run is already in progress");
  const feedback = d.transactions.filter((t) => t.analystDecision).length;
  const job = { id: `job-${Date.now()}`, status: "running", progress: 0, startedAt: new Date().toISOString(), feedbackSamples: feedback };
  d.meta.retrain = job;
  audit(d, { actor: actor(), action: "model.retrain_start", target: "All models", detail: `Queued with ${feedback} analyst feedback samples` });
  const steps = 8; let i = 0;
  retrainTimer = setInterval(() => {
    i++; job.progress = Math.round((i / steps) * 100);
    if (i >= steps) {
      clearInterval(retrainTimer);
      const nudge = (v, lo, hi, max) => Math.min(max, Math.max(lo, +(v + (Math.random() * (hi - lo) + lo)).toFixed(1)));
      for (const m of d.models) { m.precision = nudge(m.precision, -0.3, 0.7, 99); m.recall = nudge(m.recall, -0.3, 0.7, 99); m.auc = Math.min(0.999, +(m.auc + Math.random() * 0.004).toFixed(3)); m.trainedAt = new Date().toISOString(); }
      d.meta.lastEvaluatedAt = new Date().toISOString(); job.status = "completed"; job.finishedAt = d.meta.lastEvaluatedAt;
      audit(d, { actor: "System", action: "model.retrain", target: "All models", detail: `Retraining completed with ${feedback} feedback samples` });
    }
    store.save();
  }, 900);
  retrainTimer.unref?.(); store.save(); res.status(202).json(job);
}));

// ---------- data sources & ingestion ----------
const sourceOut = (s) => {
  const d = db(); const from = Date.now() - 86_400_000; let n = 0, last = 0;
  for (const t of d.transactions) if (t.source === s.id) { if (t.ts >= from) n++; if (t.ts > last) last = t.ts; }
  const status = !s.enabled ? "Paused" : s.health === "degraded" ? "Degraded" : "Healthy";
  return { ...s, status, events24h: n, lastEventAt: last ? new Date(last).toISOString() : null };
};
r.get("/sources", (_req, res) => res.json({ items: db().sources.map(sourceOut), simulator: simulatorStatus() }));
r.patch("/sources/:id", ah((req, res) => {
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  const s = db().sources.find((x) => x.id === req.params.id); if (!s) throw httpError(404, "Source not found");
  s.enabled = enabled; audit(db(), { actor: actor(), action: "source.update", target: s.name, detail: enabled ? "Resumed" : "Paused" }); store.save(); res.json(sourceOut(s));
}));
r.post("/sources/:id/test", ah((req, res) => {
  const s = db().sources.find((x) => x.id === req.params.id); if (!s) throw httpError(404, "Source not found");
  if (!s.enabled) throw httpError(409, `${s.name} is paused. Resume it before testing.`);
  const latencyMs = s.id === "batch-csv" ? 0 : Math.round(30 + Math.random() * 60);
  s.health = "healthy"; s.latencyMs = latencyMs; s.lastCheckedAt = new Date().toISOString();
  audit(db(), { actor: actor(), action: "source.test", target: s.name, detail: `Connection OK · ${latencyMs}ms` }); store.save();
  res.json({ ok: true, latencyMs, source: sourceOut(s) });
}));

const txnInput = z.object({
  customerId: z.string().trim().min(1).max(40).optional(), merchant: z.string().trim().min(1).max(80), category: z.string().trim().max(40).optional(),
  amount: z.coerce.number().positive().max(1e9), location: z.string().trim().max(60).optional(), method: z.string().trim().max(60).optional(),
  device: z.string().trim().max(60).optional(), deviceId: z.string().trim().max(60).optional(), timestamp: z.string().optional(), ipRisk: z.enum(["clean", "proxy"]).optional(),
});
const ingestOne = (d, raw, source) => {
  if (raw && typeof raw.amount === "string") raw = { ...raw, amount: raw.amount.replace(/[₹,\s]|INR|Rs\.?/gi, "") };
  const p = txnInput.parse(raw);
  const ts = p.timestamp ? Date.parse(p.timestamp) : Date.now();
  if (Number.isNaN(ts)) throw new Error("invalid timestamp");
  return createTransaction(d, { ...p, customerId: p.customerId || `C-EXT-${(p.method || p.merchant).replace(/\W+/g, "").slice(0, 12).toLowerCase()}`, ts, source, location: p.location || "Mumbai, IN" });
};
const ingestSummary = (d, created, errors = []) => ({ accepted: created.length, rejected: errors.length, errors: errors.slice(0, 10), flagged: created.filter((t) => isFlagged(d, t)).length, critical: created.filter((t) => t.risk === "Critical").length, ids: created.slice(0, 50).map((t) => t.id) });

r.post("/ingest/transactions", ah((req, res) => {
  const list = Array.isArray(req.body?.transactions) ? req.body.transactions : [req.body];
  if (!list.length || list.length > 1000) throw httpError(400, "Send between 1 and 1000 transactions");
  const d = db(); const src = d.sources.find((s) => s.id === (req.body?.source ?? "core-banking"));
  if (src && !src.enabled) throw httpError(409, `${src.name} is paused`);
  const created = [], errors = [];
  list.forEach((raw, i) => { try { created.push(ingestOne(d, raw, src?.id ?? "api")); } catch (e) { errors.push({ row: i + 1, error: e.issues ? e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") : e.message }); } });
  audit(d, { actor: actor(), action: "ingest.api", target: src?.name ?? "API", detail: `${created.length} accepted, ${errors.length} rejected` }); store.save();
  res.status(created.length ? 201 : 400).json(ingestSummary(d, created, errors));
}));
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
r.post("/ingest/csv", ah((req, res) => {
  const text = typeof req.body === "string" ? req.body.replace(/^\ufeff/, "") : "";
  if (!text.trim()) throw httpError(400, "Empty file");
  const rows = parseCsv(text); const head = rows.shift().map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const alias = { merchant: "merchant", amount: "amount", amountinr: "amount", category: "category", location: "location", city: "location", method: "method", paymentmethod: "method", device: "device", customerid: "customerId", customer: "customerId", timestamp: "timestamp", time: "timestamp", date: "timestamp", iprisk: "ipRisk", deviceid: "deviceId" };
  const cols = head.map((h) => alias[h]);
  if (!cols.includes("merchant") || !cols.includes("amount")) throw httpError(400, "CSV needs at least 'merchant' and 'amount' columns");
  if (rows.length > 5000) throw httpError(400, "Max 5000 rows per upload");
  const src = db().sources.find((s) => s.id === "batch-csv"); if (src && !src.enabled) throw httpError(409, "Batch CSV uploads source is paused");
  const d = db(); const created = [], errors = [];
  rows.forEach((cells, i) => {
    const raw = {}; cols.forEach((k, j) => { if (k && cells[j]?.trim()) raw[k] = cells[j].trim(); });
    try { created.push(ingestOne(d, raw, "batch-csv")); } catch (e) { errors.push({ row: i + 2, error: e.issues ? e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") : e.message }); }
  });
  audit(d, { actor: actor(), action: "ingest.csv", target: "Batch CSV uploads", detail: `${created.length} accepted, ${errors.length} rejected` }); store.save();
  res.status(created.length ? 201 : 400).json(ingestSummary(d, created, errors));
}));
r.post("/ingest/simulate", ah((req, res) => {
  const b = parse(z.object({ count: z.number().int().min(1).max(500).default(10), fraudRatio: z.number().min(0).max(1).default(0.25) }), req.body ?? {});
  const d = db(); const created = simulateBatch(d, b.count, b.fraudRatio);
  audit(d, { actor: actor(), action: "ingest.simulate", target: "Simulator", detail: `${created.length} synthetic transactions scored` }); store.save();
  res.status(201).json(ingestSummary(d, created));
}));
r.get("/ingest/simulator", (_req, res) => res.json(simulatorStatus()));
r.post("/ingest/simulator/start", ah((req, res) => {
  const { ratePerMin } = parse(z.object({ ratePerMin: z.number().int().min(1).max(120).default(12) }), req.body ?? {});
  if (!enabledSources(db()).length) throw httpError(409, "All data sources are paused");
  res.json(startSimulator(ratePerMin, actor()));
}));
r.post("/ingest/simulator/stop", (_req, res) => res.json(stopSimulator(false, actor())));

// ---------- audit ----------
const auditRows = (q) => {
  const needle = String(q.q ?? "").toLowerCase(), cat = q.category && q.category !== "All" ? String(q.category) : null;
  return db().audit.filter((a) => (!cat || a.action.startsWith(cat + ".")) && (!needle || `${a.actor} ${a.action} ${a.target} ${a.detail}`.toLowerCase().includes(needle))).sort((a, b) => b.ts - a.ts);
};
r.get("/audit", (req, res) => {
  const rows = auditRows(req.query); const pageSize = Math.min(100, Number(req.query.pageSize) || 15);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize)); const page = Math.min(totalPages, Math.max(1, Number(req.query.page) || 1));
  res.json({ items: rows.slice((page - 1) * pageSize, page * pageSize).map(auditOut), total: rows.length, page, pageSize, totalPages });
});
r.get("/audit/export", (req, res) => sendCsv(res, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(auditRows(req.query).map(auditOut), [
  { header: "Timestamp", get: (a) => a.timestamp }, { header: "Actor", get: (a) => a.actor }, { header: "Action", get: (a) => a.action }, { header: "Target", get: (a) => a.target }, { header: "Detail", get: (a) => a.detail },
])));

export default r;
