import { decisionOf, isFlagged, isOpenAlert, priorityOf, serialize } from "./transactions.js";

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const COLORS = { "Card testing": "#f97361", "Account takeover": "#f2b45c", "Geo anomaly": "#b9df72", Velocity: "#6c8990", "Amount anomaly": "#8f7cf0" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export function money(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return inr(n);
}
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n.toLocaleString("en-IN"));
const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const inWindow = (t, from, to) => t.ts >= from && t.ts < to;

function delta(change, goodWhenDown = false, suffix = "vs last period") {
  if (change == null) return { trend: "neutral", detail: "No prior period yet" };
  const trend = change === 0 ? "neutral" : change > 0 ? "up" : "down";
  return { trend, detail: `${Math.abs(change).toFixed(1)}% ${suffix}`, good: goodWhenDown ? change <= 0 : change >= 0 };
}

export function overview(db, now = Date.now()) {
  const tx = db.transactions;
  const last = (from, to, fn = () => true) => tx.filter((t) => inWindow(t, from, to) && fn(t));
  const cur24 = now - DAY, prev24 = now - 2 * DAY;
  const flaggedNow = (t) => isFlagged(db, t);

  const total = tx.length;
  const totalChange = pct(last(cur24, now + 1).length, last(prev24, cur24).length);
  const flagged = tx.filter(flaggedNow).length;
  const flaggedChange = pct(last(cur24, now + 1, flaggedNow).length, last(prev24, cur24, flaggedNow).length);
  const confirmed = tx.filter((t) => t.analystDecision === "Confirmed fraud");
  const confirmedAmount = confirmed.reduce((s, t) => s + t.amount, 0);
  const todayStart = startOfDay(now);
  const preventedToday = confirmed.filter((t) => (t.decidedAt ?? 0) >= todayStart).reduce((s, t) => s + t.amount, 0);

  const fpr = (from, to) => {
    const w = tx.filter((t) => inWindow(t, from, to));
    const neg = w.filter((t) => t.analystDecision !== "Confirmed fraud").length;
    return neg ? (w.filter((t) => t.analystDecision === "False positive").length / neg) * 100 : 0;
  };
  const fprAll = (() => { const neg = total - confirmed.length; return neg ? (tx.filter((t) => t.analystDecision === "False positive").length / neg) * 100 : 0; })();
  const fprDiff = fpr(now - 7 * DAY, now + 1) - fpr(now - 14 * DAY, now - 7 * DAY);

  const d1 = delta(totalChange), d2 = delta(flaggedChange, true);
  const lastTx = tx.reduce((m, t) => (t.ts > m ? t.ts : m), 0);
  const unread = tx.filter((t) => isOpenAlert(db, t) && !t.alertRead).length;
  const open = tx.filter((t) => isOpenAlert(db, t)).length;
  const down = db.sources.filter((s) => s.enabled && s.health !== "healthy").length;

  return {
    generatedAt: new Date(now).toISOString(),
    metrics: [
      { key: "total", label: "Total transactions", value: compact(total), tone: "blue", icon: "layers", trend: d1.trend, detail: d1.detail, help: "Every payment event scored by the detection pipeline. Change compares the last 24 hours with the 24 hours before." },
      { key: "flagged", label: "Flagged for review", value: flagged.toLocaleString("en-IN"), tone: "lime", icon: "shield-alert", trend: d2.trend, detail: d2.detail, help: `Transactions at or above the review threshold (${db.meta.threshold}) or matching an active alert rule.` },
      { key: "fraud", label: "Confirmed fraud", value: money(confirmedAmount), tone: "coral", icon: "alert", trend: "up", detail: `${money(preventedToday)} prevented today`, help: "Total value of transactions that analysts confirmed as fraud." },
      { key: "fpr", label: "False positive rate", value: `${fprAll.toFixed(1)}%`, tone: "amber", icon: "gauge", trend: fprDiff <= 0 ? "down" : "up", detail: `${Math.abs(fprDiff).toFixed(1)}% ${fprDiff <= 0 ? "improvement" : "increase"}`, help: "Legitimate transactions that were flagged and dismissed, as a share of all non-fraud transactions." },
    ],
    protection: {
      active: down === 0 && db.sources.some((s) => s.enabled),
      scored24h: last(cur24, now + 1).length,
      uptime: Math.max(95, 99.98 - down * 0.4),
      lastEventAt: lastTx ? new Date(lastTx).toISOString() : null,
      message: down ? `${down} data source${down > 1 ? "s" : ""} need attention` : "Protection layer is active",
    },
    counts: { transactions: total, flagged, open, unreadAlerts: unread },
    feed: tx.filter((t) => isOpenAlert(db, t)).sort((a, b) => b.ts - a.ts).slice(0, 4).map((t) => serialize(db, t)),
  };
}

