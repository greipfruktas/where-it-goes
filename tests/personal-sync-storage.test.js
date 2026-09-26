import assert from "node:assert/strict";
import { createPersonalStorage } from "../src/personal-sync/storage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return Object.fromEntries(values); }
  };
}

const storage = memoryStorage({
  "where-it-goes-expenses-v1": JSON.stringify([{ id: "guest", amount: 2 }]),
  "where-it-goes-groups-v1": JSON.stringify([{ name: "Food", emoji: "🥑", color: "#eee" }]),
  "where-it-goes-style-v1": "neon"
});
let deviceCreates = 0;
const personal = createPersonalStorage(storage, { deviceIdFactory: () => { deviceCreates += 1; return "device-a"; } });

assert.equal(personal.deviceId(), "device-a");
assert.equal(personal.deviceId(), "device-a");
assert.equal(deviceCreates, 1);
assert.deepEqual(personal.guestSnapshot(), {
  expenses: [{ id: "guest", amount: 2 }],
  categories: [{ name: "Food", emoji: "🥑", color: "#eee" }],
  style: "neon",
  localIsDefault: false
});

personal.saveAccountSnapshot("user-a", { rows: [{ id: "a-secret" }], categories: [], style: "pocket" });
personal.saveAccountSnapshot("user-b", { rows: [{ id: "b-secret" }], categories: [], style: "swiss" });
assert.equal(personal.accountSnapshot("user-a").rows[0].id, "a-secret");
assert.equal(personal.accountSnapshot("user-b").rows[0].id, "b-secret");

const firstId = personal.nextOperationId();
const secondId = personal.nextOperationId();
assert.equal(firstId, "device-a:1");
assert.equal(secondId, "device-a:2");

personal.enqueue("user-a", { operation_id: firstId, kind: "expense_delete", expense_id: "e1" });
personal.enqueue("user-a", { operation_id: secondId, kind: "expense_delete", expense_id: "e2" });
personal.enqueue("user-a", { operation_id: firstId, kind: "expense_delete", expense_id: "duplicate" });
assert.deepEqual(personal.outbox("user-a").map((operation) => operation.operation_id), [firstId, secondId]);

personal.ack("user-a", firstId);
personal.ack("user-a", "missing");
assert.deepEqual(personal.outbox("user-a").map((operation) => operation.operation_id), [secondId]);
assert.deepEqual(personal.outbox("user-b"), []);

assert.equal(personal.hasImportedGuest("user-a"), false);
personal.markGuestImported("user-a");
assert.equal(personal.hasImportedGuest("user-a"), true);
assert.equal(personal.hasImportedGuest("user-b"), false);

const corrupt = createPersonalStorage(memoryStorage({
  "where-it-goes-device-id-v1": "device-c",
  "where-it-goes-personal-cache-v2:user-c": "not json",
  "where-it-goes-personal-outbox-v2:user-c": "{}"
}));
assert.deepEqual(corrupt.accountSnapshot("user-c"), { rows: [], categories: null, style: null });
assert.deepEqual(corrupt.outbox("user-c"), []);
