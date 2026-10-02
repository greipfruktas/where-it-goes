import assert from "node:assert/strict";
import {
  chooseInitialSettings,
  deletionToOperation,
  expenseToOperation,
  mergeExpenseRows,
  normalizeLegacyExpenses,
  normalizeImportRules,
  settingsToOperation
} from "../src/personal-sync/domain.js";

const legacy = [{
  id: 1700000000000,
  amount: 12.5,
  category: "Food",
  labels: ["Must"],
  reimbursementPercent: 50,
  date: "2026-09-26",
  note: "Lunch",
  createdAt: 1700000000000
}];
const normalized = normalizeLegacyExpenses(legacy, "phone-a", () => "phone-a:1");
assert.equal(normalized.expenses[0].id, "phone-a:legacy-1700000000000");
assert.equal(normalized.expenses[0].amount, 12.5);
assert.deepEqual(normalized.expenses[0].labels, ["Must"]);
assert.equal(normalized.operations[0].operation_id, "phone-a:1");
assert.equal(normalized.invalid.length, 0);

const sameLegacyOnAnotherDevice = normalizeLegacyExpenses(legacy, "phone-b", () => "phone-b:1");
assert.notEqual(normalized.expenses[0].id, sameLegacyOnAnotherDevice.expenses[0].id);

const stableId = crypto.randomUUID();
const stable = normalizeLegacyExpenses([{ ...legacy[0], id: stableId }], "phone-a", () => "phone-a:2");
assert.equal(stable.expenses[0].id, stableId);

const malformed = normalizeLegacyExpenses([
  { ...legacy[0], id: "bad-amount", amount: 0 },
  { ...legacy[0], id: "bad-date", date: "2026-02-31" },
  { ...legacy[0], id: "bad-labels", labels: "Must" },
  { ...legacy[0], id: "bad-percent", reimbursementPercent: 101 }
], "phone-a", () => "unused");
assert.equal(malformed.expenses.length, 0);
assert.equal(malformed.invalid.length, 4);

const inputs = [
  { id: "e1", amount: 10, serverUpdatedAt: "2026-09-26T10:00:00Z" },
  { id: "local-only", amount: 2, serverUpdatedAt: "2026-09-26T09:00:00Z" }
];
const cloud = [
  { id: "e1", deletedAt: "2026-09-26T11:00:00Z", serverUpdatedAt: "2026-09-26T11:00:00Z" },
  { id: "cloud-only", amount: 3, serverUpdatedAt: "2026-09-26T08:00:00Z" }
];
const merged = mergeExpenseRows(inputs, cloud);
assert.equal(merged.find((row) => row.id === "e1").deletedAt, "2026-09-26T11:00:00Z");
assert.deepEqual(merged.map((row) => row.id).sort(), ["cloud-only", "e1", "local-only"]);
assert.equal(inputs[0].deletedAt, undefined, "merge must not mutate local rows");

const offlineDelete = mergeExpenseRows(
  [{ id: "e2", deletedAt: "2026-09-26T12:00:00Z", serverUpdatedAt: "2026-09-26T12:00:00Z" }],
  [{ id: "e2", amount: 9, serverUpdatedAt: "2026-09-26T11:00:00Z" }]
);
assert.ok(offlineDelete[0].deletedAt);

const defaultSettings = { categories: [{ name: "Food", emoji: "🥑", color: "#e6f0df" }], style: "pocket", importRules: [] };
const customCloudSettings = { categories: [{ name: "Lunch", emoji: "🍜", color: "#eeeeee" }], style: "neon", importRules: [{ merchantKey: "CAFE", category: "Lunch", updatedAt: 2 }] };
assert.deepEqual(
  chooseInitialSettings({ local: defaultSettings, cloud: customCloudSettings, localIsDefault: true }),
  { settings: customCloudSettings, upload: false }
);
assert.deepEqual(
  chooseInitialSettings({ local: { ...defaultSettings, style: "swiss" }, cloud: customCloudSettings, localIsDefault: false }),
  { settings: customCloudSettings, upload: false }
);
assert.deepEqual(
  chooseInitialSettings({ local: defaultSettings, cloud: null, localIsDefault: true }),
  { settings: defaultSettings, upload: true }
);
assert.deepEqual(
  chooseInitialSettings({ local: defaultSettings, cloud: { categories: [], style: "neon", importRules: [] }, localIsDefault: false }),
  { settings: defaultSettings, upload: true },
  "an empty cloud category list must not erase usable local categories"
);

assert.deepEqual(expenseToOperation(normalized.expenses[0], "phone-a:3"), {
  operation_id: "phone-a:3",
  kind: "expense_upsert",
  expense: {
    id: "phone-a:legacy-1700000000000",
    amount_minor: 1250,
    category: "Food",
    labels: ["Must"],
    reimbursement_percent: 50,
    date: "2026-09-26",
    note: "Lunch",
    created_at_client: 1700000000000
  }
});
assert.deepEqual(deletionToOperation("e1", "phone-a:4"), {
  operation_id: "phone-a:4",
  kind: "expense_delete",
  expense_id: "e1"
});
assert.deepEqual(normalizeImportRules(null), []);
assert.deepEqual(normalizeImportRules({}), []);
assert.deepEqual(normalizeImportRules([{ merchantKey: " CAFE ", category: "Food", updatedAt: 3 }, { merchantKey: "", category: "Food", updatedAt: 1 }]), [{ merchantKey: "CAFE", category: "Food", updatedAt: 3 }]);
assert.deepEqual(settingsToOperation(defaultSettings, "phone-a:5"), {
  operation_id: "phone-a:5", kind: "settings_replace", categories: defaultSettings.categories, style: "pocket", import_rules: []
});