export function trend(db, range = "12 days", now = Date.now()) {
  const tx = db.transactions;
  const hourly = range === "24 hours";
  const n = hourly ? 24 : range === "30 days" ? 30 : 12;
  const points = [];
  const bucket = hourly ? HOUR : DAY;
  const end = hourly ? Math.floor(now / HOUR) * HOUR + HOUR : startOfDay(now) + DAY;
  const from = end - n * bucket;
  const byBucket = Array.from({ length: n }, () => ({ flagged: 0, reviewed: 0 }));
  let prevFlagged = 0;
  for (const t of tx) {
    if (!isFlagged(db, t)) continue;
    if (t.ts >= from && t.ts < end) {
      const b = byBucket[Math.floor((t.ts - from) / bucket)];
      b.flagged++; if (t.analystDecision) b.reviewed++;
    } else if (t.ts >= from - n * bucket && t.ts < from) prevFlagged++;
  }
  for (let i = 0; i < n; i++) {
    const d = new Date(from + i * bucket);
    const label = hourly ? `${String(d.getHours()).padStart(2, "0")}:00` : `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
    points.push({ day: label, ...byBucket[i] });
  }
  const windowFlagged = byBucket.reduce((s, b) => s + b.flagged, 0);
  const change = pct(windowFlagged, prevFlagged);
  const todayCount = hourly ? windowFlagged : byBucket[n - 1].flagged;
  return { range, points, summary: { value: todayCount, label: hourly ? "signals in the last 24 hours" : "signals detected today", changePct: change == null ? null : Number(change.toFixed(1)), direction: change == null ? "neutral" : change <= 0 ? "down" : "up" } };
}

export function breakdown(db, now = Date.now()) {
  const from = now - 30 * DAY;
  const g = {};
  for (const t of db.transactions) {
    if (t.ts < from || !isFlagged(db, t)) continue;
    const k = (g[t.signalType] ??= { name: t.signalType, count: 0, amount: 0, scoreSum: 0, confirmed: 0 });
    k.count++; k.amount += t.amount; k.scoreSum += t.score; if (t.analystDecision === "Confirmed fraud") k.confirmed++;
  }
  const rows = Object.values(g).sort((a, b) => b.count - a.count);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return {
    total, windowDays: 30,
    items: rows.map((r) => ({ name: r.name, value: total ? Math.round((r.count / total) * 100) : 0, count: r.count, amount: r.amount, avgScore: Math.round(r.scoreSum / r.count), confirmed: r.confirmed, color: COLORS[r.name] ?? "#6c8990" })),
  };
}

export function alertsSummary(db, now = Date.now()) {
  const open = db.transactions.filter((t) => isOpenAlert(db, t));
  const unread = open.filter((t) => !t.alertRead);
  const by = (r) => unread.filter((t) => t.risk === r).length;
  const parts = [["critical", by("Critical")], ["high", by("High")], ["medium", by("Medium")], ["low", by("Low")]].filter(([, n]) => n);
  const resp = (from, to) => { const r = db.transactions.filter((t) => t.decidedAt && t.decidedAt >= from && t.decidedAt < to).map((t) => (t.decidedAt - t.ts) / MIN); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null; };
  const cur = resp(now - 7 * DAY, now + 1), prev = resp(now - 14 * DAY, now - 7 * DAY);
  const change = cur != null && prev ? ((cur - prev) / prev) * 100 : null;
  const prevented = db.transactions.filter((t) => t.analystDecision === "Confirmed fraud" && t.decidedAt >= now - 7 * DAY).reduce((s, t) => s + t.amount, 0);
  return {
    unread: unread.length, open: open.length,
    unreadBreakdown: parts.length ? parts.map(([k, n]) => `${n} ${k}`).join(", ") : "All caught up",
    avgResponseMinutes: cur == null ? null : Math.round(cur), responseChangePct: change == null ? null : Math.round(change),
    prevented: money(prevented), activeRules: db.rules.filter((r) => r.enabled).length,
  };
}

export function alertList(db, { filter = "all", page = 1, pageSize = 8 } = {}) {
  let rows = db.transactions.filter((t) => isOpenAlert(db, t));
  if (filter === "unread") rows = rows.filter((t) => !t.alertRead);
  else if (filter === "critical") rows = rows.filter((t) => t.risk === "Critical");
  else if (filter === "high") rows = rows.filter((t) => t.risk === "High");
  rows.sort((a, b) => (a.alertRead === b.alertRead ? 0 : a.alertRead ? 1 : -1) || priorityOf(b) - priorityOf(a) || b.ts - a.ts);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { items: rows.slice((p - 1) * pageSize, p * pageSize).map((t) => serialize(db, t)), total: rows.length, page: p, pageSize, totalPages };
}
export { decisionOf };
