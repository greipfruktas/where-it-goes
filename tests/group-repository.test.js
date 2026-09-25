import assert from "node:assert/strict";
import { createGroupsRepository } from "../src/groups/repository.js";

const calls = [];
const client = {
  rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { id: "expense-1" }, error: null };
  }
};
const repository = createGroupsRepository(client);
const draft = {
  groupId: "g",
  idempotencyKey: "once",
  amountMinor: 501,
  payerId: "a",
  participantShares: [
    { memberId: "a", shareMinor: 251 },
    { memberId: "b", shareMinor: 250 }
  ]
};

await repository.saveExpense(draft);
assert.equal(calls[0].name, "save_group_expense");
assert.equal(calls[0].args.payload.idempotency_key, "once");

await repository.saveExpense(draft);
assert.equal(calls[1].args.payload.idempotency_key, "once");

const failedRepository = createGroupsRepository({
  rpc: async () => ({ data: null, error: { message: "Network unavailable" } })
});
await assert.rejects(() => failedRepository.saveExpense(draft), {
  message: "Network unavailable"
});
