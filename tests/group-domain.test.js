import assert from "node:assert/strict";
import {
  parseMinorUnits,
  allocateEqualShares,
  calculateNetBalances,
  simplifyTransfers,
  validateExpenseDraft,
  validateRepaymentDraft
} from "../src/groups/domain.js";

assert.equal(parseMinorUnits("12.34"), 1234);
assert.equal(parseMinorUnits("12,34"), 1234);
assert.throws(() => parseMinorUnits("0"), /greater than zero/);
assert.deepEqual(allocateEqualShares(1000, ["c", "a", "b"]), [
  { memberId: "a", shareMinor: 334 },
  { memberId: "b", shareMinor: 333 },
  { memberId: "c", shareMinor: 333 }
]);
assert.deepEqual(validateExpenseDraft({
  amountMinor: 1000,
  payerId: "a",
  participantIds: ["a", "b"],
  description: "Dinner",
  category: "Food",
  date: "2026-09-24"
}, ["a", "b"]), []);
assert.match(validateExpenseDraft({
  amountMinor: 1000,
  payerId: "removed",
  participantIds: ["a"],
  description: "Dinner",
  category: "Food",
  date: "2026-09-24"
}, ["a"])[0], /payer/i);

const net = calculateNetBalances([
  { payerId: "a", amountMinor: 900, shares: [
    { memberId: "a", shareMinor: 300 },
    { memberId: "b", shareMinor: 300 },
    { memberId: "c", shareMinor: 300 }
  ] }
], [{ payerId: "b", recipientId: "a", amountMinor: 100 }]);
assert.deepEqual(net, { a: 500, b: -200, c: -300 });
assert.deepEqual(simplifyTransfers(net), [
  { payerId: "c", recipientId: "a", amountMinor: 300 },
  { payerId: "b", recipientId: "a", amountMinor: 200 }
]);
assert.match(validateRepaymentDraft({
  payerId: "b", recipientId: "a", amountMinor: 201, date: "2026-09-24"
}, ["a", "b"], [{ payerId: "b", recipientId: "a", amountMinor: 200 }])[0], /exceed/i);
