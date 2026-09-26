import assert from "node:assert/strict";
import { createPersonalRepository } from "../src/personal-sync/repository.js";

const calls = [];
const query = (table) => ({
  select(columns) { calls.push(["select", table, columns]); return this; },
  eq(column, value) { calls.push(["eq", table, column, value]); return table === "personal_expenses" ? Promise.resolve({ data: [{ expense_id: "e1", amount_minor: 1250, labels: [], reimbursement_percent: 0, expense_date: "2026-09-26", created_at_client: 1 }] }) : this; },
  maybeSingle() { calls.push(["maybeSingle", table]); return Promise.resolve({ data: { categories: [], style: "pocket" } }); }
});
const client = {
  from: query,
  rpc: async (name, args) => { calls.push(["rpc", name, args]); return { data: true }; },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {}
};
const repository = createPersonalRepository(client);
const pulled = await repository.pull("user-a");
assert.equal(pulled.expenses[0].amount, 12.5);
assert.ok(calls.some((call) => call[0] === "eq" && call[3] === "user-a"));
assert.equal(await repository.apply({ operation_id: "phone:1", kind: "expense_delete", expense_id: "e1" }), true);
assert.ok(calls.some((call) => call[0] === "rpc" && call[1] === "apply_personal_operation"));
