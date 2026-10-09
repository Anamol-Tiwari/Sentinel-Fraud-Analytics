// If the server hasn't run for a while the demo data would look stale ("Today" empty).
// Shift every timestamp forward so the newest event is ~2 minutes old again.
const HOUR = 3_600_000;
export function rebaseIfStale(db, now = Date.now()) {
  if (process.env.REBASE_DATA === "false" || !db.transactions.length) return 0;
  const newest = db.transactions.reduce((m, t) => Math.max(m, t.ts), 0);
  if (now - newest < 12 * HOUR) return 0;
  const shift = now - newest - 2 * 60_000;
  const iso = (v) => (v ? new Date(Date.parse(v) + shift).toISOString() : v);
  for (const t of db.transactions) {
    t.ts += shift;
    if (t.decidedAt) t.decidedAt += shift;
    t.notes?.forEach((n) => { n.timestamp = iso(n.timestamp); });
  }
  db.audit.forEach((a) => { a.ts += shift; });
  for (const c of Object.values(db.customers)) {
    if (c.last) c.last.ts += shift;
    c.recent = (c.recent ?? []).map((x) => x + shift);
  }
  const m = db.meta;
  for (const k of ["seededAt", "lastEvaluatedAt", "lastRulesSyncAt"]) m[k] = iso(m[k]);
  if (m.retrain) for (const k of ["startedAt", "finishedAt"]) m.retrain[k] = iso(m.retrain[k]);
  db.models.forEach((x) => { x.trainedAt = iso(x.trainedAt); });
  db.sources.forEach((x) => { if (x.lastCheckedAt) x.lastCheckedAt = iso(x.lastCheckedAt); });
  return shift;
}
