// Generates realistic live events (normal + fraud scenarios) and pushes them through the scoring engine.
import * as store from "../store.js";
import { audit } from "../seed.js";
import { INDIAN_CITIES, FOREIGN_CITIES } from "../geo.js";
import { MERCHANTS } from "../seed.js";
import { createTransaction } from "./transactions.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const between = (a, b) => a + Math.random() * (b - a);
const RISKY = MERCHANTS.filter(([, c]) => ["Electronics", "Gift Cards", "Crypto", "Jewellery", "Travel", "SaaS"].includes(c));
const DEVICES = ["Chrome · Windows", "Safari · iPhone", "Android · App", "Chrome · Android", "Safari · iPad", "Firefox · Linux"];

export function enabledSources(db) { return db.sources.filter((s) => s.enabled); }

export function simulateBatch(db, count = 10, fraudRatio = 0.25) {
  const sources = enabledSources(db).filter((x) => x.id !== "batch-csv");
  if (!sources.length) throw Object.assign(new Error("All data sources are paused. Enable one first."), { status: 409 });
  const customers = Object.values(db.customers).filter((c) => /^C-\d/.test(c.id));
  const created = [];
  let now = Date.now() - count * 1500;
  const make = (c, over) => {
    now += between(500, 2500);
    const t = createTransaction(db, { customerId: c.id, ts: Math.min(now, Date.now()), source: pick(sources).id, method: c.method, ...over });
    created.push(t);
  };
  while (created.length < count) {
    const c = pick(customers);
    const primary = Object.entries(c.devices).sort((a, b) => b[1] - a[1])[0]?.[0];
    const home = { device: db.deviceLabels[primary], deviceId: primary, location: c.homeCity };
    if (Math.random() >= fraudRatio) {
      const m = Math.random() < 0.7 && c.favs?.length ? c.favs[0 | (Math.random() * c.favs.length)] : pick(MERCHANTS)[0];
      make(c, { ...home, merchant: m, amount: Math.max(49, Math.round(c.avgAmount * Math.exp(between(-0.7, 0.8)))) });
      continue;
    }
    const [m, cat] = pick(RISKY), kind = Math.random(), dev = `${pick(DEVICES)}`;
    if (kind < 0.3) { // card testing burst
      const n = Math.min(count - created.length, 4 + Math.floor(Math.random() * 4));
      for (let i = 0; i < n; i++) make(c, { merchant: m, category: cat, amount: Math.round(between(20, 450)), device: dev, ipRisk: Math.random() < 0.5 ? "proxy" : "clean", location: home.location });
    } else if (kind < 0.55) make(c, { merchant: m, category: cat, amount: Math.round(c.avgAmount * between(5, 14)), device: dev, ipRisk: "proxy", location: home.location });
    else if (kind < 0.8) make(c, { merchant: m, category: cat, amount: Math.round(c.avgAmount * between(3, 9)), device: dev, location: pick(FOREIGN_CITIES), ipRisk: Math.random() < 0.6 ? "proxy" : "clean" });
    else { make(c, { ...home, merchant: pick(MERCHANTS)[0], amount: Math.round(c.avgAmount) }); make(c, { merchant: m, category: cat, amount: Math.round(c.avgAmount * between(3, 7)), device: dev, location: pick(INDIAN_CITIES.filter((x) => x !== c.homeCity)) }); }
  }
  return created;
}

// ---- background live stream ----
let timer = null;
let state = { running: false, ratePerMin: 12, startedAt: null, generated: 0 };
export const simulatorStatus = () => ({ ...state });

export function startSimulator(ratePerMin = 12, actor = "System") {
  stopSimulator(true);
  state = { running: true, ratePerMin, startedAt: new Date().toISOString(), generated: 0 };
  const everyMs = Math.max(1000, Math.round(60_000 / ratePerMin));
  timer = setInterval(() => {
    try {
      const db = store.get();
      if (!enabledSources(db).length) return;
      state.generated += simulateBatch(db, 1, 0.3).length;
      store.save();
    } catch (e) { console.error("simulator:", e.message); }
  }, everyMs);
  timer.unref?.();
  const db = store.get();
  audit(db, { actor, action: "ingest.stream_start", target: "Live simulator", detail: `${ratePerMin} events/min` });
  store.save();
  return simulatorStatus();
}
export function stopSimulator(silent = false, actor = "System") {
  if (timer) clearInterval(timer);
  timer = null;
  const was = state.running;
  state = { ...state, running: false };
  if (was && !silent) { audit(store.get(), { actor, action: "ingest.stream_stop", target: "Live simulator", detail: `${state.generated} events generated` }); store.save(); }
  return simulatorStatus();
}
