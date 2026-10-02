import assert from "node:assert/strict";
import { categorizeTransaction, normalizeMerchant, upsertLearnedRule } from "../src/import/categorizer.js";

const categories = ["Food", "Home", "Transport", "Bills", "Shopping", "Health", "Fun", "Other"]
  .map((name) => ({ name }));

assert.equal(normalizeMerchant("  Žalias   Marketas!!! POS 123456  "), "ZALIAS MARKETAS");
assert.notEqual(normalizeMerchant("CITY BUS"), normalizeMerchant("CITY HOTEL"));

const cases = [
  ["MAXIMA LT", "", "Food"],
  ["LOCAL RESTAURANT", "Dinner", "Food"],
  ["CITY BUS", "Ticket", "Transport"],
  ["CIRCLE K", "Fuel", "Transport"],
  ["IKEA", "Furniture", "Home"],
  ["IGNITIS", "Electricity bill", "Bills"],
  ["EUROVAISTINE", "Pharmacy", "Health"],
  ["ZARA", "Clothes", "Shopping"],
  ["ERGO", "Insurance", "Bills"],
  ["APOLLO KINAS", "Cinema", "Fun"]
];
for (const [merchant, description, category] of cases) {
  assert.equal(categorizeTransaction({ merchant, description }, categories, []).category, category, merchant);
}

const learned = [{ merchantKey: "MAXIMA LT", category: "Home", updatedAt: 1 }];
assert.deepEqual(categorizeTransaction({ merchant: "Maxima LT", description: "Groceries" }, categories, learned), {
  category: "Home", merchantKey: "MAXIMA LT", source: "learned"
});
assert.equal(categorizeTransaction({ merchant: "Unknown", description: "Anything" }, categories, []).category, "Other");
assert.equal(categorizeTransaction({ merchant: "BUSINESS CENTER", description: "Office" }, categories, []).category, "Other");
assert.equal(categorizeTransaction({ merchant: "BIKINI SHOP", description: "Swimwear" }, categories, []).category, "Other");
assert.equal(categorizeTransaction({ merchant: "Zara", description: "Clothes" }, categories.filter(({ name }) => name !== "Shopping"), []).category, "Other");
assert.equal(categorizeTransaction({ merchant: "Maxima", description: "Food" }, categories, [{ merchantKey: "MAXIMA", category: "Removed", updatedAt: 1 }]).category, "Other");

const updated = upsertLearnedRule([
  { merchantKey: "MAXIMA", category: "Food", updatedAt: 1 },
  { merchantKey: "CITY BUS", category: "Transport", updatedAt: 1 }
], "MAXIMA", "Home", 2);
assert.deepEqual(updated, [
  { merchantKey: "MAXIMA", category: "Home", updatedAt: 2 },
  { merchantKey: "CITY BUS", category: "Transport", updatedAt: 1 }
]);
