import assert from "node:assert/strict";
import { renderImportSheet } from "../src/import/view.js";

const root = { innerHTML: "" };
const state = {
  filename: "statement.xlsx", from: "2026-09-01", to: "2026-09-30",
  summary: { outgoing: 2, incomingIgnored: 1, outsideRange: 0, duplicatesExcluded: 1, other: 1, unreadableRows: 1 },
  rows: [{
    id: "swedbank:1", selected: true, inRange: true, duplicate: true, needsReview: true,
    date: "2026-09-01", amount: 12.34, merchant: "<img src=x onerror=alert(1)>", description: "Coffee",
    note: "Coffee", category: "Other", labels: ["Must"], reimbursementPercent: 50
  }]
};
const categories = [{ name: "Food", emoji: "🥑" }, { name: "Other", emoji: "✨" }];
renderImportSheet(root, state, categories);

assert.match(root.innerHTML, /accept="\.xlsx,\.xls"/);
assert.match(root.innerHTML, /statement\.xlsx/);
assert.match(root.innerHTML, /stays on this device/i);
assert.match(root.innerHTML, /data-import-from/);
assert.match(root.innerHTML, /data-import-to/);
for (const text of ["Expenses found", "Incoming ignored", "Outside dates", "Duplicates", "Needs category", "Unreadable rows"]) assert.match(root.innerHTML, new RegExp(text));
assert.match(root.innerHTML, /data-row-selected/);
assert.match(root.innerHTML, /✨/);
assert.match(root.innerHTML, /Other/);
assert.match(root.innerHTML, /Duplicate/);
assert.match(root.innerHTML, /Select all new/);
assert.match(root.innerHTML, /Exclude all/);
for (const control of ["data-row-date", "data-row-amount", "data-row-note", "data-row-category", "data-row-label", "data-row-reimbursement"]) assert.match(root.innerHTML, new RegExp(control));
assert.match(root.innerHTML, /Cancel/);
assert.match(root.innerHTML, /Save selected expenses/);
assert.doesNotMatch(root.innerHTML, /<img src=x/);
assert.match(root.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
