// Seeds a realistic dataset: 30 days of behavioural history for ~220 customers, with fraud
// scenarios (card testing, account takeover, geo anomaly, impossible travel, high-value
// anomaly) injected and then scored by the *same* engine used for live ingestion.
import { riskFromScore, config } from "./config.js";
import { CITIES, INDIAN_CITIES, FOREIGN_CITIES } from "./geo.js";
import { commitProfile, newCustomer, scoreTransaction } from "./scoring.js";
import * as store from "./store.js";

const DAY = 86_400_000, MIN = 60_000;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export const MERCHANTS = [
  ["Nova Electronics", "Electronics"], ["CloudCart Pro", "SaaS"], ["MetroRide Wallet", "Transport"], ["FreshBasket Market", "Groceries"],
  ["Orbit Telecom", "Utilities"], ["Luma Travel", "Travel"], ["GreenLeaf Pharmacy", "Health"], ["PixelHouse Studio", "Services"],
  ["BigBazaar Express", "Groceries"], ["QuickBite Foods", "Food"], ["SwiftCab", "Transport"], ["StreamBox", "Entertainment"],
  ["Urban Threads", "Fashion"], ["BookNest", "Retail"], ["PowerGrid Utilities", "Utilities"], ["SkyHigh Airlines", "Travel"],
  ["TechMart", "Electronics"], ["HomeNeeds", "Retail"], ["FitZone Gym", "Health"], ["Gold Palace Jewellers", "Jewellery"],
  ["GiftCard Hub", "Gift Cards"], ["CryptoBay", "Crypto"], ["DailyDairy", "Groceries"], ["MediPlus", "Health"],
  ["CineMax", "Entertainment"], ["PetPalace", "Retail"], ["AutoCare Garage", "Services"], ["EduLearn Online", "Education"],
  ["Spice Route Restaurant", "Food"], ["Bharat Fuels", "Fuel"], ["MobiRecharge", "Utilities"], ["Skyline Hotels", "Travel"],
];
const DEVICES = ["Chrome · Windows", "Safari · iPhone", "Android · App", "Chrome · Android", "Safari · iPad", "Firefox · Linux", "Chrome · MacOS", "iOS · App"];
const FIRST = ["Aarav", "Diya", "Vivaan", "Ananya", "Kabir", "Isha", "Arjun", "Meera", "Rohan", "Saanvi", "Karan", "Priya", "Neel", "Tara", "Dev", "Riya"];
const LAST = ["Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Mehta", "Das", "Khan", "Singh", "Joshi", "Rao"];
const ANALYSTS = ["Aditya Nair", "Meera Iyer", "Rohan Shah"];

