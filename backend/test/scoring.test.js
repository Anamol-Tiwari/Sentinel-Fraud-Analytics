import test from "node:test";
import assert from "node:assert/strict";
import { buildDatabase } from "../src/seed.js";
import { scoreTransaction } from "../src/scoring.js";
import { createTransaction, decisionOf } from "../src/services/transactions.js";

const db = buildDatabase(Date.now(), 7);
const cust = Object.values(db.customers).find((c) => /^C-\d/.test(c.id));
const dev = Object.keys(cust.devices)[0];

test("typical purchase on a trusted device scores low", () => {
  const s = scoreTransaction(db, { customerId: cust.id, merchant: Object.keys(cust.merchants)[0], category: "Groceries", amount: cust.avgAmount, location: cust.homeCity, deviceId: dev, ts: Date.now(), ipRisk: "clean" });
  assert.ok(s.score < 40, `expected < 40, got ${s.score}`);
});
test("huge foreign purchase from a new proxied device scores critical", () => {
  const s = scoreTransaction(db, { customerId: cust.id, merchant: "CryptoBay", category: "Crypto", amount: cust.avgAmount * 30, location: "Lagos, NG", deviceId: "dev-new", ts: Date.now(), ipRisk: "proxy" });
  assert.ok(s.score >= 91, `expected >= 91, got ${s.score}`);
  assert.equal(s.factors.length, 3);
});
test("ingested transaction is persisted and flagged", () => {
  const before = db.transactions.length;
  const t = createTransaction(db, { customerId: cust.id, merchant: "CryptoBay", amount: cust.avgAmount * 30, location: "Lagos, NG", device: "Brand new", ipRisk: "proxy" });
  assert.equal(db.transactions.length, before + 1);
  assert.equal(decisionOf(db, t), "Review");
});
