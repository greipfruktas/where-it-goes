import { chooseInitialSettings, deletionToOperation, expenseToOperation, mergeExpenseRows, normalizeLegacyExpenses, settingsToOperation } from "./domain.js";

export function createPersonalSyncController({ repository, storage, personalData, networkState = globalThis, documentState = globalThis.document }) {
  let user = null;
  let guest = null;
  let mutationOff = null;
  let subscription = null;
  let inFlight = null;
  let retryTimer = null;

  const settingsOperation = (settings) => settingsToOperation(settings, storage.nextOperationId());

  function activeRows(snapshot) {
    return (snapshot.rows || []).filter((row) => !(row.deletedAt || row.deleted_at));
  }

  function renderSnapshot(snapshot) {
    personalData.useNamespace(user.id, {
      expenses: activeRows(snapshot),
      categories: snapshot.categories,
      style: snapshot.style,
      importRules: snapshot.importRules || []
    });
  }

  function schedule() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => syncNow().catch(() => {}), 150);
  }

  async function syncNow() {
    if (!user) return;
    if (inFlight) return inFlight;
    if (networkState?.navigator?.onLine === false || networkState?.onLine === false) throw new Error("Offline");
    inFlight = (async () => {
      for (const operation of storage.outbox(user.id)) {
        await repository.apply(operation);
        storage.ack(user.id, operation.operation_id);
      }
      const cloud = await repository.pull(user.id);
      const cached = storage.accountSnapshot(user.id);
      const rows = mergeExpenseRows(cached.rows, cloud.expenses);
      const chosen = chooseInitialSettings({
        local: { categories: cached.categories || guest?.categories, style: cached.style || guest?.style || "pocket", importRules: cached.categories ? cached.importRules : (guest?.importRules || []) },
        cloud: cloud.settings ? { categories: cloud.settings.categories, style: cloud.settings.style, importRules: cloud.settings.importRules } : null,
        localIsDefault: guest?.localIsDefault
      });
      if (chosen.upload && chosen.settings?.categories?.length) storage.enqueue(user.id, settingsOperation(chosen.settings));
      const snapshot = { rows, categories: chosen.settings.categories, style: chosen.settings.style, importRules: chosen.settings.importRules };
      storage.saveAccountSnapshot(user.id, snapshot);
      renderSnapshot(snapshot);
      return snapshot;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function startSession(nextUser) {
    if (!nextUser?.id) throw new Error("A signed-in user is required");
    if (user?.id === nextUser.id) return syncNow().catch(() => storage.accountSnapshot(nextUser.id));
    stopSession(false);
    user = nextUser;
    guest = storage.guestSnapshot();
    let cached = storage.accountSnapshot(user.id);

    if (!storage.hasImportedGuest(user.id)) {
      const normalized = normalizeLegacyExpenses(guest.expenses, storage.deviceId(), () => storage.nextOperationId());
      normalized.operations.forEach((operation) => storage.enqueue(user.id, operation));
      const rows = mergeExpenseRows(cached.rows, normalized.expenses);
      cached = {
        rows,
        categories: cached.categories || guest.categories,
        style: cached.style || guest.style || "pocket",
        importRules: cached.categories ? cached.importRules : (guest.importRules || [])
      };
      storage.saveAccountSnapshot(user.id, cached);
      if (guest.categories?.length) storage.enqueue(user.id, settingsOperation({ categories: guest.categories, style: guest.style || "pocket", importRules: guest.importRules || [] }));
      storage.markGuestImported(user.id);
    }

    renderSnapshot(cached);
    mutationOff = personalData.onMutation((mutation) => {
      if (!user) return;
      let operation;
      if (mutation.kind === "expense_upsert") operation = expenseToOperation(mutation.expense, storage.nextOperationId());
      if (mutation.kind === "expense_delete") operation = deletionToOperation(mutation.expenseId, storage.nextOperationId());
      if (mutation.kind === "settings_replace") operation = settingsOperation(mutation.settings);
      if (operation) {
        storage.enqueue(user.id, operation);
        const current = storage.accountSnapshot(user.id);
        storage.saveAccountSnapshot(user.id, { rows: personalData.snapshot().expenses, categories: personalData.snapshot().categories, style: personalData.snapshot().style, importRules: personalData.snapshot().importRules || [] });
        schedule();
      }
    });
    subscription = repository.subscribe(user.id, schedule);
    try { return await syncNow(); }
    catch (error) {
      if (!cached.rows.length && !cached.categories) personalData.showStorageError("Cloud sync is temporarily unavailable");
      return cached;
    }
  }

  function stopSession(restoreGuest = true) {
    clearTimeout(retryTimer);
    mutationOff?.();
    mutationOff = null;
    subscription?.unsubscribe?.();
    subscription = null;
    user = null;
    inFlight = null;
    if (restoreGuest && guest) personalData.useNamespace("guest", guest);
  }

  networkState?.addEventListener?.("online", schedule);
  documentState?.addEventListener?.("visibilitychange", () => {
    if (documentState.visibilityState === "visible") schedule();
  });

  return { startSession, stopSession, syncNow, status: () => ({ signedIn: Boolean(user), syncing: Boolean(inFlight) }), dispose: stopSession };
}