export function buildDatabase(now = Date.now(), seed = 42) {
  const rnd = mulberry32(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const usedIds = new Set();
  const mkId = (n) => { let id; do { id = `TX-${n}${letters[Math.floor(rnd() * letters.length)]}`; } while (usedIds.has(id)); usedIds.add(id); return id; };

  const db = {
    meta: { threshold: 72, queueSort: "priority", championId: "xgboost", seq: 9850, seededAt: new Date(now).toISOString(), retrain: null, lastEvaluatedAt: new Date(now - 14 * MIN).toISOString(), lastRulesSyncAt: null },
    user: { name: "Aditya Nair", initials: "AN", role: "Developer", email: "aditya.nair@sentinel.example", notifications: true },
    customers: {}, deviceOwners: {}, deviceLabels: {}, transactions: [], audit: [],
    models: [
      { id: "xgboost", name: "XGBoost v2.4", type: "Supervised", precision: 91.8, recall: 88.4, auc: 0.982, prAuc: 0.941, status: "Champion", trainedAt: new Date(now - 6 * DAY).toISOString() },
      { id: "random_forest", name: "Random Forest", type: "Supervised", precision: 87.3, recall: 84.9, auc: 0.961, prAuc: 0.918, status: "Stable", trainedAt: new Date(now - 9 * DAY).toISOString() },
      { id: "isolation_forest", name: "Isolation Forest", type: "Unsupervised", precision: 64.1, recall: 71.2, auc: 0.894, prAuc: 0.702, status: "Shadow", trainedAt: new Date(now - 4 * DAY).toISOString() },
      { id: "logistic_regression", name: "Logistic Regression", type: "Baseline", precision: 78.6, recall: 76.8, auc: 0.932, prAuc: 0.861, status: "Baseline", trainedAt: new Date(now - 20 * DAY).toISOString() },
    ],
    rules: [
      { id: "R-1", name: "High-value payment", description: "Amount is at or above the limit", type: "amount_gte", value: 50000, severity: "High", enabled: true },
      { id: "R-2", name: "Velocity burst", description: "Attempts by one customer within 30 minutes", type: "velocity_gte", value: 5, severity: "High", enabled: true },
      { id: "R-3", name: "Impossible travel", description: "Two locations too far apart for the elapsed time", type: "feature", value: "travel", severity: "Critical", enabled: true },
      { id: "R-4", name: "Foreign card use", description: "Transaction country differs from card issuing country", type: "feature", value: "geo", severity: "High", enabled: true },
      { id: "R-5", name: "Shared device", description: "Device used across several customer accounts", type: "feature", value: "shared", severity: "High", enabled: true },
      { id: "R-6", name: "Proxy / VPN traffic", description: "Traffic from a known proxy network", type: "feature", value: "ip", severity: "Medium", enabled: true },
      { id: "R-7", name: "Critical model score", description: "Model risk score is at or above the limit", type: "score_gte", value: 90, severity: "Critical", enabled: true },
      { id: "R-8", name: "Night-time purchase", description: "Purchase between 00:00 and 05:00 local", type: "feature", value: "night", severity: "Low", enabled: false },
    ],
    sources: [
      { id: "card-network", name: "Card network feed", type: "Streaming · Kafka", health: "healthy", enabled: true, latencyMs: 42 },
      { id: "upi-gateway", name: "UPI gateway webhook", type: "Webhook", health: "healthy", enabled: true, latencyMs: 58 },
      { id: "core-banking", name: "Core banking events", type: "Streaming · Kafka", health: "healthy", enabled: true, latencyMs: 71 },
      { id: "mobile-sdk", name: "Mobile SDK telemetry", type: "HTTPS ingest", health: "healthy", enabled: true, latencyMs: 96 },
      { id: "batch-csv", name: "Batch CSV uploads", type: "File import", health: "healthy", enabled: true, latencyMs: 0 },
    ],
    nextRuleSeq: 9, nextAuditSeq: 1,
  };

  // ---- customers with pre-warmed behavioural profiles ----
  const customers = [];
  let devSeq = 1;
  for (let i = 0; i < 220; i++) {
    const home = rnd() < 0.75 ? pick(INDIAN_CITIES.slice(0, 7)) : pick(INDIAN_CITIES);
    const avg = Math.round(Math.exp(between(Math.log(700), Math.log(9000))));
    const id = `C-${1000 + i}`;
    const last4 = String(Math.floor(between(1000, 9999)));
    const kind = rnd();
    const method = kind < 0.55 ? `Card · •••• ${last4}` : kind < 0.85 ? `UPI · •••• ${last4}` : `Netbanking · ${pick(["HDFC", "ICICI", "SBI", "Axis"])}`;
    const devs = Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => ({ id: `dev-${devSeq++}`, label: pick(DEVICES) }));
    const favs = Array.from({ length: 4 + Math.floor(rnd() * 4) }, () => pick(MERCHANTS));
    const c = newCustomer(id, home, avg);
    c.count = 12; c.name = `${pick(FIRST)} ${pick(LAST)}`; c.method = method; c.favs = favs.map((f) => f[0]);
    devs.forEach((d) => { c.devices[d.id] = 8; db.deviceLabels[d.id] = d.label; (db.deviceOwners[d.id] ??= []).push(id); });
    favs.forEach(([m]) => { c.merchants[m] = 3; });
    c.last = { ts: now - 40 * DAY, location: home };
    db.customers[id] = c;
    customers.push({ id, home, avg, method, devs, favs });
  }

  // ---- generate events ----
  const events = [];
  const seedEnd = now - 2 * 3_600_000; // newest synthetic event is 2h old; hero rows below are the freshest
  const dayStartOf = (k) => { const d = new Date(now - (29 - k) * DAY); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hourWeights = [1, 1, 1, 1, 1, 2, 4, 7, 9, 10, 10, 10, 9, 9, 9, 9, 9, 10, 10, 9, 7, 5, 3, 2];
  const wsum = hourWeights.reduce((a, b) => a + b, 0);
  const randTime = (k) => {
    for (let tries = 0; tries < 40; tries++) {
      let r = rnd() * wsum, h = 0;
      while (r > hourWeights[h]) { r -= hourWeights[h]; h++; }
      const t = dayStartOf(k) + h * 3_600_000 + rnd() * 3_600_000;
      if (t <= seedEnd - 3 * MIN) return t;
    }
    return dayStartOf(k) + rnd() * Math.max(MIN, seedEnd - 3 * MIN - dayStartOf(k));
  };
  const ev = (c, over) => events.push({ customerId: c.id, merchant: "", category: "", amount: 0, location: c.home, deviceId: c.devs[0].id, device: c.devs[0].label, method: c.method, ipRisk: "clean", source: pick(["card-network", "upi-gateway", "core-banking", "mobile-sdk"]), ...over });

  for (let k = 0; k < 30; k++) {
    const dayStart = dayStartOf(k);
    if (dayStart > seedEnd) continue;
    const frac = Math.min(1, Math.max(0, (seedEnd - dayStart) / DAY)); // partial day (today)
    // normal traffic
    const normalN = Math.round(between(62, 82) * frac);
    for (let i = 0; i < normalN; i++) {
      const c = pick(customers), [m, cat] = rnd() < 0.7 ? pick(c.favs) : pick(MERCHANTS), d = pick(c.devs);
      const away = rnd() < 0.04;
      ev(c, { ts: randTime(k), merchant: m, category: cat, amount: Math.max(49, Math.round(c.avg * Math.exp(between(-0.7, 0.8)))), deviceId: d.id, device: d.label, location: away ? pick(INDIAN_CITIES.slice(0, 5)) : c.home });
    }
    // fraud scenarios: volume ramps up over the month
    const scenarios = Math.round((2 + (k / 29) * 6 + between(0, 2)) * frac);
    for (let s = 0; s < scenarios; s++) {
      const t0 = randTime(k), kind = rnd();
      const c = pick(customers), [m, cat] = pick(MERCHANTS.filter(([, x]) => ["Electronics", "Gift Cards", "Crypto", "Jewellery", "Travel", "SaaS", "Retail"].includes(x)));
      const nd = { id: `dev-${devSeq++}`, label: pick(DEVICES) };
      if (kind < 0.28) { // card testing
        const n = 4 + Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) ev(c, { ts: t0 + i * between(1, 3.5) * MIN, merchant: m, category: cat, amount: Math.round(between(20, 450)), deviceId: nd.id, device: nd.label, ipRisk: rnd() < 0.5 ? "proxy" : "clean", location: rnd() < 0.5 ? pick(FOREIGN_CITIES) : c.home });
      } else if (kind < 0.55) { // account takeover (device ring)
        const ring = { id: `dev-${devSeq++}`, label: pick(DEVICES) };
        const victims = [c, ...Array.from({ length: 3 }, () => pick(customers))];
        victims.forEach((v, i) => ev(v, { ts: t0 + i * between(4, 20) * MIN, merchant: m, category: cat, amount: Math.round(v.avg * between(5, 14)), deviceId: ring.id, device: ring.label, ipRisk: "proxy" }));
      } else if (kind < 0.75) { // geo anomaly
        ev(c, { ts: t0, merchant: m, category: cat, amount: Math.round(c.avg * between(3, 9)), deviceId: nd.id, device: nd.label, location: pick(FOREIGN_CITIES), ipRisk: rnd() < 0.6 ? "proxy" : "clean" });
      } else if (kind < 0.9) { // impossible travel
        const far = pick(INDIAN_CITIES.filter((x) => x !== c.home));
        ev(c, { ts: t0, merchant: pick(MERCHANTS)[0], category: "Retail", amount: Math.round(c.avg * between(0.8, 1.6)) });
        ev(c, { ts: t0 + between(20, 55) * MIN, merchant: m, category: cat, amount: Math.round(c.avg * between(3, 7)), deviceId: nd.id, device: nd.label, location: far });
      } else { // high-value anomaly on trusted device
        ev(c, { ts: t0, merchant: m, category: cat, amount: Math.round(c.avg * between(10, 25)) });
      }
    }
  }
  events.sort((a, b) => a.ts - b.ts);

  // ---- score chronologically using the live engine ----
  let seq = 5000;
  for (const e of events) {
    db.deviceLabels[e.deviceId] ??= e.device;
    const s = scoreTransaction(db, e);
    commitProfile(db, e);
    const mr = rnd();
    const model = s.score >= 85 ? (mr < 0.72 ? "XGBoost v2.4" : "Random Forest") : s.score >= 60 ? (mr < 0.4 ? "XGBoost v2.4" : mr < 0.8 ? "Random Forest" : "Isolation Forest") : (mr < 0.4 ? "XGBoost v2.4" : mr < 0.65 ? "Logistic Regression" : "Isolation Forest");
    db.transactions.push({ id: mkId(seq++), ts: e.ts, merchant: e.merchant, category: e.category, location: e.location, amount: e.amount, score: s.score, risk: s.risk, method: e.method, device: e.device, deviceId: e.deviceId, customerId: e.customerId, anomaly: s.anomaly, signalType: s.signalType, model, factors: s.factors, velocity: s.velocity, keys: featureKeys(s), source: e.source, analystDecision: null, alertRead: true, notes: [] });
  }

  // ---- hero transactions (the rows from the original mock-up, kept verbatim) ----
  const H = (id, minsAgo, merchant, category, location, amount, score, method, device, anomaly, model, factors, signalType, keys, velocity = 1, home = location) => {
    const cid = `C-H${id.slice(-5)}`;
    usedIds.add(id);
    const c = newCustomer(cid, home, Math.max(500, amount / 5)); c.count = 14; db.customers[cid] = c;
    db.transactions.push({ id, ts: now - minsAgo * MIN - Math.floor(rnd() * 40_000), merchant, category, location, amount, score, risk: riskFromScore(score), method, device, deviceId: `dev-${cid}`, customerId: cid, anomaly, signalType, model, factors, velocity, keys, source: "card-network", analystDecision: null, alertRead: true, notes: [] });
  };
  H("TX-9771H", 105, "PixelHouse Studio", "Services", "Delhi, IN", 24200, 76, "Card · •••• 9012", "Firefox · Linux", "New merchant", "Random Forest", [{ label: "New merchant", value: "No prior relationship", weight: 72, tone: "danger" }, { label: "Device mismatch", value: "Device seen in 4 accounts", weight: 63, tone: "amber" }, { label: "Amount deviation", value: "4.1× personal average", weight: 49, tone: "lime" }], "Account takeover", ["merchant", "shared", "amount"]);
  H("TX-9788G", 80, "GreenLeaf Pharmacy", "Health", "Kolkata, IN", 1860, 37, "UPI · •••• 3371", "Android · App", "No signal", "Logistic Regression", [{ label: "Trusted device", value: "Seen 52 times", weight: 8, tone: "lime" }, { label: "Usual merchant", value: "Regular purchase", weight: 5, tone: "lime" }, { label: "Normal velocity", value: "Within baseline", weight: 3, tone: "lime" }], "Amount anomaly", []);
  H("TX-9796E", 61, "Luma Travel", "Travel", "Chennai, IN", 31800, 90, "Card · •••• 2185", "Safari · iPad", "Impossible travel", "XGBoost v2.4", [{ label: "Impossible travel", value: "Delhi → Chennai in 46 min", weight: 89, tone: "danger" }, { label: "High-value purchase", value: "6.4× personal average", weight: 70, tone: "amber" }, { label: "New merchant", value: "First purchase here", weight: 52, tone: "lime" }], "Geo anomaly", ["travel", "merchant", "amount", "category"], 1, "Delhi, IN");
  H("TX-9804D", 48, "Orbit Telecom", "Utilities", "Hyderabad, IN", 780, 44, "Netbanking · HDFC", "Chrome · MacOS", "Low confidence", "Isolation Forest", [{ label: "Time anomaly", value: "Outside normal window", weight: 31, tone: "amber" }, { label: "Merchant history", value: "Known for 9 months", weight: 12, tone: "lime" }, { label: "Device match", value: "Trusted device", weight: 8, tone: "lime" }], "Amount anomaly", ["night"]);
  H("TX-9817C", 25, "FreshBasket Market", "Groceries", "Pune, IN", 2360, 68, "Card · •••• 7364", "Chrome · Android", "Amount deviation", "Isolation Forest", [{ label: "Amount deviation", value: "2.2× personal average", weight: 55, tone: "amber" }, { label: "Time anomaly", value: "Purchase at 03:18 local", weight: 42, tone: "amber" }, { label: "Trusted device", value: "Seen 18 times", weight: 16, tone: "lime" }], "Amount anomaly", ["amount", "night"]);
  H("TX-9829B", 12, "MetroRide Wallet", "Transport", "Bengaluru, IN", 4850, 81, "UPI · •••• 8824", "Android · App", "Pattern deviation", "Random Forest", [{ label: "Pattern deviation", value: "Outside weekly rhythm", weight: 74, tone: "danger" }, { label: "Amount cluster", value: "3 similar attempts", weight: 58, tone: "amber" }, { label: "Session age", value: "Account created yesterday", weight: 39, tone: "lime" }], "Card testing", ["velocity"], 3);
  H("TX-9838F", 6, "CloudCart Pro", "SaaS", "Singapore, SG", 12990, 94, "Card · •••• 1198", "Safari · iPhone", "Geo mismatch", "XGBoost v2.4", [{ label: "Geo mismatch", value: "Card issued in Delhi", weight: 90, tone: "danger" }, { label: "IP reputation", value: "Known proxy network", weight: 78, tone: "amber" }, { label: "Merchant shift", value: "First SaaS purchase", weight: 41, tone: "lime" }], "Geo anomaly", ["geo", "ip", "merchant"], 1, "Delhi, IN");
  H("TX-9842A", 2, "Nova Electronics", "Electronics", "Mumbai, IN", 84200, 98, "Card · •••• 4021", "Chrome · Windows", "Velocity spike", "XGBoost v2.4", [{ label: "Unusual amount", value: "₹84,200 vs ₹4,850 avg", weight: 92, tone: "danger" }, { label: "Velocity spike", value: "7 attempts in 18 min", weight: 84, tone: "amber" }, { label: "New device", value: "First seen 12 min ago", weight: 68, tone: "lime" }], "Card testing", ["amount", "velocity", "device", "category"], 7);

  // ---- analyst decisions on historical flagged items ----
  const thr = db.meta.threshold;
  const flagged = (t) => t.score >= thr || matchesAnyRule(db.rules, t);
  const ageH = (t) => (now - t.ts) / 3_600_000;
  const open = [];
  for (const t of db.transactions) {
    if (t.id.startsWith("TX-9") && t.ts > now - 3 * 3_600_000) { if (flagged(t)) open.push(t); continue; }
    if (!flagged(t)) continue;
    const p = ageH(t) > 24 ? 0.88 : 0.3;
    if (rnd() < p) {
      t.analystDecision = rnd() < (t.score >= 85 ? 0.93 : 0.8) ? "Confirmed fraud" : "False positive";
      t.decidedAt = t.ts + Math.round(between(4, 90) * MIN); if (t.decidedAt > now) t.decidedAt = now - MIN;
      t.decidedBy = pick(ANALYSTS);
      audit(db, { ts: t.decidedAt, actor: t.decidedBy, action: t.analystDecision === "Confirmed fraud" ? "decision.confirm_fraud" : "decision.false_positive", target: t.id, detail: `${t.merchant} · ₹${t.amount.toLocaleString("en-IN")}` });
    } else open.push(t);
  }
  // 7 newest open alerts are unread
  open.sort((a, b) => b.ts - a.ts).slice(0, 7).forEach((t) => { t.alertRead = false; });

  audit(db, { ts: now - 6 * DAY, actor: "System", action: "model.retrain", target: "XGBoost v2.4", detail: "Scheduled retraining completed (PR-AUC 0.941)" });
  audit(db, { ts: now - 3 * DAY, actor: "Meera Iyer", action: "threshold.update", target: "Review threshold", detail: "Changed from 70 to 72" });
  audit(db, { ts: now - 2 * DAY, actor: "Aditya Nair", action: "rule.update", target: "R-2 Velocity burst", detail: "Limit changed from 6 to 5" });
  audit(db, { ts: now - 20 * MIN, actor: "System", action: "model.evaluate", target: "XGBoost v2.4", detail: "Evaluated on 1.2M transactions" });

  db.transactions.sort((a, b) => a.ts - b.ts);
  db.audit.sort((a, b) => a.ts - b.ts);
  return db;
}

