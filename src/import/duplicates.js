import { normalizeMerchant } from "./categorizer.js";

function normalizedDescription(value) {
  return normalizeMerchant(value);
}

async function defaultDigest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function assignImportIds(transactions, digest = defaultDigest) {
  const occurrences = new Map();
  const output = [];
  for (const transaction of transactions) {
    const amountMinor = Math.round(Math.abs(Number(transaction.signedAmount)) * 100);
    const base = ["swedbank", transaction.date, amountMinor, normalizeMerchant(transaction.merchant), normalizedDescription(transaction.description)].join("|");
    const occurrence = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, occurrence);
    const hex = await digest(`${base}|${occurrence}`);
    output.push({ ...transaction, importId: `swedbank:${hex}` });
  }
  return output;
}
