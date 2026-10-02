const KEYS = {
  expenses: "where-it-goes-expenses-v1",
  categories: "where-it-goes-groups-v1",
  style: "where-it-goes-style-v1",
  importRules: "where-it-goes-import-rules-v1",
  device: "where-it-goes-device-id-v1",
  sequence: "where-it-goes-operation-sequence-v1"
};

function readJSON(storage, key, fallback) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function safeUserId(userId) {
  return encodeURIComponent(String(userId));
}

export function createPersonalStorage(storage, options = {}) {
  const deviceIdFactory = options.deviceIdFactory || (() => crypto.randomUUID());
  const cacheKey = (userId) => `where-it-goes-personal-cache-v2:${safeUserId(userId)}`;
  const outboxKey = (userId) => `where-it-goes-personal-outbox-v2:${safeUserId(userId)}`;
  const importKey = (userId) => `where-it-goes-personal-imported-v1:${safeUserId(userId)}`;

  function deviceId() {
    let id = storage.getItem(KEYS.device);
    if (!id) {
      id = deviceIdFactory();
      storage.setItem(KEYS.device, id);
    }
    return id;
  }

  return {
    deviceId,
    guestSnapshot() {
      const expenses = readJSON(storage, KEYS.expenses, []);
      const categories = readJSON(storage, KEYS.categories, []);
      const style = storage.getItem(KEYS.style);
      const importRules = readJSON(storage, KEYS.importRules, []);
      return {
        expenses: Array.isArray(expenses) ? expenses : [],
        categories: Array.isArray(categories) ? categories : [],
        style,
        importRules: Array.isArray(importRules) ? importRules : [],
        localIsDefault: !storage.getItem(KEYS.expenses) && !storage.getItem(KEYS.categories) && !style
      };
    },
    accountSnapshot(userId) {
      const snapshot = readJSON(storage, cacheKey(userId), null);
      return snapshot && Array.isArray(snapshot.rows)
        ? { rows: snapshot.rows, categories: snapshot.categories ?? null, style: snapshot.style ?? null, importRules: Array.isArray(snapshot.importRules) ? snapshot.importRules : [] }
        : { rows: [], categories: null, style: null, importRules: [] };
    },
    saveAccountSnapshot(userId, snapshot) {
      storage.setItem(cacheKey(userId), JSON.stringify(snapshot));
    },
    nextOperationId() {
      const next = Math.max(0, Number.parseInt(storage.getItem(KEYS.sequence), 10) || 0) + 1;
      storage.setItem(KEYS.sequence, String(next));
      return `${deviceId()}:${next}`;
    },
    outbox(userId) {
      const value = readJSON(storage, outboxKey(userId), []);
      return Array.isArray(value) ? value : [];
    },
    enqueue(userId, operation) {
      const pending = this.outbox(userId);
      if (!pending.some((item) => item.operation_id === operation.operation_id)) {
        pending.push(operation);
        storage.setItem(outboxKey(userId), JSON.stringify(pending));
      }
    },
    ack(userId, operationId) {
      const pending = this.outbox(userId).filter((item) => item.operation_id !== operationId);
      storage.setItem(outboxKey(userId), JSON.stringify(pending));
    },
    hasImportedGuest(userId) {
      return storage.getItem(importKey(userId)) === "1";
    },
    markGuestImported(userId) {
      storage.setItem(importKey(userId), "1");
    }
  };
}