function featureKeys(s) {
  // Rebuild the feature key set from the factor labels (used by alert rules).
  const map = { "Impossible travel": "travel", "Geo mismatch": "geo", "Device mismatch": "shared", "New device": "device", "New merchant": "merchant", "Time anomaly": "night", "IP reputation": "ip", "Unusual amount": "amount", "Amount deviation": "amount", "Velocity spike": "velocity", "High-risk category": "category" };
  return s.factors.map((f) => map[f.label]).filter(Boolean);
}
export { featureKeys };

export function matchesRule(rule, t) {
  if (!rule.enabled) return false;
  switch (rule.type) {
    case "amount_gte": return t.amount >= rule.value;
    case "score_gte": return t.score >= rule.value;
    case "velocity_gte": return (t.velocity ?? 1) >= rule.value;
    case "feature": return (t.keys ?? []).includes(rule.value);
    default: return false;
  }
}
export const matchesAnyRule = (rules, t) => rules.some((r) => matchesRule(r, t));

export function audit(db, { ts = Date.now(), actor, action, target, detail }) {
  db.audit.push({ id: `A-${db.nextAuditSeq++}`, ts, actor, action, target, detail });
  if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
}

export function seedAndSave() {
  const db = buildDatabase();
  store.replace(db);
  return db;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()) && process.argv.includes("--reset")) {
  const db = seedAndSave();
  await store.flushNow();
  console.log(`Seeded ${db.transactions.length} transactions, ${Object.keys(db.customers).length} customers -> ${store.dbFile}`);
}
