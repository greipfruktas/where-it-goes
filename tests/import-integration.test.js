import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { parseSwedbankWorkbook } from "../src/import/swedbank-parser.js";
import { buildImportBatch, createReviewState, updateReviewRow } from "../src/import/domain.js";

const require = createRequire(import.meta.url);
const XLSX = require("../vendor/xlsx.full.min.js");
const buffer = fs.readFileSync(new URL("./fixtures/swedbank-sanitized.xlsx", import.meta.url));
const categories = ["Food", "Home", "Transport", "Bills", "Shopping", "Health", "Fun", "Other"].map((name) => ({ name }));
const parsed = parseSwedbankWorkbook(buffer, XLSX);
let review = await createReviewState({ ...parsed, categories, learnedRules: [], existingExpenses: [] });
assert.equal(review.from, "2026-09-01");
assert.equal(review.to, "2026-09-04");
assert.equal(review.rows.length, 4);
const hotel = review.rows.find(({ merchant }) => merchant === "CITY HOTEL");
review = updateReviewRow(review, hotel.id, { category: "Home", note: "Weekend stay", labels: ["Treat"], reimbursementPercent: 50 });
review.pendingRules = [{ merchantKey: hotel.merchantKey, category: "Home", updatedAt: 10 }];
review = updateReviewRow(review, review.rows[0].id, { selected: false });
const firstBatch = buildImportBatch(review, 20);
assert.equal(firstBatch.expenses.length, 3);
assert.equal(firstBatch.expenses.find(({ id }) => id === hotel.id).category, "Home");
assert.equal(firstBatch.learnedRules[0].category, "Home");

const reimport = await createReviewState({ ...parsed, categories, learnedRules: firstBatch.learnedRules, existingExpenses: firstBatch.expenses });
assert.equal(reimport.rows.filter(({ duplicate }) => duplicate).length, 3);
assert.equal(reimport.rows.filter(({ selected }) => selected).length, 1, "only the previously excluded expense starts selected");
const duplicate = reimport.rows.find(({ duplicate }) => duplicate);
const override = updateReviewRow(reimport, duplicate.id, { selected: true, amount: 99 });
const overrideBatch = buildImportBatch(override, 30);
const merged = new Map(firstBatch.expenses.map((expense) => [expense.id, expense]));
overrideBatch.expenses.forEach((expense) => merged.set(expense.id, expense));
assert.equal(merged.size, 4, "override updates an ID instead of creating a second copy");

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
assert.match(index, /vendor\/xlsx\.full\.min\.js/);
assert.match(index, /src\/import\/controller\.js/);
for (const asset of ["vendor/xlsx.full.min.js", "swedbank-parser.js", "categorizer.js", "duplicates.js", "domain.js", "view.js", "controller.js"]) {
  assert.match(serviceWorker, new RegExp(asset.replaceAll(".", "\\.")), `${asset} should be cached`);
}
assert.match(serviceWorker, /where-it-goes-v31/);
