// Real-time fraud scoring engine.
// Behavioural features are computed against the customer's own history, then combined by a
// logistic model into a 0-100 risk score. Every feature is returned as an explainable "factor"
// (this is what the UI shows in the SHAP-style "Why this was flagged" panel).
import { riskFromScore } from "./config.js";
import { CITIES, country, distanceKm } from "./geo.js";

const MAX_SPEED_KMH = 900;
const HIGH_RISK_CATEGORIES = new Set(["Electronics", "Travel", "Gift Cards", "Crypto", "Jewellery"]);
const BIAS = -3.4;
const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function getCustomer(db, id) {
  return db.customers[id];
}

export function newCustomer(id, homeCity, avgAmount = 3000) {
  return { id, homeCity, avgAmount, count: 0, devices: {}, merchants: {}, recent: [], last: null };
}

/** Compute features + score for a transaction input. Does not mutate state. */
export function scoreTransaction(db, input) {
  const cust = db.customers[input.customerId] ?? newCustomer(input.customerId, input.location);
  const ts = input.ts;
  const f = [];
  const add = (key, label, value, contrib, extra = {}) => f.push({ key, label, value, contrib, ...extra });

  // Amount vs. personal average
  const avg = cust.count > 0 ? cust.avgAmount : 3000;
  const ratio = input.amount / Math.max(avg, 1);
  if (ratio >= 1.5) {
    const c = Math.min(3.6, 0.9 * Math.log2(ratio));
    add("amount", ratio >= 3 ? "Unusual amount" : "Amount deviation",
      ratio >= 3 && ratio > 8 ? `${inr(input.amount)} vs ${inr(avg)} avg` : `${ratio.toFixed(1)}× personal average`, c);
  }

  // Velocity: attempts in the last 30 minutes (including this one)
  const velocity = cust.recent.filter((t) => ts - t <= 30 * 60_000 && ts - t >= 0).length + 1;
  if (velocity >= 3) {
    add("velocity", "Velocity spike", `${velocity} attempts in 30 min`, Math.min(4.0, 0.8 * (velocity - 2)));
  }

  // Geography
  let impossible = false;
  if (cust.last && cust.last.location !== input.location && CITIES[cust.last.location] && CITIES[input.location]) {
    const km = distanceKm(cust.last.location, input.location);
    const hours = Math.max((ts - cust.last.ts) / 3_600_000, 1 / 60);
    if (km > 200 && km / hours > MAX_SPEED_KMH) {
      impossible = true;
      add("travel", "Impossible travel",
        `${cust.last.location.split(",")[0]} → ${input.location.split(",")[0]} in ${Math.max(1, Math.round(hours * 60))} min`, 2.6);
    }
  }
  const foreign = country(input.location) !== country(cust.homeCity);
  if (foreign) add("geo", "Geo mismatch", `Card issued in ${cust.homeCity.split(",")[0]}`, 2.2);

  // Device
  const owners = db.deviceOwners[input.deviceId] ?? [];
  const seen = cust.devices[input.deviceId] ?? 0;
  const otherOwners = owners.filter((o) => o !== input.customerId).length;
  if (otherOwners >= 3) add("shared", "Device mismatch", `Device seen in ${otherOwners + 1} accounts`, 1.4);
  if (seen === 0 && cust.count > 0) add("device", "New device", "First seen on this account", 1.0);

  // Merchant
  if ((cust.merchants[input.merchant] ?? 0) === 0 && cust.count > 3) {
    add("merchant", "New merchant", "No prior relationship", 0.6);
  }

  // Time of day
  const d = new Date(ts);
  if (d.getHours() < 5) {
    add("night", "Time anomaly", `Purchase at ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} local`, 0.6);
  }

  if (HIGH_RISK_CATEGORIES.has(input.category)) add("category", "High-risk category", input.category, 0.4);
  if (input.ipRisk === "proxy") add("ip", "IP reputation", "Known proxy network", 1.6);

  const z = BIAS + f.reduce((s, x) => s + x.contrib, 0);
  const score = Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-z)))));

  f.sort((a, b) => b.contrib - a.contrib);
  const factors = f.slice(0, 3).map((x) => {
    const weight = Math.min(99, Math.round((x.contrib / 3.0) * 100));
    return { label: x.label, value: x.value, weight, tone: weight >= 70 ? "danger" : weight >= 40 ? "amber" : "lime" };
  });
  // Pad with protective signals so the panel always has three rows.
  const pad = [
    seen > 2 ? { label: "Trusted device", value: `Seen ${seen} times`, weight: Math.max(3, 14 - seen), tone: "lime" } : null,
    (cust.merchants[input.merchant] ?? 0) > 1 ? { label: "Usual merchant", value: "Regular purchase", weight: 5, tone: "lime" } : null,
    velocity < 3 ? { label: "Normal velocity", value: "Within baseline", weight: 3, tone: "lime" } : null,
    { label: "Normal amount", value: "Within personal range", weight: 4, tone: "lime" },
    { label: "Home region", value: cust.homeCity, weight: 3, tone: "lime" },
  ].filter(Boolean);
  for (const p of pad) { if (factors.length >= 3) break; if (!factors.some((x) => x.label === p.label)) factors.push(p); }

  const top = f[0];
  const anomaly = score >= 60 && top ? top.label : score >= 40 ? "Low confidence" : "No signal";
  const keys = new Set(f.map((x) => x.key));
  let signalType = "Amount anomaly";
  if (velocity >= 4 && !impossible) signalType = input.amount < 5000 || ratio < 1.5 ? "Card testing" : "Velocity";
  else if (impossible || keys.has("geo")) signalType = keys.has("device") && keys.has("ip") ? "Account takeover" : "Geo anomaly";
  else if (keys.has("device") || keys.has("shared") || keys.has("ip")) signalType = "Account takeover";
  else if (keys.has("merchant") && !keys.has("amount")) signalType = "Account takeover";

  return { score, risk: riskFromScore(score), factors, anomaly, signalType, velocity };
}

/** Record the transaction in the customer's behavioural profile. */
export function commitProfile(db, input) {
  const c = (db.customers[input.customerId] ??= newCustomer(input.customerId, input.location));
  c.avgAmount = (c.avgAmount * c.count + input.amount) / (c.count + 1);
  c.count += 1;
  c.devices[input.deviceId] = (c.devices[input.deviceId] ?? 0) + 1;
  c.merchants[input.merchant] = (c.merchants[input.merchant] ?? 0) + 1;
  c.recent = [...c.recent.filter((t) => input.ts - t < 3_600_000), input.ts];
  if (!c.last || input.ts >= c.last.ts) c.last = { ts: input.ts, location: input.location };
  const owners = (db.deviceOwners[input.deviceId] ??= []);
  if (!owners.includes(input.customerId)) owners.push(input.customerId);
}

export function recommendation(risk) {
  return {
    Critical: "Hold payment and request step-up verification.",
    High: "Request step-up verification before settlement.",
    Medium: "Allow, but queue for an analyst spot check.",
    Low: "No action needed. Continue to monitor.",
  }[risk];
}
