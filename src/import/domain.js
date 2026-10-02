import { categorizeTransaction } from "./categorizer.js";
import { assignImportIds } from "./duplicates.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeBounds(from, to) {
  return from <= to ? { from, to } : { from: to, to: from };
}

function applyRange(state, from, to) {
  const bounds = normalizeBounds(from, to);
  return {
    ...state,
    from: bounds.from,
    to: bounds.to,
    rows: state.rows.map((row) => ({ ...row, inRange: row.date >= bounds.from && row.date <= bounds.to }))
  };
}

export async function createReviewState({ transactions = [], unreadableRows = 0, categories = [], learnedRules = [], existingExpenses = [], digest }) {
  const incomingIgnored = transactions.filter(({ signedAmount }) => Number(signedAmount) >= 0).length;
  const outgoing = transactions.filter(({ signedAmount }) => Number(signedAmount) < 0);
  if (!outgoing.length) throw new Error("No outgoing expenses were found");
  const identified = await assignImportIds(outgoing, digest);
  const existingIds = new Set(existingExpenses.map(({ id }) => id));
  const manualMatchCounts = new Map();
  for (const expense of existingExpenses) {
    if (String(expense?.id || "").startsWith("swedbank:")) continue;
    const amountMinor = Math.round(Math.abs(Number(expense?.amount)) * 100);
    if (!expense?.date || !Number.isFinite(amountMinor)) continue;
    const key = `${expense.date}|${amountMinor}`;
    manualMatchCounts.set(key, (manualMatchCounts.get(key) || 0) + 1);
  }
  const rows = identified.map((transaction) => {
    const category = categorizeTransaction(transaction, categories, learnedRules);
    const duplicate = existingIds.has(transaction.importId);
    const possibleKey = `${transaction.date}|${Math.round(Math.abs(Number(transaction.signedAmount)) * 100)}`;
    const possibleDuplicate = !duplicate && (manualMatchCounts.get(possibleKey) || 0) > 0;
    if (possibleDuplicate) manualMatchCounts.set(possibleKey, manualMatchCounts.get(possibleKey) - 1);
    return {
      id: transaction.importId,
      date: transaction.date,
      amount: Math.abs(Number(transaction.signedAmount)),
      merchant: transaction.merchant,
      description: transaction.description,
      note: String(transaction.merchant || transaction.description || "").slice(0, 60),
      category: category.category,
      merchantKey: category.merchantKey,
      labels: [],
      reimbursementPercent: 0,
      sourceRow: transaction.sourceRow,
      duplicate,
      possibleDuplicate,
      selected: !duplicate && !possibleDuplicate,
      needsReview: category.category === "Other",
      inRange: true
    };
  });
  const dates = rows.map(({ date }) => date).sort();
  return {
    rows,
    from: dates[0],
    to: dates[dates.length - 1],
    categories: categories.map((category) => ({ ...category })),
    learnedRules: learnedRules.map((rule) => ({ ...rule })),
    incomingIgnored,
    unreadableRows,
    pendingRules: []
  };
}

export function filterReviewRows(state, from, to) {
  return applyRange(state, from, to);
}

export function updateReviewRow(state, id, patch) {
  const bounds = normalizeBounds(state.from, state.to);
  return { ...state, rows: state.rows.map((row) => {
    if (row.id !== id) return { ...row };
    const next = { ...row, ...patch };
    if (Object.hasOwn(patch, "date")) next.inRange = next.date >= bounds.from && next.date <= bounds.to;
    return next;
  }) };
}

export function reviewSummary(state) {
  return {
    outgoing: state.rows.length,
    incomingIgnored: state.incomingIgnored,
    outsideRange: state.rows.filter(({ inRange }) => !inRange).length,
    duplicatesExcluded: state.rows.filter(({ duplicate, selected }) => duplicate && !selected).length,
    possibleDuplicatesExcluded: state.rows.filter(({ possibleDuplicate, selected }) => possibleDuplicate && !selected).length,
    other: state.rows.filter(({ category, inRange }) => category === "Other" && inRange).length,
    unreadableRows: state.unreadableRows
  };
}

function validateRow(row, categories) {
  if (!Number.isFinite(Number(row.amount)) || Number(row.amount) <= 0) throw new Error("Expense amount is invalid");
  if (!DATE_PATTERN.test(String(row.date))) throw new Error("Expense date is invalid");
  if (!categories.has(row.category)) throw new Error("Expense category is invalid");
  if (!Array.isArray(row.labels) || row.labels.some((label) => typeof label !== "string")) throw new Error("Expense labels are invalid");
  const percent = Number(row.reimbursementPercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error("Expense reimbursement is invalid");
  if (typeof row.note !== "string" || row.note.length > 60) throw new Error("Expense description is invalid");
}

export function buildImportBatch(state, now = Date.now()) {
  const categories = new Set(state.categories.map(({ name }) => name));
  const selected = state.rows.filter(({ selected, inRange }) => selected && inRange);
  selected.forEach((row) => {
    try { validateRow(row, categories); }
    catch (error) { error.rowId = row.id; throw error; }
  });
  return {
    expenses: selected.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      category: row.category,
      labels: [...row.labels],
      reimbursementPercent: Number(row.reimbursementPercent),
      date: row.date,
      note: row.note.trim(),
      createdAt: Number(now)
    })),
    learnedRules: (state.pendingRules || []).map((rule) => ({ ...rule }))
  };
}
