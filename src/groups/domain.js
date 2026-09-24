const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

/** Convert a user-entered decimal amount into integer minor units. */
export function parseMinorUnits(input) {
  const text = String(input ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Amount must contain a whole number and at most two decimal places");
  }
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(`${whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Amount is too large");
  }
  if (minor <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  return minor;
}

export function allocateEqualShares(amountMinor, memberIds) {
  const ids = [...new Set(memberIds)].sort();
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || ids.length === 0) {
    throw new Error("A positive integer amount and at least one participant are required");
  }
  const base = Math.floor(amountMinor / ids.length);
  const remainder = amountMinor % ids.length;
  return ids.map((memberId, index) => ({
    memberId,
    shareMinor: base + (index < remainder ? 1 : 0)
  }));
}

export function calculateNetBalances(expenses = [], repayments = []) {
  const balances = {};
  const addMember = (memberId) => {
    if (!(memberId in balances)) balances[memberId] = 0;
  };
  for (const expense of expenses) {
    addMember(expense.payerId);
    balances[expense.payerId] += expense.amountMinor;
    for (const share of expense.shares || []) {
      addMember(share.memberId);
      balances[share.memberId] -= share.shareMinor;
    }
  }
  for (const repayment of repayments) {
    addMember(repayment.payerId);
    addMember(repayment.recipientId);
    balances[repayment.payerId] += repayment.amountMinor;
    balances[repayment.recipientId] -= repayment.amountMinor;
  }
  return balances;
}

export function simplifyTransfers(netBalances = {}) {
  const debtors = Object.entries(netBalances)
    .filter(([, amount]) => amount < 0)
    .map(([memberId, amount]) => ({ memberId, amountMinor: -amount }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.memberId.localeCompare(b.memberId));
  const creditors = Object.entries(netBalances)
    .filter(([, amount]) => amount > 0)
    .map(([memberId, amount]) => ({ memberId, amountMinor: amount }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.memberId.localeCompare(b.memberId));
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = Math.min(debtor.amountMinor, creditor.amountMinor);
    if (amountMinor > 0) transfers.push({ payerId: debtor.memberId, recipientId: creditor.memberId, amountMinor });
    debtor.amountMinor -= amountMinor;
    creditor.amountMinor -= amountMinor;
    if (debtor.amountMinor === 0) debtorIndex += 1;
    if (creditor.amountMinor === 0) creditorIndex += 1;
  }
  return transfers;
}

export function validateExpenseDraft(draft = {}, activeMemberIds = []) {
  const errors = [];
  const active = new Set(activeMemberIds);
  if (!positiveInteger(draft.amountMinor)) errors.push("Amount must be greater than zero.");
  if (!active.has(draft.payerId)) errors.push("Payer must be an active member.");
  if (!Array.isArray(draft.participantIds) || draft.participantIds.length === 0) {
    errors.push("At least one participant is required.");
  } else if (draft.participantIds.some((memberId) => !active.has(memberId))) {
    errors.push("All participants must be active members.");
  }
  if (!String(draft.description ?? "").trim()) errors.push("Description is required.");
  if (!String(draft.category ?? "").trim()) errors.push("Category is required.");
  if (!String(draft.date ?? "").trim()) errors.push("Date is required.");
  return errors;
}

export function validateRepaymentDraft(draft = {}, activeMemberIds = [], suggestedTransfers = []) {
  const errors = [];
  const active = new Set(activeMemberIds);
  if (!active.has(draft.payerId)) errors.push("Payer must be an active member.");
  if (!active.has(draft.recipientId)) errors.push("Recipient must be an active member.");
  if (draft.payerId === draft.recipientId) errors.push("Payer and recipient must be different members.");
  if (!positiveInteger(draft.amountMinor)) errors.push("Amount must be greater than zero.");
  if (!String(draft.date ?? "").trim()) errors.push("Date is required.");
  const suggested = suggestedTransfers.find((transfer) =>
    transfer.payerId === draft.payerId && transfer.recipientId === draft.recipientId
  );
  if (suggested && draft.amountMinor > suggested.amountMinor) {
    errors.push("Repayment amount cannot exceed the suggested transfer.");
  }
  return errors;
}
