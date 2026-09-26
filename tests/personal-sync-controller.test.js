import assert from "node:assert/strict";
import { createPersonalSyncController } from "../src/personal-sync/controller.js";
import { createPersonalStorage } from "../src/personal-sync/storage.js";

const values = new Map([
  ["where-it-goes-expenses-v1", JSON.stringify([{ id: "guest-1", amount: 4, category: "Food", labels: [], reimbursementPercent: 0, date: "2026-09-26", note: "", createdAt: 1 }])],
  ["where-it-goes-groups-v1", JSON.stringify([{ name: "Food", emoji: "🥑", color: "#eee" }])]
]);
const local = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
const storage = createPersonalStorage(local, { deviceIdFactory: () => "phone" });
let visible = { expenses: [], categories: [], style: "pocket" };
const listeners = new Set();
const personalData = {
  snapshot: () => visible,
  useNamespace: (_namespace, snapshot) => { visible = snapshot; },
  onMutation: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  showStorageError: () => {}
};
const applied = [];
const repository = {
  pull: async () => ({ expenses: [{ id: "cloud-1", amount: 2, category: "Food", labels: [], reimbursementPercent: 0, date: "2026-09-25", note: "", createdAt: 2, serverUpdatedAt: "2026-09-26T10:00:00Z" }], settings: { categories: [{ name: "Food", emoji: "🥑", color: "#eee" }], style: "pocket" } }),
  apply: async (operation) => { applied.push(operation); return true; },
  subscribe: () => ({ unsubscribe() {} })
};
const controller = createPersonalSyncController({ repository, storage, personalData, networkState: {}, documentState: {} });
await controller.startSession({ id: "user-a" });
assert.deepEqual(visible.expenses.map((item) => item.id).sort(), ["cloud-1", "guest-1"]);
assert.equal(storage.hasImportedGuest("user-a"), true);
assert.ok(applied.some((operation) => operation.kind === "expense_upsert"));
controller.stopSession();
assert.equal(controller.status().signedIn, false);
