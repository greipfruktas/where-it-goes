import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const values = new Map();
function element() {
  return { value: "", hidden: false, innerHTML: "", textContent: "", addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, setAttribute() {}, reset() {}, showPicker() {} };
}
const sandbox = {
  Intl, console, structuredClone,
  crypto: { randomUUID: () => "manual-id" },
  localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) },
  document: { body: { dataset: {}, style: {} }, querySelector: () => element(), querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ click() {} }) },
  window: { addEventListener() {}, scrollTo() {} }, navigator: {}, setTimeout: () => 1, clearTimeout() {}
};
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.__saveGroups = saveGroups;`, sandbox);

const bridge = sandbox.whereItGoesPersonalData;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(bridge.snapshot().importRules), []);
const mutations = [];
bridge.onMutation((mutation) => mutations.push(mutation));
const valid = {
  id: "swedbank:one", amount: 12.34, category: "Food", labels: ["Must"], reimbursementPercent: 0,
  date: "2026-09-01", note: "Market", createdAt: 10
};
assert.equal(bridge.commitImportBatch({ expenses: [valid], learnedRules: [{ merchantKey: "MARKET", category: "Food", updatedAt: 10 }] }), 1);
assert.equal(bridge.snapshot().expenses.length, 1);
assert.deepEqual(plain(bridge.snapshot().importRules), [{ merchantKey: "MARKET", category: "Food", updatedAt: 10 }]);
assert.match(values.get("where-it-goes-import-rules-v1"), /MARKET/);
assert.deepEqual(mutations.map(({ kind }) => kind), ["expense_upsert", "settings_replace"]);

bridge.commitImportBatch({ expenses: [{ ...valid, amount: 20, note: "Replacement" }], learnedRules: [] });
assert.equal(bridge.snapshot().expenses.length, 1, "matching deterministic IDs replace instead of duplicate");
assert.equal(bridge.snapshot().expenses[0].amount, 20);

const before = JSON.stringify(bridge.snapshot());
const mutationCount = mutations.length;
assert.throws(() => bridge.commitImportBatch({ expenses: [valid, { ...valid, id: "bad", amount: 0 }], learnedRules: [] }), /amount/i);
assert.equal(JSON.stringify(bridge.snapshot()), before, "invalid batch must be atomic");
assert.equal(mutations.length, mutationCount);

bridge.useNamespace("user-a", { expenses: [], categories: bridge.snapshot().categories, style: "pocket", importRules: [{ merchantKey: "BUS", category: "Transport", updatedAt: 20 }] });
assert.deepEqual(plain(bridge.snapshot().importRules), [{ merchantKey: "BUS", category: "Transport", updatedAt: 20 }]);
assert.match(values.get("where-it-goes-personal-cache-v2:user-a"), /BUS/);

bridge.useNamespace("guest", { expenses: [], categories: [{ name: "Food", emoji: "🥑", color: "#eee" }], style: "pocket", importRules: [{ merchantKey: "CAFE", category: "Food", updatedAt: 30 }] });
sandbox.document.querySelector = (selector) => selector.includes("group-name") ? { value: "Groceries" } : selector.includes("group-emoji") ? { value: "🛒" } : element();
sandbox.__saveGroups();
assert.deepEqual(JSON.parse(values.get("where-it-goes-import-rules-v1")), [{ merchantKey: "CAFE", category: "Groceries", updatedAt: 30 }]);
