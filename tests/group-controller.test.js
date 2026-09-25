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
  const writes = [];
  let allow = false;
  const group = { id: "g1", owner_id: "u1", status: "active", group_members: [{ user_id: "u1", status: "active" }, { user_id: "u2", status: "active" }], group_invites: [], group_expenses: [], group_repayments: [] };
  const controller = createGroupsController({ root, navigatorState: { onLine: true }, confirmState: () => allow, auth: { getSession: async () => ({ user: { id: "u1" } }) }, repository: {
    getGroup: async () => group,
    listGroups: async () => [],
    removeMember: async (...args) => { writes.push(["remove", ...args]); },
    rotateInvite: async (...args) => { writes.push(["rotate", ...args]); return { token: "fresh" }; },
    archiveGroup: async (...args) => { writes.push(["archive", ...args]); return { ...group, status: "archived" }; }
  } });
  await controller.openGroup("g1");
  await controller.removeMember("u2");
  await controller.rotateInvite();
  await controller.archiveGroup();
  assert.equal(writes.length, 0);
  allow = true;
  await controller.removeMember("u2");
  await controller.rotateInvite();
  await controller.archiveGroup();
  assert.deepEqual(writes.map((entry) => entry[0]), ["remove", "rotate", "archive"]);
}

{
  const root = rootStub();
  let lists = 0;
  const controller = createGroupsController({ root, navigatorState: { onLine: true }, confirmState: () => true, auth: { getSession: async () => ({ user: { id: "u1" } }) }, repository: {
    getGroup: async () => ({ id: "g1", owner_id: "u1", status: "active", group_members: [], group_expenses: [], group_repayments: [] }),
    removeMember: async () => { throw new Error("not authorized"); },
    listGroups: async () => { lists += 1; return []; }
  } });
  await controller.openGroup("g1");
  await assert.rejects(() => controller.removeMember("u2"), /not authorized/);
  assert.equal(lists, 1);
}

{
  const root = rootStub();
  const calls = [];
  let attempt = 0;
  const group = { id: "g1", status: "active", owner_id: "a", currency: "EUR", group_members: [
    { user_id: "a", status: "active", profiles: { display_name: "A" } },
    { user_id: "b", status: "active", profiles: { display_name: "B" } }
  ], group_expenses: [{ payer_id: "a", amount_minor: 400, expense_participants: [{ member_id: "a", share_minor: 200 }, { member_id: "b", share_minor: 200 }] }], group_repayments: [] };
  const controller = createGroupsController({
    root, navigatorState: { onLine: true }, uuid: () => "repay-once", today: () => "2026-09-25",
    auth: { getSession: async () => ({ user: { id: "b" } }) },
    repository: {
      getGroup: async () => group,
      saveRepayment: async (draft) => { calls.push(draft); attempt += 1; if (attempt === 1) throw new Error("Network unavailable"); return { id: "r1" }; }
    }
  });
  await controller.openGroup("g1");
  controller.openRepayment({ payerId: "b", recipientId: "a", amountMinor: 200 });
  assert.deepEqual(controller.getRepaymentDraft(), { groupId: "g1", idempotencyKey: "repay-once", payerId: "b", recipientId: "a", amount: "2.00", date: "2026-09-25" });
  await assert.rejects(() => controller.submitRepayment(), /Network unavailable/);
  await controller.submitRepayment();
  assert.equal(calls[0].idempotencyKey, "repay-once");
  assert.equal(calls[1].idempotencyKey, "repay-once");
}

{
  const root = rootStub();
  let writes = 0;
  const group = { id: "g1", status: "active", owner_id: "a", group_members: [
    { user_id: "a", status: "active" }, { user_id: "b", status: "active" }, { user_id: "c", status: "removed" }
  ], group_expenses: [{ payer_id: "a", amount_minor: 400, expense_participants: [{ member_id: "a", share_minor: 200 }, { member_id: "b", share_minor: 200 }] }], group_repayments: [] };
  const controller = createGroupsController({ root, navigatorState: { onLine: true }, auth: { getSession: async () => ({ user: { id: "b" } }) }, repository: { getGroup: async () => group, saveRepayment: async () => { writes += 1; } } });
  await controller.openGroup("g1");
  for (const draft of [
    { payerId: "b", recipientId: "a", amountMinor: 0 },
    { payerId: "b", recipientId: "b", amountMinor: 100 },
    { payerId: "c", recipientId: "a", amountMinor: 100 },
    { payerId: "b", recipientId: "a", amountMinor: 201 }
  ]) {
    controller.openRepayment(draft);
    await assert.rejects(() => controller.submitRepayment());
  }
  assert.equal(writes, 0);
}

{
  const root = rootStub();
  let writes = 0;
  const controller = createGroupsController({ root, navigatorState: { onLine: true }, auth: { getSession: async () => ({ user: { id: "u1" } }) }, repository: { getGroup: async () => ({ id: "g1", status: "archived", owner_id: "u1", group_members: [{ user_id: "u1", status: "active" }], group_expenses: [], group_repayments: [] }), saveExpense: async () => { writes += 1; } } });
  await controller.openGroup("g1");
  assert.throws(() => controller.openExpense(), /archived/i);
  assert.equal(writes, 0);
  controller.showPersonal();
  assert.equal(root.hidden, true);
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
