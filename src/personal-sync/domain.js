function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeExpense(item, deviceId) {
  if (!item || typeof item !== "object") throw new Error("Expense must be an object");
  const amount = Number(item.amount);
  const reimbursementPercent = Number(item.reimbursementPercent || 0);
  const category = typeof item.category === "string" ? item.category.trim() : "";
  const note = typeof item.note === "string" ? item.note : "";
  const createdAt = Number(item.createdAt);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Expense amount is invalid");
  if (!category) throw new Error("Expense category is invalid");
  if (!Array.isArray(item.labels) || item.labels.some((label) => typeof label !== "string")) throw new Error("Expense labels are invalid");
  if (!Number.isFinite(reimbursementPercent) || reimbursementPercent < 0 || reimbursementPercent > 100) throw new Error("Expense reimbursement is invalid");
  if (!validDate(item.date)) throw new Error("Expense date is invalid");
  if (typeof item.note !== "undefined" && typeof item.note !== "string") throw new Error("Expense note is invalid");
  if (!Number.isFinite(createdAt)) throw new Error("Expense creation time is invalid");
  const id = typeof item.id === "string" && item.id.trim()
    ? item.id.trim()
    : `${deviceId}:legacy-${String(item.id ?? createdAt)}`;
  return {
    id,
    amount,
    category,
    labels: [...item.labels],
    reimbursementPercent,
    date: item.date,
    note,
    createdAt
  };
}

export function expenseToOperation(expense, operationId) {
  const normalized = normalizeExpense(expense, "device");
  return {
    operation_id: String(operationId),
    kind: "expense_upsert",
    expense: {
      id: normalized.id,
      amount_minor: Math.round(normalized.amount * 100),
      category: normalized.category,
      labels: [...normalized.labels],
      reimbursement_percent: normalized.reimbursementPercent,
      date: normalized.date,
      note: normalized.note,
      created_at_client: normalized.createdAt
    }
  };
}

export function deletionToOperation(expenseId, operationId) {
  const id = String(expenseId || "").trim();
  if (!id) throw new Error("Expense ID is required");
  return { operation_id: String(operationId), kind: "expense_delete", expense_id: id };
}

export function normalizeLegacyExpenses(items, deviceId, nextOperationId) {
  const expenses = [];
  const operations = [];
  const invalid = [];
  for (const item of Array.isArray(items) ? items : []) {
    try {
      const expense = normalizeExpense(item, String(deviceId));
      expenses.push(expense);
      operations.push(expenseToOperation(expense, nextOperationId()));
    } catch (error) {
      invalid.push({ item: clone(item), error: error.message });
    }
  }
  return { expenses, operations, invalid };
}

function timestamp(row) {
  const parsed = Date.parse(row?.serverUpdatedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeExpenseRows(localRows = [], cloudRows = []) {
  const merged = new Map();
  for (const row of localRows) {
    if (row?.id) merged.set(String(row.id), clone(row));
  }
  for (const row of cloudRows) {
    if (!row?.id) continue;
    const id = String(row.id);
    const current = merged.get(id);
    if (!current || timestamp(row) >= timestamp(current)) merged.set(id, clone(row));
  }
  return [...merged.values()];
}

export function chooseInitialSettings({ local, cloud }) {
  if (cloud) return { settings: clone(cloud), upload: false };
  return { settings: clone(local), upload: true };
}
