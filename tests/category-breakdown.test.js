import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
function element() {
  return {
    value: "",
    hidden: false,
    innerHTML: "",
    textContent: "",
    addEventListener: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    style: {},
    setAttribute: () => {},
    reset: () => {},
    showPicker: () => {}
  };
}

const sandbox = {
  Intl,
  console,
  crypto: { randomUUID: () => "test-id" },
  localStorage: { getItem: () => "[]", setItem: () => {} },
  document: {
    body: { dataset: {}, style: {} },
    querySelector: () => element(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ click: () => {} })
  },
  window: { addEventListener: () => {}, scrollTo: () => {} },
  navigator: {}
};

vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.__test = { breakdownMarkup, renameCategory, applyCategoryChanges, expensesForPeriod, periodLabel };`, sandbox);

const monthly = [
  { id: "coffee", amount: 4.5, category: "Food", labels: ["Treat"], reimbursementPercent: 0, date: "2026-08-17", note: "Coffee", createdAt: 2 },
  { id: "bus", amount: 10, category: "Transport", labels: [], reimbursementPercent: 50, date: "2026-08-16", note: "Bus", createdAt: 1 },
  { id: "train", amount: 20, category: "Transport", labels: [], reimbursementPercent: 0, date: "2026-09-02", note: "Train", createdAt: 3 }
];

const rangeItems = sandbox.__test.expensesForPeriod(monthly, { mode: "range", start: "2026-08-17", end: "2026-09-02" });
assert.deepEqual(rangeItems.map((expense) => expense.id), ["coffee", "train"]);
const reversedRangeItems = sandbox.__test.expensesForPeriod(monthly, { mode: "range", start: "2026-09-02", end: "2026-08-17" });
assert.deepEqual(reversedRangeItems.map((expense) => expense.id), ["coffee", "train"]);
assert.equal(sandbox.__test.periodLabel({ mode: "range", start: "2026-08-17", end: "2026-09-02" }), "17 Aug – 2 Sept");

const august = sandbox.__test.expensesForPeriod(monthly, { mode: "month", month: "2026-08" });
assert.deepEqual(august.map((expense) => expense.id), ["coffee", "bus"]);

const collapsed = sandbox.__test.breakdownMarkup(august, 9.5, new Set());
assert.match(collapsed, /data-breakdown-category="Food"/);
assert.doesNotMatch(collapsed, /data-expense-id="coffee"/);

const expanded = sandbox.__test.breakdownMarkup(monthly, 9.5, new Set(["Food"]));
assert.match(expanded, /data-breakdown-category="Food"/);
assert.match(expanded, /data-expense-id="coffee"/);
assert.doesNotMatch(expanded, /data-expense-id="bus"/);

const state = sandbox.__test.renameCategory({
  categories: [
    { name: "Food", emoji: "🥑", color: "#e6f0df" },
    { name: "Transport", emoji: "🚲", color: "#dfeaf0" }
  ],
  expenses: monthly,
  selectedCategory: "Food",
  expandedCategories: new Set(["Food"])
}, "Food", { name: "Groceries", emoji: "🛒" });

assert.equal(state.categories[0].name, "Groceries");
assert.equal(state.categories[0].emoji, "🛒");
assert.equal(state.categories[0].color, "#e6f0df");
assert.equal(state.expenses[0].category, "Groceries");
assert.equal(state.expenses[1].category, "Transport");
assert.equal(state.selectedCategory, "Groceries");
assert.deepEqual([...state.expandedCategories], ["Groceries"]);

const swapped = sandbox.__test.applyCategoryChanges({
  categories: [
    { name: "Food", emoji: "🥑", color: "#e6f0df" },
    { name: "Home", emoji: "🏡", color: "#f3e7d4" }
  ],
  expenses: [
    { id: "lunch", category: "Food" },
    { id: "rent", category: "Home" }
  ],
  selectedCategory: "Food",
  expandedCategories: new Set(["Home"])
}, [
  { name: "Home", emoji: "🏡", color: "#e6f0df" },
  { name: "Food", emoji: "🥑", color: "#f3e7d4" }
]);

assert.deepEqual(swapped.categories.map((category) => category.name), ["Home", "Food"]);
assert.deepEqual(swapped.expenses.map((expense) => expense.category), ["Home", "Food"]);
assert.equal(swapped.selectedCategory, "Home");
assert.deepEqual([...swapped.expandedCategories], ["Food"]);
