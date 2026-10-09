import { riskFromScore } from "../config.js";
import { MERCHANTS, audit, featureKeys, matchesAnyRule, matchesRule } from "../seed.js";
import { commitProfile, newCustomer, recommendation, scoreTransaction } from "../scoring.js";
import { CITIES } from "../geo.js";

const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CATEGORY_OF = Object.fromEntries(MERCHANTS);

export const isFlagged = (db, t) => t.score >= db.meta.threshold || matchesAnyRule(db.rules, t);
export const decisionOf = (db, t) => t.analystDecision ?? (isFlagged(db, t) ? "Review" : "Cleared");
export const isOpenAlert = (db, t) => !t.analystDecision && isFlagged(db, t);
export const priorityOf = (t) => t.score * 0.7 + Math.min(100, (Math.log10(t.amount + 1) / Math.log10(200000)) * 100) * 0.3;

export function serialize(db, t, detail = false) {
  const decision = decisionOf(db, t);
  const out = {
    id: t.id, timestamp: new Date(t.ts).toISOString(), merchant: t.merchant, category: t.category, location: t.location,
    amount: t.amount, score: t.score, risk: t.risk, decision, method: t.method, device: t.device, anomaly: t.anomaly,
    model: t.model, signalType: t.signalType, source: t.source, factors: t.factors, flagged: isFlagged(db, t),
    unread: isOpenAlert(db, t) && !t.alertRead,
  };
  if (detail) {
    out.customerId = t.customerId;
    out.recommendation = recommendation(t.risk);
    out.matchedRules = db.rules.filter((r) => matchesRule(r, t)).map((r) => ({ id: r.id, name: r.name, severity: r.severity }));
    out.notes = t.notes ?? [];
    out.decidedAt = t.decidedAt ? new Date(t.decidedAt).toISOString() : null;
    out.decidedBy = t.decidedBy ?? null;
    out.history = db.audit.filter((a) => a.target === t.id).slice(-10).reverse().map(auditOut);
  }
  return out;
}
export const auditOut = (a) => ({ ...a, timestamp: new Date(a.ts).toISOString(), category: a.action.split(".")[0] });

const SORTS = {
  priority: (a, b) => priorityOf(b) - priorityOf(a) || b.ts - a.ts,
  risk: (a, b) => b.score - a.score || b.ts - a.ts,
  amount: (a, b) => b.amount - a.amount || b.ts - a.ts,
  newest: (a, b) => b.ts - a.ts,
};

export function filterTransactions(db, { q = "", risk = "All risk", status = "All status", source } = {}) {
  const needle = q.trim().toLowerCase();
  return db.transactions.filter((t) => {
    if (risk && risk !== "All risk" && t.risk !== risk) return false;
    if (status && status !== "All status" && decisionOf(db, t) !== status) return false;
    if (source && t.source !== source) return false;
    if (needle && !`${t.id} ${t.merchant} ${t.location} ${t.category} ${t.method} ${t.anomaly} ${t.amount}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function queryTransactions(db, params) {
  const sort = SORTS[params.sort] ? params.sort : db.meta.queueSort;
  const cmp = SORTS[sort] ?? SORTS.priority;
  // Smart queue: open cases always come first, then the chosen ordering.
  const openFirst = (a, b) => (sort === "priority" ? (isOpenAlert(db, b) ? 1 : 0) - (isOpenAlert(db, a) ? 1 : 0) : 0) || cmp(a, b);
  const rows = filterTransactions(db, params).sort(openFirst);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number(params.page) || 1));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize).map((t) => serialize(db, t)), total: rows.length, page, pageSize, totalPages, sort, grandTotal: db.transactions.length };
}

export function findTransaction(db, id) {
  return db.transactions.find((t) => t.id.toLowerCase() === String(id).toLowerCase());
}

export function applyDecision(db, t, decision, actor) {
  const prev = decisionOf(db, t);
  if (decision === "Review") { t.analystDecision = null; t.decidedAt = null; t.decidedBy = null; }
  else { t.analystDecision = decision; t.decidedAt = Date.now(); t.decidedBy = actor; t.alertRead = true; }
  const action = { "Confirmed fraud": "decision.confirm_fraud", "False positive": "decision.false_positive", Review: "decision.reopen" }[decision];
  audit(db, { actor, action, target: t.id, detail: `${prev} → ${decision} · ${t.merchant} · ₹${t.amount.toLocaleString("en-IN")}` });
  return t;
}

/** Score + persist one transaction from validated input. */
export function createTransaction(db, input) {
  const customerId = input.customerId;
  const cust = (db.customers[customerId] ??= Object.assign(newCustomer(customerId, input.location), { count: 0, method: input.method }));
  const ts = input.ts ?? Date.now();
  const deviceLabel = input.device || "Unknown device";
  const deviceId = input.deviceId || `dev-${customerId}-${deviceLabel.replace(/\W+/g, "").toLowerCase()}`;
  db.deviceLabels[deviceId] ??= deviceLabel;
  const e = { customerId, merchant: input.merchant, category: input.category || CATEGORY_OF[input.merchant] || "Retail", amount: input.amount, location: input.location || cust.homeCity, deviceId, device: deviceLabel, ts, ipRisk: input.ipRisk || "clean", method: input.method || cust.method || "Card · •••• 0000" };
  const s = scoreTransaction(db, e);
  commitProfile(db, e);
  let id;
  do { db.meta.seq += 1; id = `TX-${db.meta.seq}${letters[Math.floor(Math.random() * letters.length)]}`; } while (db.transactions.some((t) => t.id === id));
  const champion = db.models.find((m) => m.id === db.meta.championId)?.name ?? "XGBoost v2.4";
  const txn = { id, ts, merchant: e.merchant, category: e.category, location: e.location, amount: e.amount, score: s.score, risk: s.risk, method: e.method, device: e.device, deviceId, customerId, anomaly: s.anomaly, signalType: s.signalType, model: champion, factors: s.factors, velocity: s.velocity, keys: featureKeys(s), source: input.source || "api", analystDecision: null, alertRead: false, notes: [] };
  db.transactions.push(txn);
  return txn;
}

export const knownLocation = (loc) => (CITIES[loc] ? loc : null);
export { riskFromScore };

export function toCsv(rows, columns) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map((c) => c.header).join(","), ...rows.map((r) => columns.map((c) => esc(c.get(r))).join(","))].join("\r\n") + "\r\n";
}
export const TXN_COLUMNS = [
  { header: "Transaction ID", get: (t) => t.id }, { header: "Timestamp", get: (t) => t.timestamp }, { header: "Merchant", get: (t) => t.merchant },
  { header: "Category", get: (t) => t.category }, { header: "Location", get: (t) => t.location }, { header: "Amount (INR)", get: (t) => t.amount },
  { header: "Risk score", get: (t) => t.score }, { header: "Risk level", get: (t) => t.risk }, { header: "Decision", get: (t) => t.decision },
  { header: "Signal", get: (t) => t.anomaly }, { header: "Model", get: (t) => t.model }, { header: "Payment method", get: (t) => t.method },
  { header: "Device", get: (t) => t.device }, { header: "Source", get: (t) => t.source },
];
