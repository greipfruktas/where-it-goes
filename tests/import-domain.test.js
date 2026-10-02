import assert from "node:assert/strict";
import { assignImportIds } from "../src/import/duplicates.js";
import { buildImportBatch, createReviewState, filterReviewRows, reviewSummary, updateReviewRow } from "../src/import/domain.js";

const digestInputs = [];
const digest = async (value) => {
  digestInputs.push(value);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(hash).toString("hex");
};
const duplicatePair = [
  { date: "2026-09-04", signedAmount: -4.5, merchant: "CITY BUS", description: "Ticket", sourceRow: 8 },
  { date: "2026-09-04", signedAmount: -4.5, merchant: "CITY BUS", description: "Ticket", sourceRow: 9 }
];
const first = await assignImportIds(duplicatePair, digest);
const second = await assignImportIds(duplicatePair, digest);
assert.notEqual(first[0].importId, first[1].importId);
assert.deepEqual(first.map(({ importId }) => importId), second.map(({ importId }) => importId));
assert.match(first[0].importId, /^swedbank:/);
assert.match(digestInputs[0], /^swedbank\|2026-09-04\|450\|CITY BUS\|TICKET\|1$/);
assert.match(digestInputs[1], /\|2$/);

const categories = ["Food", "Transport", "Other"].map((name) => ({ name }));
const transactions = [
  { date: "2026-09-01", signedAmount: -12.34, merchant: "MAXIMA", description: "Groceries", sourceRow: 5 },
  { date: "2026-09-02", signedAmount: 500, merchant: "EMPLOYER", description: "Salary", sourceRow: 6 },
  { date: "2026-09-03", signedAmount: -8, merchant: "UNKNOWN", description: "Mystery", sourceRow: 7 },
  ...duplicatePair
];
const initial = await createReviewState({ transactions, unreadableRows: 2, categories, learnedRules: [], existingExpenses: [{ id: first[0].importId }], digest });
assert.equal(initial.from, "2026-09-01");
assert.equal(initial.to, "2026-09-04");
assert.equal(initial.rows.length, 4);
assert.equal(initial.incomingIgnored, 1);
assert.equal(initial.rows.filter(({ duplicate }) => duplicate).length, 1);
assert.equal(initial.rows.find(({ duplicate }) => duplicate).selected, false);
assert.equal(initial.rows.find(({ category }) => category === "Other").needsReview, true);
assert.deepEqual(reviewSummary(initial), { outgoing: 4, incomingIgnored: 1, outsideRange: 0, duplicatesExcluded: 1, possibleDuplicatesExcluded: 0, other: 1, unreadableRows: 2 });

const narrowed = filterReviewRows(initial, "2026-09-04", "2026-09-03");
assert.equal(reviewSummary(narrowed).outsideRange, 1, "reversed bounds should normalize");
assert.equal(narrowed.rows.filter(({ inRange }) => inRange).length, 3);

const duplicate = initial.rows.find(({ duplicate }) => duplicate);
const selected = updateReviewRow(initial, duplicate.id, { selected: true, note: "Edited", category: "Transport" });
assert.equal(selected.rows.find(({ id }) => id === duplicate.id).selected, true);
assert.equal(initial.rows.find(({ id }) => id === duplicate.id).selected, false, "updates must not mutate source state");

const batch = buildImportBatch(selected, 123456);
assert.equal(batch.expenses.length, 4);
assert.ok(batch.expenses.every(({ amount }) => amount > 0));
assert.ok(batch.expenses.every(({ createdAt }) => createdAt === 123456));

const invalid = updateReviewRow(selected, selected.rows[0].id, { amount: 0 });
assert.throws(() => buildImportBatch(invalid, 123456), (error) => /amount/i.test(error.message) && error.rowId === selected.rows[0].id);

const movedOutside = updateReviewRow(initial, initial.rows[0].id, { date: "2026-10-01" });
assert.equal(movedOutside.rows[0].inRange, false);
const movedInside = updateReviewRow(filterReviewRows(initial, "2026-09-03", "2026-09-04"), initial.rows[0].id, { date: "2026-09-03" });
assert.equal(movedInside.rows[0].inRange, true);

const longMerchant = await createReviewState({
  transactions: [{ date: "2026-09-05", signedAmount: -1, merchant: "A".repeat(80), description: "", sourceRow: 1 }],
  categories, learnedRules: [], existingExpenses: [], digest
});
assert.equal(longMerchant.rows[0].note.length, 60, "default notes must satisfy Personal's edit limit");

const possible = await createReviewState({
  transactions: [
    { date: "2026-09-06", signedAmount: -14.2, merchant: "CAFE ONE", description: "Card payment", sourceRow: 1 },
    { date: "2026-09-06", signedAmount: -14.2, merchant: "CAFE TWO", description: "Card payment", sourceRow: 2 },
    { date: "2026-09-07", signedAmount: -14.2, merchant: "CAFE THREE", description: "Card payment", sourceRow: 3 }
  ],
  categories, learnedRules: [],
  existingExpenses: [{ id: "manual-1", date: "2026-09-06", amount: 14.2, category: "Food", note: "Lunch", labels: [], reimbursementPercent: 0, createdAt: 1 }],
  digest
});
assert.equal(possible.rows.filter(({ possibleDuplicate }) => possibleDuplicate).length, 1, "one manual expense should match only one imported row");
assert.equal(possible.rows.find(({ possibleDuplicate }) => possibleDuplicate).selected, false);
assert.equal(possible.rows.find(({ date }) => date === "2026-09-07").possibleDuplicate, false);
assert.equal(reviewSummary(possible).possibleDuplicatesExcluded, 1);
