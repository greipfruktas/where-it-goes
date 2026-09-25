import assert from "node:assert/strict";
import { createGroupsController } from "../src/groups/controller.js";

function rootStub() {
  return { hidden: true, innerHTML: "", dataset: {}, addEventListener() {} };
}

{
  const calls = [];
  const root = rootStub();
  const controller = createGroupsController({
    root,
    navigatorState: { onLine: true },
    locationState: { search: "", pathname: "/where-it-goes/" },
    historyState: { replaceState() {} },
    auth: {
      consumeAuthReturn: async () => "?invite=abc",
      getSession: async () => ({ user: { id: "u1" } })
    },
    repository: {
      joinGroup: async (token) => { calls.push(["join", token]); return { group_id: "g1" }; },
      getGroup: async (id) => { calls.push(["get", id]); return { id, name: "Trip", group_members: [] }; },
      listGroups: async () => []
    }
  });
  await controller.start();
  assert.deepEqual(calls.slice(0, 2), [["join", "abc"], ["get", "g1"]]);
  assert.match(root.innerHTML, /Trip/);
}

{
  const root = rootStub();
  const calls = [];
  let attempt = 0;
  const controller = createGroupsController({
    root,
    navigatorState: { onLine: true },
    uuid: () => "expense-once",
    today: () => "2026-09-25",
    auth: { getSession: async () => ({ user: { id: "u1" } }) },
    repository: {
      saveExpense: async (draft) => {
        calls.push(draft);
        attempt += 1;
        if (attempt === 1) throw new Error("Network unavailable");
        return { id: "e1" };
      },
      getGroup: async () => ({ id: "g1", owner_id: "u1", currency: "EUR", group_members: [
        { user_id: "u1", status: "active" }, { user_id: "u2", status: "active" }
      ], group_expenses: [], group_repayments: [] })
    }
  });
  controller.openExpense({ groupId: "g1", amount: "12.00", description: "Dinner", category: "Food", payerId: "u1", participantIds: ["u1", "u2"], expenseDate: "2026-09-25" });
  await assert.rejects(() => controller.submitExpense(), /Network unavailable/);
  assert.equal(controller.getExpenseDraft().description, "Dinner");
  await controller.submitExpense();
  assert.equal(calls[0].idempotencyKey, "expense-once");
  assert.equal(calls[1].idempotencyKey, "expense-once");
}

{
  const root = rootStub();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const controller = createGroupsController({
    root,
    navigatorState: { onLine: true },
    uuid: () => "expense-once",
    auth: { getSession: async () => ({ user: { id: "u1" } }) },
    repository: {
      saveExpense: async () => { calls += 1; await pending; return { id: "e1" }; },
      getGroup: async () => ({ id: "g1", owner_id: "u1", group_members: [], group_expenses: [], group_repayments: [] })
    }
  });
  controller.openExpense({ groupId: "g1", amount: "1", description: "Bus", category: "Transport", payerId: "u1", participantIds: ["u1"], expenseDate: "2026-09-25" });
  const first = controller.submitExpense();
  const second = controller.submitExpense();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
}

{
  const root = rootStub();
  let writes = 0;
  const controller = createGroupsController({
    root,
    navigatorState: { onLine: false },
    auth: { consumeAuthReturn: async () => null, getSession: async () => ({ user: { id: "u1" } }) },
    repository: { listGroups: async () => { writes += 1; return []; } }
  });
  await controller.showGroups();
  assert.match(root.innerHTML, /internet connection/i);
  assert.equal(writes, 0);
}

{
  const root = rootStub();
  const before = globalThis.localStorage;
  const controller = createGroupsController({ root, navigatorState: { onLine: true }, auth: {}, repository: {} });
  controller.showPersonal();
  assert.equal(root.hidden, true);
  assert.equal(globalThis.localStorage, before);
}
