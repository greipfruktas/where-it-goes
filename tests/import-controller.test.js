import assert from "node:assert/strict";
import { createImportController } from "../src/import/controller.js";

const root = { hidden: true, innerHTML: "", addEventListener() {}, querySelector: () => null };
const notices = [];
let reads = 0;
let commits = 0;
const fileReader = async () => { reads += 1; return new ArrayBuffer(1); };
const parsed = { transactions: [{ date: "2026-09-01", signedAmount: -5, merchant: "Market", description: "Food", sourceRow: 2 }], unreadableRows: 0 };
const review = {
  rows: [{ id: "swedbank:1", date: "2026-09-01", amount: 5, merchant: "Market", merchantKey: "MARKET", description: "Food", note: "Market", category: "Food", labels: [], reimbursementPercent: 0, duplicate: false, selected: true, needsReview: false, inRange: true }],
  from: "2026-09-01", to: "2026-09-01", categories: [{ name: "Food", emoji: "🥑" }, { name: "Other", emoji: "✨" }], learnedRules: [], pendingRules: [], incomingIgnored: 0, unreadableRows: 0
};
const personalData = {
  snapshot: () => ({ expenses: [], categories: review.categories, importRules: [] }),
  commitImportBatch: () => { commits += 1; return 1; }
};
const controller = createImportController({
  root, fileReader, XLSX: {}, personalData, notify: (message) => notices.push(message),
  parseWorkbook: () => parsed, createState: async () => structuredClone(review),
  buildBatch: (state) => {
    if (state.rows.some(({ amount }) => amount <= 0)) throw new Error("Expense amount is invalid");
    return { expenses: state.rows.filter(({ selected }) => selected), learnedRules: state.pendingRules };
  }
});

controller.open();
await assert.rejects(controller.chooseFile({ name: "statement.pdf", size: 20 }), /xlsx or xls/i);
await assert.rejects(controller.chooseFile({ name: "statement.xlsx", size: 10 * 1024 * 1024 + 1 }), /10 MB/i);
assert.equal(reads, 0, "invalid files must reject before reading");

await controller.chooseFile({ name: "statement.xlsx", size: 100 });
assert.equal(controller.getState().filename, "statement.xlsx");
controller.updateRow("swedbank:1", { category: "Other" });
assert.deepEqual(controller.getState().pendingRules, [{ merchantKey: "MARKET", category: "Other", updatedAt: controller.getState().pendingRules[0].updatedAt }]);
assert.equal(personalData.snapshot().expenses.length, 0, "review edits remain temporary");

controller.updateRow("swedbank:1", { amount: 0 });
assert.throws(() => controller.save(), /amount/i);
assert.equal(commits, 0);
assert.match(controller.getState().rows[0].error, /amount/i);
controller.updateRow("swedbank:1", { amount: 5 });
assert.equal(controller.save(), 1);
assert.equal(commits, 1);
assert.ok(notices.some((message) => /saved locally/i.test(message)));
assert.equal(root.hidden, true);
assert.equal(controller.getState(), null);

await controller.chooseFile({ name: "statement.xls", size: 100 });
controller.close();
assert.equal(controller.getState(), null);
assert.equal(root.hidden, true);

const broken = createImportController({ root, fileReader, XLSX: {}, personalData, notify: () => {}, parseWorkbook: () => { throw new Error("Required Swedbank headers were not found"); } });
await assert.rejects(broken.chooseFile({ name: "bad.xlsx", size: 100 }), /headers/i);
assert.equal(broken.getState().error, "Required Swedbank headers were not found");
